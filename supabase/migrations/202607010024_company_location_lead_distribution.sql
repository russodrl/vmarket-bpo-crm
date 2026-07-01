-- Restore DDD/state priority, but choose the partner company first.
-- Flow: lead DDD -> companies with eligible users in that DDD; fallback state -> companies with eligible users in that state; fallback geral.
-- After the company is selected, choose the next eligible user inside that company.

create or replace function public.lead_distribution_queue_for_location(deal_prefix text default null, deal_state text default null)
returns text
language sql
security definer
set search_path = public
as $$
  with eligible_companies as (
    select distinct cu.company_id
    from public.crm_users cu
    join public.crm_companies cc on cc.id = cu.company_id
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.company_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
      and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
      and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
  ), company_locations as (
    select
      ec.company_id,
      bool_or(cu.ddd_prefix = deal_prefix) filter (where deal_prefix is not null) as matches_ddd,
      bool_or(cu.ddd_state = deal_state) filter (where deal_state is not null) as matches_state
    from eligible_companies ec
    join public.crm_users cu on cu.company_id = ec.company_id
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
      and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
      and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
    group by ec.company_id
  )
  select case
    when exists (select 1 from company_locations where coalesce(matches_ddd, false)) then 'ddd'
    when exists (select 1 from company_locations where coalesce(matches_state, false)) then 'estado'
    else 'geral'
  end
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

create or replace function public.lead_distribution_queue_for_deal(target_deal_id uuid default null)
returns text
language sql
security definer
set search_path = public
as $$
  select public.lead_distribution_queue_for_location(p.ddd_prefix, p.ddd_state)
  from public.deals d
  left join public.people p on p.id = d.person_id
  where target_deal_id is not null and d.id = target_deal_id
  union all
  select public.lead_distribution_queue_for_location(null, null)
  where target_deal_id is null
  limit 1
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
  queue text;
  changed integer := 0;
  rule_id text := 'lead_distribution_round_robin';
begin
  perform public.enrich_crm_user_ddd(null);
  perform public.enrich_person_ddd(null);

  for rec in
    select d.id, d.title, p.ddd_prefix, p.ddd_state
    from public.deals d
    left join public.people p on p.id = d.person_id
    where d.owner_id is null
      and public.pipedrive_deal_is_aleksander_owner(d.id)
    order by d.created_at, d.id
  loop
    queue := coalesce(public.lead_distribution_queue_for_location(rec.ddd_prefix, rec.ddd_state), 'geral');
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
      jsonb_build_array(
        jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true),
        jsonb_build_object('field','people.ddd_prefix','actual',rec.ddd_prefix,'queue',queue),
        jsonb_build_object('field','people.ddd_state','actual',rec.ddd_state,'queue',queue),
        jsonb_build_object('field','company_queue','actual',queue,'result',true)
      ),
      jsonb_build_array('assigned lead owner by company ' || queue || ' queue'),
      jsonb_build_object('deal_id', rec.id, 'deal_title', rec.title, 'assigned_owner_id', assigned, 'queue_type', queue, 'deal_ddd_prefix', rec.ddd_prefix, 'deal_ddd_state', rec.ddd_state)
    );
  end loop;
  return changed;
end;
$$;

create or replace function public.assign_lead_owner_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned uuid;
  queue text;
  deal_prefix text;
  deal_state text;
  rule_id text := 'lead_distribution_round_robin';
begin
  if new.owner_id is null then
    perform public.enrich_crm_user_ddd(null);
    if new.person_id is not null then
      select p.ddd_prefix, p.ddd_state into deal_prefix, deal_state
      from public.people p
      where p.id = new.person_id;
    end if;
    queue := coalesce(public.lead_distribution_queue_for_location(deal_prefix, deal_state), 'geral');
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
        jsonb_build_array(
          jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true),
          jsonb_build_object('field','people.ddd_prefix','actual',deal_prefix,'queue',queue),
          jsonb_build_object('field','people.ddd_state','actual',deal_state,'queue',queue),
          jsonb_build_object('field','company_queue','actual',queue,'result',true)
        ),
        jsonb_build_array('assigned lead owner by company ' || queue || ' queue'),
        jsonb_build_object('deal_id', new.id, 'deal_title', new.title, 'assigned_owner_id', assigned, 'queue_type', queue, 'deal_ddd_prefix', deal_prefix, 'deal_ddd_state', deal_state)
      );
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.lead_distribution_candidate_stats(target_deal_id uuid default null)
returns table (
  queue_type text,
  deal_ddd_prefix text,
  deal_ddd_state text,
  auth_user_id uuid,
  crm_user_id uuid,
  full_name text,
  ddd_prefix text,
  ddd_state text,
  ddd_region text,
  open_deals bigint,
  won_deals bigint,
  lost_deals bigint,
  received_deals bigint,
  rank_position bigint
)
language sql
security definer
set search_path = public
as $$
  with target as (
    select d.id, p.ddd_prefix, p.ddd_state
    from public.deals d
    left join public.people p on p.id = d.person_id
    where target_deal_id is not null and d.id = target_deal_id
    union all
    select null::uuid, null::text, null::text
    where target_deal_id is null
  ), eligible_users as (
    select
      cu.id as crm_user_id,
      cu.auth_user_id,
      cu.company_id,
      cu.full_name,
      cu.ddd_prefix,
      cu.ddd_state,
      cu.ddd_region
    from public.crm_users cu
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.company_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
      and coalesce(cu.permission, 'BPO') not in ('Admin', 'Teste')
      and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
  ), company_matches as (
    select
      eu.company_id,
      bool_or(eu.ddd_prefix = t.ddd_prefix) filter (where t.ddd_prefix is not null) as matches_ddd,
      bool_or(eu.ddd_state = t.ddd_state) filter (where t.ddd_state is not null) as matches_state
    from eligible_users eu
    cross join target t
    group by eu.company_id
  ), chosen_companies as (
    select company_id, 'ddd'::text as queue_type, 1 as queue_priority
    from company_matches
    where coalesce(matches_ddd, false)
    union all
    select company_id, 'estado'::text as queue_type, 2 as queue_priority
    from company_matches
    where coalesce(matches_state, false)
      and not exists (select 1 from company_matches where coalesce(matches_ddd, false))
    union all
    select company_id, 'geral'::text as queue_type, 3 as queue_priority
    from company_matches
    where not exists (select 1 from company_matches where coalesce(matches_ddd, false))
      and not exists (select 1 from company_matches where coalesce(matches_state, false))
  ), stats as (
    select
      cc.queue_type,
      t.ddd_prefix as deal_ddd_prefix,
      t.ddd_state as deal_ddd_state,
      eu.crm_user_id,
      eu.auth_user_id,
      eu.full_name,
      eu.ddd_prefix,
      eu.ddd_state,
      eu.ddd_region,
      (select count(*) from public.deals d where d.owner_id = eu.auth_user_id) as received_deals,
      (select count(*) from public.deals d where d.owner_id = eu.auth_user_id and (d.status = 'aberto' or d.status is null or d.status not in ('ganho', 'perdido'))) as open_deals,
      (select count(*) from public.deals d where d.owner_id = eu.auth_user_id and d.status = 'ganho') as won_deals,
      (select count(*) from public.deals d where d.owner_id = eu.auth_user_id and d.status = 'perdido') as lost_deals,
      cc.queue_priority
    from chosen_companies cc
    join eligible_users eu on eu.company_id = cc.company_id
    cross join target t
  )
  select
    s.queue_type,
    s.deal_ddd_prefix,
    s.deal_ddd_state,
    s.auth_user_id,
    s.crm_user_id,
    s.full_name,
    s.ddd_prefix,
    s.ddd_state,
    s.ddd_region,
    s.open_deals,
    s.won_deals,
    s.lost_deals,
    s.received_deals,
    row_number() over (partition by s.queue_type order by s.open_deals asc, s.received_deals asc, s.full_name asc) as rank_position
  from stats s
$$;

update public.automation_rules
set
  name = 'CRM BPO: distribuir leads por DDD/estado da empresa',
  description = 'Atribui leads sem proprietário respeitando a prioridade de localização: primeiro empresas com usuários elegíveis no mesmo DDD do contato, depois empresas com usuários elegíveis no mesmo estado, e por fim fila geral. Após escolher a empresa, entrega para o próximo usuário ativo elegível dessa empresa. Usuários Admin, Teste, desativados, deletados e contas de teste não participam da fila.',
  triggers = '[{"event":"deals.insert","condition":"owner_id is null"},{"event":"manual_run","function":"distribute_unassigned_leads"}]'::jsonb,
  filters = '[{"field":"deals.owner_id","operator":"is null"},{"field":"people.ddd_prefix/state","operator":"prioritize","value":"DDD, Estado, Geral"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"},{"field":"crm_users.permission","operator":"not in","value":["Admin","Teste"]},{"field":"crm_users.full_name/email","operator":"not contains","value":"aspalamar"}]'::jsonb,
  actions = '[{"action":"choose next crm_company matching lead DDD, else state, else general"},{"action":"choose next active non-admin non-test user inside selected company"},{"action":"set deals.owner_id"},{"action":"insert automation_rule_executions"}]'::jsonb,
  fields_involved = '["deals.owner_id","people.ddd_prefix","people.ddd_state","crm_users.company_id","crm_users.ddd_prefix","crm_users.ddd_state","lead_distribution_company_queue","lead_distribution_user_queue"]'::jsonb,
  implementation_refs = '[{"type":"sql_function","name":"public.next_lead_owner"},{"type":"sql_function","name":"public.next_lead_company_by_location"},{"type":"sql_function","name":"public.lead_distribution_queue_for_location"},{"type":"sql_function","name":"public.lead_distribution_candidate_stats"},{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"},{"type":"table","name":"public.lead_distribution_company_queue"},{"type":"table","name":"public.lead_distribution_user_queue"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'lead_distribution_round_robin';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'lead_distribution_round_robin',
  'implementation_changed',
  'Hermes',
  'Distribuição restaurou prioridade por DDD e estado, agora escolhendo empresas antes de usuários.',
  '{"strategy":"company_queue_by_ddd_then_state_then_general","user_selection":"inside_selected_company","excluded_permissions":["Admin","Teste"],"excluded_test_account":"aspalamar"}'::jsonb
);
