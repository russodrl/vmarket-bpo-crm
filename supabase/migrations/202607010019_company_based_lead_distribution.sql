create table if not exists public.lead_distribution_company_queue (
  company_id uuid primary key references public.crm_companies(id) on delete cascade,
  last_assigned_at timestamptz,
  assignment_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_distribution_user_queue (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.crm_companies(id) on delete cascade,
  last_assigned_at timestamptz,
  assignment_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.next_lead_owner(target_deal_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_company_id uuid;
  selected_owner_id uuid;
begin
  with active_users as (
    select cu.auth_user_id, cu.company_id, cu.full_name, cc.name as company_name
    from public.crm_users cu
    join public.crm_companies cc on cc.id = cu.company_id
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.company_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
      and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
  ), company_load as (
    select
      au.company_id,
      min(au.company_name) as company_name,
      count(distinct au.auth_user_id) as active_users,
      count(d.id) filter (where d.status = 'aberto' or d.status is null or d.status not in ('ganho', 'perdido')) as open_deals,
      coalesce(q.assignment_count, 0) as assignment_count,
      q.last_assigned_at
    from active_users au
    left join public.deals d on d.owner_id = au.auth_user_id
    left join public.lead_distribution_company_queue q on q.company_id = au.company_id
    group by au.company_id, q.assignment_count, q.last_assigned_at
  )
  select company_id
    into selected_company_id
  from company_load
  order by open_deals asc, assignment_count asc, last_assigned_at asc nulls first, company_name asc
  limit 1;

  if selected_company_id is null then
    return null;
  end if;

  with company_users as (
    select
      cu.auth_user_id,
      cu.full_name,
      count(d.id) filter (where d.status = 'aberto' or d.status is null or d.status not in ('ganho', 'perdido')) as open_deals,
      count(d.id) as received_deals,
      coalesce(uq.assignment_count, 0) as assignment_count,
      uq.last_assigned_at
    from public.crm_users cu
    left join public.profiles p on p.id = cu.auth_user_id
    left join public.deals d on d.owner_id = cu.auth_user_id
    left join public.lead_distribution_user_queue uq on uq.auth_user_id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.company_id = selected_company_id
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
      and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
    group by cu.auth_user_id, cu.full_name, uq.assignment_count, uq.last_assigned_at
  )
  select auth_user_id
    into selected_owner_id
  from company_users
  order by open_deals asc, assignment_count asc, last_assigned_at asc nulls first, received_deals asc, full_name asc
  limit 1;

  if selected_owner_id is null then
    return null;
  end if;

  insert into public.lead_distribution_company_queue (company_id, last_assigned_at, assignment_count, updated_at)
  values (selected_company_id, now(), 1, now())
  on conflict (company_id) do update set
    last_assigned_at = excluded.last_assigned_at,
    assignment_count = public.lead_distribution_company_queue.assignment_count + 1,
    updated_at = now();

  insert into public.lead_distribution_user_queue (auth_user_id, company_id, last_assigned_at, assignment_count, updated_at)
  values (selected_owner_id, selected_company_id, now(), 1, now())
  on conflict (auth_user_id) do update set
    company_id = excluded.company_id,
    last_assigned_at = excluded.last_assigned_at,
    assignment_count = public.lead_distribution_user_queue.assignment_count + 1,
    updated_at = now();

  return selected_owner_id;
end;
$$;

create or replace function public.next_lead_owner()
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.next_lead_owner(null::uuid)
$$;

create or replace function public.assign_lead_owner_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned uuid;
  rule_id text := 'lead_distribution_round_robin';
begin
  if new.owner_id is null then
    assigned := public.next_lead_owner(new.id);
    if assigned is not null then
      new.owner_id := assigned;
      insert into public.automation_rule_executions (
        rule_id, status, trigger_system, trigger_type,
        record_entity, internal_id, external_id, started_at, finished_at, changed_fields,
        filters_evaluated, actions_performed, details
      ) values (
        rule_id, 'success', 'CRM BPO', 'deals.insert owner_id null',
        'deal', new.id, new.id::text, now(), now(), '["deals.owner_id"]'::jsonb,
        jsonb_build_array(jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true)),
        '["assigned lead owner by company queue"]'::jsonb,
        jsonb_build_object('deal_id', new.id, 'deal_title', new.title, 'assigned_owner_id', assigned, 'queue_type', 'empresa')
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.distribute_unassigned_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  assigned uuid;
  changed integer := 0;
  rule_id text := 'lead_distribution_round_robin';
begin
  for rec in
    select d.id, d.title
    from public.deals d
    where d.owner_id is null
      and public.pipedrive_deal_is_aleksander_owner(d.id)
    order by d.created_at, d.id
  loop
    assigned := public.next_lead_owner(rec.id);
    exit when assigned is null;

    update public.deals
       set owner_id = assigned,
           updated_at = now()
     where id = rec.id;

    changed := changed + 1;

    insert into public.automation_rule_executions (
      rule_id, status, trigger_system, trigger_type,
      record_entity, internal_id, external_id, started_at, finished_at, changed_fields,
      filters_evaluated, actions_performed, details
    ) values (
      rule_id, 'success', 'CRM BPO', 'manual_run distribute_unassigned_leads',
      'deal', rec.id, rec.id::text, now(), now(), '["deals.owner_id"]'::jsonb,
      jsonb_build_array(jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true)),
      '["assigned lead owner by company queue"]'::jsonb,
      jsonb_build_object('deal_id', rec.id, 'deal_title', rec.title, 'assigned_owner_id', assigned, 'queue_type', 'empresa')
    );
  end loop;
  return changed;
end;
$$;

update public.automation_rules
set
  name = 'CRM BPO: distribuir leads por fila de empresa',
  description = 'Atribui novos leads usando primeiro uma fila uniforme por empresa parceira ativa. Depois de escolhida a empresa, o lead vai para o próximo usuário ativo na fila dessa empresa, mantendo a distribuição equilibrada entre empresas e, dentro de cada empresa, entre seus usuários.',
  triggers = '[{"event":"deals.insert","condition":"owner_id is null"},{"event":"manual_run","function":"distribute_unassigned_leads"}]'::jsonb,
  filters = '[{"field":"deals.owner_id","operator":"is null"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"},{"field":"crm_users.full_name/email","operator":"not contains","value":"aspalamar"}]'::jsonb,
  actions = '[{"action":"choose next crm_company by queue/load"},{"action":"choose next active user inside selected company"},{"action":"set deals.owner_id"},{"action":"insert automation_rule_executions"}]'::jsonb,
  fields_involved = '["deals.owner_id","crm_users.company_id","crm_users.auth_user_id","lead_distribution_company_queue","lead_distribution_user_queue"]'::jsonb,
  implementation_refs = '[{"type":"sql_function","name":"public.next_lead_owner"},{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"},{"type":"table","name":"public.lead_distribution_company_queue"},{"type":"table","name":"public.lead_distribution_user_queue"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'lead_distribution_round_robin';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'lead_distribution_round_robin',
  'implementation_changed',
  'Hermes',
  'Distribuição alterada para fila por empresa, com rodízio uniforme entre usuários da empresa escolhida.',
  '{"strategy":"company_queue_then_user_queue","excludes":"aspalamar/test users"}'::jsonb
);
