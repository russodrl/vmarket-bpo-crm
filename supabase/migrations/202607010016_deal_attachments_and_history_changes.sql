-- Deal attachments and detailed history for deal, linked company, and linked contact changes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('deal-attachments', 'deal-attachments', false, 52428800, null)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.deal_attachments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  storage_bucket text not null default 'deal-attachments',
  storage_path text not null,
  file_name text not null,
  file_type text,
  file_size bigint,
  category text not null default 'attachment' check (category in ('attachment', 'document')),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(storage_bucket, storage_path)
);

create index if not exists deal_attachments_deal_created_idx on public.deal_attachments (deal_id, created_at desc);
create index if not exists deal_attachments_uploaded_by_idx on public.deal_attachments (uploaded_by);

alter table public.deal_attachments enable row level security;

drop policy if exists "deal attachments select scope" on public.deal_attachments;
create policy "deal attachments select scope" on public.deal_attachments for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.deals d
    where d.id = deal_id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);

drop policy if exists "deal attachments insert scope" on public.deal_attachments;
create policy "deal attachments insert scope" on public.deal_attachments for insert to authenticated with check (
  uploaded_by = auth.uid()
  and (public.is_admin() or exists (
    select 1 from public.deals d
    where d.id = deal_id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  ))
);

drop policy if exists "deal attachments delete scope" on public.deal_attachments;
create policy "deal attachments delete scope" on public.deal_attachments for delete to authenticated using (
  public.is_admin() or uploaded_by = auth.uid() or exists (
    select 1 from public.deals d
    where d.id = deal_id and d.owner_id = auth.uid()
  )
);

-- Storage object policies for the bucket. Object path starts with the deal id.
drop policy if exists "deal attachment objects select scope" on storage.objects;
create policy "deal attachment objects select scope" on storage.objects for select to authenticated using (
  bucket_id = 'deal-attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.deals d
      where d.id::text = (storage.foldername(name))[1]
        and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
    )
  )
);

drop policy if exists "deal attachment objects insert scope" on storage.objects;
create policy "deal attachment objects insert scope" on storage.objects for insert to authenticated with check (
  bucket_id = 'deal-attachments'
  and (
    public.is_admin()
    or exists (
      select 1 from public.deals d
      where d.id::text = (storage.foldername(name))[1]
        and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
    )
  )
);

drop policy if exists "deal attachment objects delete scope" on storage.objects;
create policy "deal attachment objects delete scope" on storage.objects for delete to authenticated using (
  bucket_id = 'deal-attachments'
  and (
    public.is_admin()
    or owner = auth.uid()
    or exists (
      select 1 from public.deals d
      where d.id::text = (storage.foldername(name))[1]
        and d.owner_id = auth.uid()
    )
  )
);

create or replace function public.crm_history_label(table_name text, field_name text)
returns text language sql immutable as $$
  select case table_name || '.' || field_name
    when 'deals.title' then 'Título do negócio'
    when 'deals.stage_id' then 'Etapa'
    when 'deals.owner_id' then 'Proprietário CRM'
    when 'deals.status' then 'Status'
    when 'deals.lost_reason' then 'Motivo da perda'
    when 'deals.vm_sale' then 'Venda VMarket?'
    when 'deals.contract_with' then 'Contrato com'
    when 'deals.business_type' then 'Tipo'
    when 'deals.vm_product_type' then 'Tipo VMarket'
    when 'deals.vm_cnpj_count' then 'Quantidade de CNPJs'
    when 'deals.vm_plan' then 'Plano'
    when 'deals.vm_loyalty_period' then 'Período de Fidelidade'
    when 'deals.vm_value_per_cnpj' then 'Valor por CNPJ'
    when 'deals.value' then 'Valor VMarket'
    when 'deals.partner_value' then 'Valor Parceiro'
    when 'deals.monthly_purchase' then 'GMV mensal total'
    when 'deals.expected_close_date' then 'Data esperada de Fechamento'
    when 'deals.focus_items' then 'Foco'
    when 'organizations.name' then 'Empresa'
    when 'organizations.type' then 'Tipo da empresa'
    when 'organizations.city' then 'Cidade da empresa'
    when 'organizations.state' then 'Estado da empresa'
    when 'organizations.cnpjs' then 'Quantidade de CNPJs da empresa'
    when 'organizations.monthly_purchase' then 'GMV mensal da empresa'
    when 'organizations.owner_id' then 'Proprietário da empresa'
    when 'people.full_name' then 'Nome do contato'
    when 'people.role_title' then 'Cargo do contato'
    when 'people.email' then 'Email do contato'
    when 'people.phone' then 'Telefone do contato'
    when 'people.owner_id' then 'Proprietário do contato'
    else field_name
  end
$$;

create or replace function public.crm_history_value(value jsonb)
returns text language plpgsql immutable as $$
begin
  if value is null or value = 'null'::jsonb then
    return 'vazio';
  end if;
  if jsonb_typeof(value) = 'string' then
    return trim(both '"' from value::text);
  end if;
  return value::text;
end;
$$;

create or replace function public.record_deal_field_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_json jsonb;
  new_json jsonb;
  key text;
  ignored text[] := array['updated_at'];
  label text;
  deal_title text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  old_json := to_jsonb(old);
  new_json := to_jsonb(new);
  deal_title := coalesce(new.title, old.title, 'negócio');
  for key in select jsonb_object_keys(new_json)
  loop
    if key = any(ignored) then
      continue;
    end if;
    if (old_json -> key) is distinct from (new_json -> key) then
      label := public.crm_history_label('deals', key);
      insert into public.deal_history (deal_id, event_type, title, description, actor_id)
      values (
        new.id,
        'Campo',
        'Campo do negócio alterado: ' || label,
        label || ' mudou de "' || public.crm_history_value(old_json -> key) || '" para "' || public.crm_history_value(new_json -> key) || '".',
        auth.uid()
      );
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.record_linked_record_field_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_json jsonb;
  new_json jsonb;
  key text;
  label text;
  rec record;
  ignored text[] := array['updated_at'];
  entity_title text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  old_json := to_jsonb(old);
  new_json := to_jsonb(new);
  entity_title := case when tg_table_name = 'organizations' then coalesce(new.name, old.name, 'empresa') else coalesce(new.full_name, old.full_name, 'contato') end;
  for key in select jsonb_object_keys(new_json)
  loop
    if key = any(ignored) then
      continue;
    end if;
    if (old_json -> key) is distinct from (new_json -> key) then
      label := public.crm_history_label(tg_table_name, key);
      for rec in execute format(
        'select id from public.deals where %I = $1',
        case when tg_table_name = 'organizations' then 'organization_id' else 'person_id' end
      ) using new.id
      loop
        insert into public.deal_history (deal_id, event_type, title, description, actor_id)
        values (
          rec.id,
          case when tg_table_name = 'organizations' then 'Empresa' else 'Contato' end,
          case when tg_table_name = 'organizations' then 'Campo da empresa alterado: ' else 'Campo do contato alterado: ' end || label,
          label || ' de ' || entity_title || ' mudou de "' || public.crm_history_value(old_json -> key) || '" para "' || public.crm_history_value(new_json -> key) || '".',
          auth.uid()
        );
      end loop;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists deal_field_history_after_update on public.deals;
create trigger deal_field_history_after_update
after update on public.deals
for each row execute function public.record_deal_field_history();

drop trigger if exists organization_field_history_after_update on public.organizations;
create trigger organization_field_history_after_update
after update on public.organizations
for each row execute function public.record_linked_record_field_history();

drop trigger if exists person_field_history_after_update on public.people;
create trigger person_field_history_after_update
after update on public.people
for each row execute function public.record_linked_record_field_history();
