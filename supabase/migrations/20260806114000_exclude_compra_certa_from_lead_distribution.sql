-- Atualiza a distribuição automática de leads conforme pedido da gestão:
-- - Erica Oliveira e Ricardo Kirk (Compra Certa Food) deixam de receber novos leads;
-- - próximos leads ficam restritos a Adriano e Renata;
-- - todos os negócios atualmente com Ricardo Kirk são redistribuídos de forma alternada entre Renata e Adriano.

select set_config('request.jwt.claim.role', 'service_role', false);

create table if not exists public.lead_distribution_user_exclusions (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mantém Erica e Ricardo com acesso ao CRM, mas fora da distribuição de novos leads.
insert into public.lead_distribution_user_exclusions (auth_user_id, reason, updated_at)
select cu.auth_user_id,
       'Removido da distribuição de leads a pedido da gestão em 2026-08-06.',
       now()
from public.crm_users cu
where cu.auth_user_id is not null
  and lower(cu.email::text) in (
    lower('goncalveserica35@gmail.com'),
    lower('ricardokirkdecarvalho@gmail.com')
  )
on conflict (auth_user_id) do update set
  reason = excluded.reason,
  updated_at = now();

-- Remove da fila qualquer usuário que não faz mais parte dos alvos atuais.
delete from public.lead_distribution_user_queue uq
using public.crm_users cu
where uq.auth_user_id = cu.auth_user_id
  and (
    cu.status <> 'active'
    or lower(cu.email::text) in (
      lower('goncalveserica35@gmail.com'),
      lower('ricardokirkdecarvalho@gmail.com')
    )
    or lower(cu.email::text) not in (
      lower('adriano.bsp1@gmail.com'),
      lower('renata@gasnagestao.com.br')
    )
  );

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
    and lower(coalesce(candidate_email, '')) in (
      lower('adriano.bsp1@gmail.com'),
      lower('renata@gasnagestao.com.br')
    )
$$;

create or replace function public.next_lead_owner(target_deal_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_owner_id uuid;
begin
  perform public.enrich_crm_user_ddd(null);

  with eligible_users as (
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
    where public.lead_distribution_user_is_eligible(
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
  from eligible_users
  order by open_deals asc, assignment_count asc, last_assigned_at asc nulls first, received_deals asc, full_name asc
  limit 1;

  if selected_owner_id is null then
    return null;
  end if;

  insert into public.lead_distribution_user_queue (auth_user_id, company_id, last_assigned_at, assignment_count, updated_at)
  select selected_owner_id, cu.company_id, now(), 1, now()
  from public.crm_users cu
  where cu.auth_user_id = selected_owner_id
  limit 1
  on conflict (auth_user_id) do update set
    company_id = excluded.company_id,
    last_assigned_at = excluded.last_assigned_at,
    assignment_count = public.lead_distribution_user_queue.assignment_count + 1,
    updated_at = now();

  return selected_owner_id;
end;
$$;

-- Redistribui todos os negócios do Ricardo Kirk entre Renata e Adriano, de forma alternada e determinística.
with owners as (
  select
    min(auth_user_id::text) filter (where lower(email::text) = lower('ricardokirkdecarvalho@gmail.com'))::uuid as ricardo_id,
    min(auth_user_id::text) filter (where lower(email::text) = lower('renata@gasnagestao.com.br'))::uuid as renata_id,
    min(auth_user_id::text) filter (where lower(email::text) = lower('adriano.bsp1@gmail.com'))::uuid as adriano_id
  from public.crm_users
), ricardo_deals as (
  select d.id, row_number() over (order by d.created_at, d.id) as rn
  from public.deals d, owners o
  where d.owner_id = o.ricardo_id
)
update public.deals d
set owner_id = case when rd.rn % 2 = 1 then o.renata_id else o.adriano_id end,
    updated_at = now()
from ricardo_deals rd, owners o
where d.id = rd.id
  and o.ricardo_id is not null
  and o.renata_id is not null
  and o.adriano_id is not null;

update public.automation_rules
set
  filters = '[{"field":"deals.owner_id","operator":"is null"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"lead_distribution_user_exclusions.auth_user_id","operator":"not exists"},{"field":"crm_users.email","operator":"in","value":["adriano.bsp1@gmail.com","renata@gasnagestao.com.br"]},{"field":"crm_users.full_name/email","operator":"not test user"}]'::jsonb,
  actions = '[{"action":"choose next eligible user by workload/queue"},{"action":"set deals.owner_id"},{"action":"insert automation_rule_executions"}]'::jsonb,
  fields_involved = '["deals.owner_id","crm_users.auth_user_id","lead_distribution_user_queue","lead_distribution_user_exclusions"]'::jsonb,
  implementation_refs = '[{"type":"sql_function","name":"public.next_lead_owner"},{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"},{"type":"table","name":"public.lead_distribution_user_queue"},{"type":"table","name":"public.lead_distribution_user_exclusions"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'lead_distribution_round_robin';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'lead_distribution_round_robin',
  'implementation_changed',
  'Hermes',
  'Distribuição alterada para excluir Erica Oliveira e Ricardo Kirk de novos leads; próximos leads restritos a Adriano e Renata; negócios do Ricardo Kirk redistribuídos entre Renata e Adriano.',
  '{"excluded":["Erica Oliveira","Ricardo Kirk"],"daily_targets":["Adriano Bispo dos Santos","RENATA"],"redistributed_from":"Ricardo Kirk","redistributed_to":["RENATA","Adriano Bispo dos Santos"]}'::jsonb
);
