update public.crm_users
set permission = 'Teste', updated_at = now()
where lower(coalesce(full_name, '') || ' ' || coalesce(email::text, '')) like '%aspalamar%';

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
      and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
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
      and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
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

truncate table public.lead_distribution_company_queue, public.lead_distribution_user_queue;

insert into public.lead_distribution_company_queue (company_id, assignment_count, last_assigned_at, updated_at)
select cu.company_id, count(d.id)::int, max(d.created_at), now()
from public.crm_users cu
left join public.profiles p on p.id = cu.auth_user_id
left join public.deals d on d.owner_id = cu.auth_user_id
where cu.status = 'active'
  and cu.auth_user_id is not null
  and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
  and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
  and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
group by cu.company_id;

insert into public.lead_distribution_user_queue (auth_user_id, company_id, assignment_count, last_assigned_at, updated_at)
select cu.auth_user_id, cu.company_id, count(d.id)::int, max(d.created_at), now()
from public.crm_users cu
left join public.profiles p on p.id = cu.auth_user_id
left join public.deals d on d.owner_id = cu.auth_user_id
where cu.status = 'active'
  and cu.auth_user_id is not null
  and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
  and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
  and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
group by cu.auth_user_id, cu.company_id;

update public.automation_rules
set
  filters = '[{"field":"deals.owner_id","operator":"is null"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"},{"field":"crm_users.permission","operator":"not in","value":["Admin","Teste"]},{"field":"crm_users.full_name/email","operator":"not contains","value":"aspalamar"}]'::jsonb,
  actions = '[{"action":"choose next crm_company by queue/load"},{"action":"choose next active non-admin non-test user inside selected company"},{"action":"set deals.owner_id"},{"action":"insert automation_rule_executions"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'lead_distribution_round_robin';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'lead_distribution_round_robin',
  'implementation_changed',
  'Hermes',
  'Distribuição agora exclui usuários com permissão Admin ou Teste, além de usuários de teste como Aspalamar.',
  '{"excluded_permissions":["Admin","Teste"],"aspalamar_permission":"Teste"}'::jsonb
);
