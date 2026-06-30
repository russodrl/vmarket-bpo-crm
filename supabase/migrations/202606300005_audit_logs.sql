create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  entity_id uuid,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  field_name text,
  old_value jsonb,
  new_value jsonb,
  actor_id uuid,
  actor_name text not null default 'API',
  actor_type text not null default 'api' check (actor_type in ('api', 'admin', 'user')),
  change_source text not null default 'database',
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_type_idx on public.audit_logs (actor_type);
create index if not exists audit_logs_table_operation_idx on public.audit_logs (table_name, operation);
create index if not exists audit_logs_entity_idx on public.audit_logs (table_name, entity_id);

alter table public.audit_logs enable row level security;

drop policy if exists "audit logs admin read" on public.audit_logs;
create policy "audit logs admin read" on public.audit_logs
  for select to authenticated
  using (public.is_admin());

create or replace function public.audit_actor_type(actor uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when actor is null then 'api'
    when exists (select 1 from public.profiles p where p.id = actor and p.role = 'admin_vmarket') then 'admin'
    else 'user'
  end
$$;

create or replace function public.audit_actor_name(actor uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when actor is null then 'API'
    else coalesce((select nullif(p.full_name, '') from public.profiles p where p.id = actor), 'Usuário')
  end
$$;

create or replace function public.audit_row_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  old_json jsonb;
  new_json jsonb;
  key text;
  ignored text[] := array['updated_at'];
  row_id uuid;
begin
  if tg_op = 'INSERT' then
    new_json := to_jsonb(new);
    row_id := nullif(new_json->>'id', '')::uuid;
    insert into public.audit_logs (table_name, entity_id, operation, field_name, old_value, new_value, actor_id, actor_name, actor_type, change_source)
    values (tg_table_name, row_id, 'insert', null, null, new_json, actor, public.audit_actor_name(actor), public.audit_actor_type(actor), case when actor is null then 'api' else 'crm' end);
    return new;
  elsif tg_op = 'DELETE' then
    old_json := to_jsonb(old);
    row_id := nullif(old_json->>'id', '')::uuid;
    insert into public.audit_logs (table_name, entity_id, operation, field_name, old_value, new_value, actor_id, actor_name, actor_type, change_source)
    values (tg_table_name, row_id, 'delete', null, old_json, null, actor, public.audit_actor_name(actor), public.audit_actor_type(actor), case when actor is null then 'api' else 'crm' end);
    return old;
  else
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);
    row_id := nullif(new_json->>'id', '')::uuid;
    for key in select jsonb_object_keys(new_json)
    loop
      if key = any(ignored) then
        continue;
      end if;
      if (old_json -> key) is distinct from (new_json -> key) then
        insert into public.audit_logs (table_name, entity_id, operation, field_name, old_value, new_value, actor_id, actor_name, actor_type, change_source)
        values (tg_table_name, row_id, 'update', key, old_json -> key, new_json -> key, actor, public.audit_actor_name(actor), public.audit_actor_type(actor), case when actor is null then 'api' else 'crm' end);
      end if;
    end loop;
    return new;
  end if;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['deals', 'organizations', 'people', 'activities', 'deal_labels', 'deal_label_assignments', 'custom_field_values', 'crm_users', 'crm_companies']
  loop
    execute format('drop trigger if exists audit_%I_changes on public.%I', t, t);
    execute format('create trigger audit_%I_changes after insert or update or delete on public.%I for each row execute function public.audit_row_changes()', t, t);
  end loop;
end $$;

insert into public.audit_logs (table_name, entity_id, operation, field_name, old_value, new_value, actor_name, actor_type, change_source, created_at)
select 'deal_history', h.deal_id, 'insert', null, null,
       jsonb_build_object('event_type', h.event_type, 'title', h.title, 'description', h.description),
       'Histórico legado', 'api', 'backfill', h.created_at
from public.deal_history h
where not exists (
  select 1 from public.audit_logs a
  where a.table_name = 'deal_history'
    and a.entity_id = h.deal_id
    and a.created_at = h.created_at
    and a.new_value->>'title' = h.title
);
