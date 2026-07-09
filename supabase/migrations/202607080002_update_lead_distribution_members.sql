-- Ajusta membros elegíveis para a distribuição automática de leads.
-- Mantém usuários ativos no CRM, mas permite excluir pessoas específicas da fila
-- sem precisar desativar o acesso delas.

select set_config('request.jwt.claim.role', 'service_role', false);

create table if not exists public.lead_distribution_user_exclusions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.lead_distribution_user_exclusions (auth_user_id, reason, updated_at)
select cu.auth_user_id,
       case
         when lower(cu.full_name) like '%guilherme%' then 'Removido da distribuição: usuário deletado a pedido da gestão.'
         else 'Removido da distribuição de leads a pedido da gestão.'
       end,
       now()
from public.crm_users cu
where cu.auth_user_id is not null
  and lower(cu.full_name) in (
    lower('Guilherme Araújo de Sá e camargo'),
    lower('Felippe Saadia'),
    lower('Felipe José Campos Valina'),
    lower('Elaine Guedes')
  )
on conflict (auth_user_id) do update set
  reason = excluded.reason,
  updated_at = now();

update public.crm_users
set status = 'deleted',
    updated_at = now()
where lower(full_name) = lower('Guilherme Araújo de Sá e camargo');

-- Limpa posições antigas da fila para usuários removidos; o histórico dos negócios permanece intacto.
delete from public.lead_distribution_user_queue uq
using public.lead_distribution_user_exclusions ex
where uq.auth_user_id = ex.auth_user_id;

create or replace function public.lead_distribution_user_is_eligible(
  candidate_auth_user_id uuid,
  candidate_role text,
  candidate_permission text,
  candidate_status text,
  candidate_full_name text,
  candidate_email text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select candidate_auth_user_id is not null
    and candidate_status = 'active'
    and not exists (
      select 1
      from public.lead_distribution_user_exclusions ex
      where ex.auth_user_id = candidate_auth_user_id
    )
    and not public.crm_assignment_user_is_test(candidate_full_name, candidate_email)
    and (
      (
        coalesce(candidate_role, 'bpo_partner') = 'bpo_partner'
        and coalesce(candidate_permission, 'BPO') not in ('Admin', 'Teste')
      )
      or lower(coalesce(candidate_email, '')) = lower('bruno.castelloes@vmarket.com.br')
    )
$$;

create or replace function public.next_lead_company_by_location(deal_prefix text default null, deal_state text default null)
returns uuid
language sql
security definer
set search_path = public
as $$
  with active_users as (
    select
      cu.auth_user_id,
      cu.company_id,
      cu.full_name,
      cu.ddd_prefix,
      cu.ddd_state,
      cc.name as company_name
    from public.crm_users cu
    join public.crm_companies cc on cc.id = cu.company_id
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.company_id is not null
      and public.lead_distribution_user_is_eligible(
        cu.auth_user_id,
        p.role::text,
        cu.permission,
        cu.status,
        cu.full_name,
        cu.email::text
      )
  ), company_load as (
    select
      au.company_id,
      min(au.company_name) as company_name,
      bool_or(au.ddd_prefix = deal_prefix) filter (where deal_prefix is not null) as matches_ddd,
      bool_or(au.ddd_state = deal_state) filter (where deal_state is not null) as matches_state,
      count(distinct au.auth_user_id) as active_users,
      count(d.id) filter (where d.status = 'aberto' or d.status is null or d.status not in ('ganho', 'perdido')) as open_deals,
      coalesce(q.assignment_count, 0) as assignment_count,
      q.last_assigned_at
    from active_users au
    left join public.deals d on d.owner_id = au.auth_user_id
    left join public.lead_distribution_company_queue q on q.company_id = au.company_id
    group by au.company_id, q.assignment_count, q.last_assigned_at
  ), selected as (
    select *, 1 as queue_priority
    from company_load
    where coalesce(matches_ddd, false)
    union all
    select *, 2 as queue_priority
    from company_load
    where coalesce(matches_state, false)
      and not exists (select 1 from company_load where coalesce(matches_ddd, false))
    union all
    select *, 3 as queue_priority
    from company_load
    where not exists (select 1 from company_load where coalesce(matches_ddd, false))
      and not exists (select 1 from company_load where coalesce(matches_state, false))
  )
  select company_id
  from selected
  order by queue_priority, open_deals asc, assignment_count asc, last_assigned_at asc nulls first, company_name asc
  limit 1
$$;

create or replace function public.next_lead_owner(target_deal_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_company_id uuid;
  selected_owner_id uuid;
  deal_prefix text;
  deal_state text;
begin
  perform public.enrich_crm_user_ddd(null);

  if target_deal_id is not null then
    select p.ddd_prefix, p.ddd_state
      into deal_prefix, deal_state
    from public.deals d
    left join public.people p on p.id = d.person_id
    where d.id = target_deal_id;
  end if;

  selected_company_id := public.next_lead_company_by_location(deal_prefix, deal_state);

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
    where cu.company_id = selected_company_id
      and public.lead_distribution_user_is_eligible(
        cu.auth_user_id,
        p.role::text,
        cu.permission,
        cu.status,
        cu.full_name,
        cu.email::text
      )
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

update public.automation_rules
set
  filters = '[{"field":"deals.owner_id","operator":"is null"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"lead_distribution_user_exclusions.auth_user_id","operator":"not exists"},{"field":"crm_users.permission/profiles.role","operator":"eligible for BPO distribution or explicit Bruno allowlist"},{"field":"crm_users.full_name/email","operator":"not test user"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'lead_distribution_round_robin';
