-- DDD enrichment for CRM users and lead distribution queues by DDD, state, then general fallback.

alter table public.crm_users
  add column if not exists ddd_prefix text,
  add column if not exists ddd_state text,
  add column if not exists ddd_region text;

create or replace function public.enrich_crm_user_ddd(target_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
begin
  with resolved as (
    select
      cu.id,
      public.extract_br_ddd(cu.crm_phone) as prefix
    from public.crm_users cu
    where target_user_id is null or cu.id = target_user_id
  ), final_values as (
    select r.id, r.prefix, d.state, d.region
    from resolved r
    left join public.ddd_prefixes d on d.prefix = r.prefix
  ), updated as (
    update public.crm_users cu
    set ddd_prefix = f.prefix,
        ddd_state = f.state,
        ddd_region = f.region,
        updated_at = now()
    from final_values f
    where cu.id = f.id
      and f.prefix is not null
      and (cu.ddd_prefix is distinct from f.prefix or cu.ddd_state is distinct from f.state or cu.ddd_region is distinct from f.region)
    returning cu.id
  )
  select count(*) into changed from updated;

  return changed;
end;
$$;

create or replace function public.trigger_enrich_crm_user_ddd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enrich_crm_user_ddd(new.id);
  return new;
end;
$$;

drop trigger if exists enrich_crm_user_ddd_after_phone on public.crm_users;
create trigger enrich_crm_user_ddd_after_phone
after insert or update of crm_phone on public.crm_users
for each row execute function public.trigger_enrich_crm_user_ddd();

select public.enrich_crm_user_ddd(null);

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
  ), candidates as (
    select
      cu.id as crm_user_id,
      cu.auth_user_id,
      cu.full_name,
      cu.ddd_prefix,
      cu.ddd_state,
      cu.ddd_region
    from public.crm_users cu
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
  ), stats as (
    select
      c.*,
      (select count(*) from public.deals d where d.owner_id = c.auth_user_id) as received_deals,
      (select count(*) from public.deals d where d.owner_id = c.auth_user_id and d.status = 'aberto') as open_deals,
      (select count(*) from public.deals d where d.owner_id = c.auth_user_id and d.status = 'ganho') as won_deals,
      (select count(*) from public.deals d where d.owner_id = c.auth_user_id and d.status = 'perdido') as lost_deals
    from candidates c
  ), ddd_queue as (
    select
      'ddd'::text as queue_type,
      t.ddd_prefix as deal_ddd_prefix,
      t.ddd_state as deal_ddd_state,
      s.*
    from stats s
    join target t on t.ddd_prefix is not null and s.ddd_prefix = t.ddd_prefix
  ), state_queue as (
    select
      'estado'::text as queue_type,
      t.ddd_prefix as deal_ddd_prefix,
      t.ddd_state as deal_ddd_state,
      s.*
    from stats s
    join target t on t.ddd_state is not null and s.ddd_state = t.ddd_state
    where not exists (select 1 from ddd_queue)
  ), general_queue as (
    select
      'geral'::text as queue_type,
      t.ddd_prefix as deal_ddd_prefix,
      t.ddd_state as deal_ddd_state,
      s.*
    from stats s
    left join target t on true
    where target_deal_id is null or (
      not exists (select 1 from ddd_queue)
      and not exists (select 1 from state_queue)
    )
  ), chosen_queue as (
    select * from ddd_queue
    union all select * from state_queue
    union all select * from general_queue
  )
  select
    q.queue_type,
    q.deal_ddd_prefix,
    q.deal_ddd_state,
    q.auth_user_id,
    q.crm_user_id,
    q.full_name,
    q.ddd_prefix,
    q.ddd_state,
    q.ddd_region,
    q.open_deals,
    q.won_deals,
    q.lost_deals,
    q.received_deals,
    row_number() over (partition by q.queue_type order by q.open_deals asc, q.won_deals desc, q.received_deals asc, q.full_name asc) as rank_position
  from chosen_queue q
$$;

create or replace function public.next_lead_owner_by_location(deal_prefix text default null, deal_state text default null)
returns uuid
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select
      cu.auth_user_id,
      cu.full_name,
      cu.ddd_prefix,
      cu.ddd_state,
      (select count(*) from public.deals d where d.owner_id = cu.auth_user_id and d.status = 'aberto') as open_deals,
      (select count(*) from public.deals d where d.owner_id = cu.auth_user_id and d.status = 'ganho') as won_deals,
      (select count(*) from public.deals d where d.owner_id = cu.auth_user_id) as received_deals
    from public.crm_users cu
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
  ), selected as (
    select *, 1 as queue_priority from candidates where deal_prefix is not null and ddd_prefix = deal_prefix
    union all
    select *, 2 as queue_priority from candidates
      where deal_state is not null and ddd_state = deal_state
        and not exists (select 1 from candidates where deal_prefix is not null and ddd_prefix = deal_prefix)
    union all
    select *, 3 as queue_priority from candidates
      where not exists (select 1 from candidates where deal_prefix is not null and ddd_prefix = deal_prefix)
        and not exists (select 1 from candidates where deal_state is not null and ddd_state = deal_state)
  )
  select auth_user_id
  from selected
  order by queue_priority, open_deals asc, won_deals desc, received_deals asc, full_name asc
  limit 1
$$;

create or replace function public.lead_distribution_queue_for_location(deal_prefix text default null, deal_state text default null)
returns text
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select cu.ddd_prefix, cu.ddd_state
    from public.crm_users cu
    left join public.profiles p on p.id = cu.auth_user_id
    where cu.auth_user_id is not null
      and cu.status = 'active'
      and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
  )
  select case
    when deal_prefix is not null and exists (select 1 from candidates where ddd_prefix = deal_prefix) then 'ddd'
    when deal_state is not null and exists (select 1 from candidates where ddd_state = deal_state) then 'estado'
    else 'geral'
  end
$$;

create or replace function public.next_lead_owner(target_deal_id uuid default null)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public.next_lead_owner_by_location(p.ddd_prefix, p.ddd_state)
  from public.deals d
  left join public.people p on p.id = d.person_id
  where target_deal_id is not null and d.id = target_deal_id
  union all
  select public.next_lead_owner_by_location(null, null)
  where target_deal_id is null
  limit 1
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
    order by d.created_at, d.id
  loop
    assigned := public.next_lead_owner_by_location(rec.ddd_prefix, rec.ddd_state);
    queue := coalesce(public.lead_distribution_queue_for_location(rec.ddd_prefix, rec.ddd_state), 'geral');
    exit when assigned is null;

    update public.deals set owner_id = assigned, updated_at = now() where id = rec.id;
    changed := changed + 1;

    insert into public.automation_rule_executions (rule_id, status, trigger_system, trigger_type, record_entity, internal_id, external_id, started_at, finished_at, changed_fields, filters_evaluated, actions_performed, details)
    values (
      rule_id,
      'success',
      'CRM BPO',
      'manual_run distribute_unassigned_leads',
      'deal',
      rec.id,
      rec.id::text,
      now(),
      now(),
      '["deals.owner_id"]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true),
        jsonb_build_object('field','people.ddd_prefix','actual',rec.ddd_prefix,'queue',queue),
        jsonb_build_object('field','people.ddd_state','actual',rec.ddd_state,'queue',queue)
      ),
      jsonb_build_array('assigned lead owner by ' || queue || ' queue'),
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
      perform public.enrich_person_ddd(new.person_id);
      select p.ddd_prefix, p.ddd_state into deal_prefix, deal_state
      from public.people p
      where p.id = new.person_id;
    end if;

    assigned := public.next_lead_owner_by_location(deal_prefix, deal_state);
    queue := coalesce(public.lead_distribution_queue_for_location(deal_prefix, deal_state), 'geral');

    if assigned is not null then
      new.owner_id := assigned;
      insert into public.automation_rule_executions (rule_id, status, trigger_system, trigger_type, record_entity, internal_id, external_id, started_at, finished_at, changed_fields, filters_evaluated, actions_performed, details)
      values (
        rule_id,
        'success',
        'CRM BPO',
        'deals.insert owner_id null',
        'deal',
        new.id,
        new.id::text,
        now(),
        now(),
        '["deals.owner_id"]'::jsonb,
        jsonb_build_array(
          jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true),
          jsonb_build_object('field','people.ddd_prefix','actual',deal_prefix,'queue',queue),
          jsonb_build_object('field','people.ddd_state','actual',deal_state,'queue',queue)
        ),
        jsonb_build_array('assigned lead owner by ' || queue || ' queue'),
        jsonb_build_object('deal_id', new.id, 'deal_title', new.title, 'assigned_owner_id', assigned, 'queue_type', queue, 'deal_ddd_prefix', deal_prefix, 'deal_ddd_state', deal_state)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_lead_owner_before_insert on public.deals;
create trigger assign_lead_owner_before_insert
before insert on public.deals
for each row execute function public.assign_lead_owner_on_insert();

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'lead_distribution_round_robin',
  'CRM BPO: distribuir leads por DDD, estado e fila geral',
  'active',
  'CRM BPO/Pipedrive',
  'CRM BPO',
  'Banco de dados CRM',
  'Novo negócio sem owner_id / execução manual de redistribuição',
  'Atribui novos leads sem proprietário, inclusive os criados pela automação Pipedrive, usando primeiro a fila de mesmo DDD, depois mesmo estado e por fim fila geral. Dentro de cada fila prioriza quem tem menos leads abertos e, em empate, quem tem mais negócios ganhos.',
  '[{"event":"deals.insert","condition":"owner_id is null","source":"Pipedrive API or CRM"},{"event":"manual_run","function":"distribute_unassigned_leads"}]'::jsonb,
  '[{"field":"deals.owner_id","operator":"is null"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"}]'::jsonb,
  '[{"queue":"ddd","condition":"crm_users.ddd_prefix = people.ddd_prefix","order":"open_deals asc, won_deals desc"},{"queue":"estado","condition":"crm_users.ddd_state = people.ddd_state","order":"open_deals asc, won_deals desc"},{"queue":"geral","condition":"fallback","order":"open_deals asc, won_deals desc"},{"action":"set deals.owner_id"},{"action":"insert automation_rule_executions"}]'::jsonb,
  '["deals.owner_id","people.ddd_prefix","people.ddd_state","crm_users.ddd_prefix","crm_users.ddd_state","deals.status"]'::jsonb,
  '[{"type":"sql_function","name":"public.next_lead_owner"},{"type":"sql_function","name":"public.lead_distribution_candidate_stats"},{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"}]'::jsonb
)
on conflict (id) do update set name = excluded.name, status = excluded.status, source_system = excluded.source_system, target_system = excluded.target_system, trigger_system = excluded.trigger_system, trigger_type = excluded.trigger_type, description = excluded.description, triggers = excluded.triggers, filters = excluded.filters, actions = excluded.actions, fields_involved = excluded.fields_involved, implementation_refs = excluded.implementation_refs, updated_by = 'Hermes', updated_at = now();

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'crm_user_ddd_enrichment',
  'CRM BPO: enriquecer DDD de usuários por telefone de registro',
  'active',
  'CRM BPO',
  'CRM BPO',
  'Banco de dados CRM',
  'Usuário criado/telefone CRM alterado',
  'Preenche Prefixo, Estado e Região do grupo DDD do usuário, extraindo o DDD do telefone de registro e consultando a base DDD.',
  '[{"event":"crm_users.insert"},{"event":"crm_users.crm_phone.update"},{"event":"manual_run","function":"enrich_crm_user_ddd"}]'::jsonb,
  '[{"field":"crm_users.crm_phone","operator":"is not empty"}]'::jsonb,
  '[{"action":"derive ddd_prefix"},{"action":"lookup ddd_prefixes"},{"action":"set crm_users.ddd_prefix/state/region"}]'::jsonb,
  '["crm_users.crm_phone","crm_users.ddd_prefix","crm_users.ddd_state","crm_users.ddd_region"]'::jsonb,
  '[{"type":"sql_function","name":"public.enrich_crm_user_ddd"},{"type":"sql_trigger","name":"enrich_crm_user_ddd_after_phone"}]'::jsonb
)
on conflict (id) do update set name = excluded.name, status = excluded.status, source_system = excluded.source_system, target_system = excluded.target_system, trigger_system = excluded.trigger_system, trigger_type = excluded.trigger_type, description = excluded.description, triggers = excluded.triggers, filters = excluded.filters, actions = excluded.actions, fields_involved = excluded.fields_involved, implementation_refs = excluded.implementation_refs, updated_by = 'Hermes', updated_at = now();

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values
  ('lead_distribution_round_robin', 'updated', 'Hermes', 'Atualizada distribuição de leads para filas por DDD, estado e geral com desempate por negócios ganhos.', '{"queues":["ddd","estado","geral"],"tie_breakers":["open_deals asc","won_deals desc"]}'::jsonb),
  ('crm_user_ddd_enrichment', 'created', 'Hermes', 'Registrada automação de enriquecimento de DDD de usuários.', '{"fields":["crm_users.ddd_prefix","crm_users.ddd_state","crm_users.ddd_region"]}'::jsonb);
