-- Exclude the Aspalamar test user from assignment rules, redistribute invalid owners,
-- and merge duplicate contacts/companies within the same final owner.

create or replace function public.crm_assignment_user_is_test(full_name text, email text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(full_name, '') || ' ' || coalesce(email, '')) like '%aspalamar%'
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
      and not public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
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

create or replace function public.distribute_invalid_deal_owners()
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
    select d.id, d.title, d.owner_id, cu.full_name as old_owner_name, cu.status as old_owner_status
    from public.deals d
    left join public.crm_users cu on cu.auth_user_id = d.owner_id
    where d.owner_id is null
       or cu.id is null
       or cu.status in ('deleted', 'disabled')
       or public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
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
      rule_id, 'success', 'CRM BPO', 'manual_run distribute_invalid_deal_owners',
      'deal', rec.id, rec.id::text, now(), now(), '["deals.owner_id"]'::jsonb,
      jsonb_build_array(jsonb_build_object('field', 'owner_id', 'expected', 'null/invalid/deleted/disabled/test', 'actual', rec.owner_id, 'result', true)),
      '["assigned valid lead owner", "excluded test user aspalamar"]'::jsonb,
      jsonb_build_object('deal_id', rec.id, 'deal_title', rec.title, 'old_owner_id', rec.owner_id, 'old_owner_name', rec.old_owner_name, 'old_owner_status', rec.old_owner_status, 'assigned_owner_id', assigned)
    );
  end loop;

  return changed;
end;
$$;

create or replace function public.distribute_unassigned_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.distribute_invalid_deal_owners();
end;
$$;

create or replace function public.crm_merge_key(value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(lower(trim(coalesce(value, ''))), '[^a-z0-9áàãâéêíóõôúç]+', '', 'g'), '')
$$;

create or replace function public.merge_duplicate_organizations_by_owner()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  grp record;
  keep_id uuid;
  loser_id uuid;
  merged integer := 0;
begin
  for grp in
    select public.crm_merge_key(name) as merge_key, owner_id
    from public.organizations
    where public.crm_merge_key(name) is not null
    group by 1, owner_id
    having count(*) > 1
  loop
    select o.id into keep_id
    from public.organizations o
    where public.crm_merge_key(o.name) = grp.merge_key
      and o.owner_id is not distinct from grp.owner_id
    order by
      (select count(*) from public.deals d where d.organization_id = o.id) desc,
      (select count(*) from public.people p where p.organization_id = o.id) desc,
      (select count(*) from public.external_records er where er.provider = 'pipedrive' and er.entity = 'organization' and er.internal_id = o.id) desc,
      o.updated_at desc,
      o.created_at desc,
      o.id
    limit 1;

    for loser_id in
      select o.id
      from public.organizations o
      where public.crm_merge_key(o.name) = grp.merge_key
        and o.owner_id is not distinct from grp.owner_id
        and o.id <> keep_id
    loop
      update public.organizations k
         set segment = coalesce(k.segment, l.segment),
             type = coalesce(k.type, l.type),
             city = coalesce(k.city, l.city),
             state = coalesce(k.state, l.state),
             cnpjs = coalesce(k.cnpjs, l.cnpjs),
             monthly_purchase = coalesce(k.monthly_purchase, l.monthly_purchase),
             supplier_count = coalesce(k.supplier_count, l.supplier_count),
             bpo_id = coalesce(k.bpo_id, l.bpo_id),
             updated_at = now()
      from public.organizations l
      where k.id = keep_id and l.id = loser_id;

      delete from public.custom_field_values loser
      using public.custom_field_values kept
      where loser.entity_id = loser_id
        and kept.entity_id = keep_id
        and kept.field_id = loser.field_id;
      update public.custom_field_values set entity_id = keep_id, updated_at = now() where entity_id = loser_id;

      delete from public.external_records loser
      using public.external_records kept
      where loser.provider = kept.provider
        and loser.entity = kept.entity
        and loser.entity = 'organization'
        and loser.internal_id = loser_id
        and kept.internal_id = keep_id;
      update public.external_records set internal_id = keep_id, updated_at = now() where entity = 'organization' and internal_id = loser_id;

      update public.people set organization_id = keep_id, updated_at = now() where organization_id = loser_id;
      update public.deals set organization_id = keep_id, updated_at = now() where organization_id = loser_id;
      update public.activities set organization_id = keep_id, updated_at = now() where organization_id = loser_id;
      delete from public.organizations where id = loser_id;
      merged := merged + 1;
    end loop;
  end loop;
  return merged;
end;
$$;

create or replace function public.merge_duplicate_people_by_owner()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  grp record;
  keep_id uuid;
  loser_id uuid;
  merged integer := 0;
begin
  for grp in
    select public.crm_merge_key(full_name) as merge_key, owner_id
    from public.people
    where public.crm_merge_key(full_name) is not null
    group by 1, owner_id
    having count(*) > 1
  loop
    select p.id into keep_id
    from public.people p
    where public.crm_merge_key(p.full_name) = grp.merge_key
      and p.owner_id is not distinct from grp.owner_id
    order by
      (select count(*) from public.deals d where d.person_id = p.id) desc,
      (select count(*) from public.external_records er where er.provider = 'pipedrive' and er.entity = 'person' and er.internal_id = p.id) desc,
      p.updated_at desc,
      p.created_at desc,
      p.id
    limit 1;

    for loser_id in
      select p.id
      from public.people p
      where public.crm_merge_key(p.full_name) = grp.merge_key
        and p.owner_id is not distinct from grp.owner_id
        and p.id <> keep_id
    loop
      update public.people k
         set role_title = coalesce(k.role_title, l.role_title),
             email = coalesce(k.email, l.email),
             phone = coalesce(k.phone, l.phone),
             organization_id = coalesce(k.organization_id, l.organization_id),
             labels = coalesce(nullif(k.labels, '{}'::text[]), l.labels, '{}'::text[]),
             bpo_id = coalesce(k.bpo_id, l.bpo_id),
             ddd_prefix = coalesce(k.ddd_prefix, l.ddd_prefix),
             ddd_state = coalesce(k.ddd_state, l.ddd_state),
             ddd_region = coalesce(k.ddd_region, l.ddd_region),
             updated_at = now()
      from public.people l
      where k.id = keep_id and l.id = loser_id;

      delete from public.custom_field_values loser
      using public.custom_field_values kept
      where loser.entity_id = loser_id
        and kept.entity_id = keep_id
        and kept.field_id = loser.field_id;
      update public.custom_field_values set entity_id = keep_id, updated_at = now() where entity_id = loser_id;

      delete from public.external_records loser
      using public.external_records kept
      where loser.provider = kept.provider
        and loser.entity = kept.entity
        and loser.entity = 'person'
        and loser.internal_id = loser_id
        and kept.internal_id = keep_id;
      update public.external_records set internal_id = keep_id, updated_at = now() where entity = 'person' and internal_id = loser_id;

      update public.deals set person_id = keep_id, updated_at = now() where person_id = loser_id;
      update public.activities set person_id = keep_id, updated_at = now() where person_id = loser_id;
      delete from public.people where id = loser_id;
      merged := merged + 1;
    end loop;
  end loop;
  return merged;
end;
$$;

update public.automation_rules
set
  description = 'Atribui leads sem proprietário ou com proprietário inválido/deletado/desativado para parceiros ativos, excluindo o usuário de teste Aspalamar.',
  filters = '[{"field":"deals.owner_id","operator":"is null or invalid/deleted/disabled/test"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"},{"field":"crm_users.full_name/email","operator":"not contains","value":"aspalamar"}]'::jsonb,
  actions = '[{"action":"set deals.owner_id","strategy":"round-robin by current deal count"},{"action":"exclude test user aspalamar"},{"action":"insert automation_rule_executions","details":"deal and assigned owner"}]'::jsonb,
  implementation_refs = '[{"type":"sql_function","name":"public.distribute_invalid_deal_owners"},{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_function","name":"public.next_lead_owner"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"}]'::jsonb,
  updated_at = now()
where id = 'lead_distribution_round_robin';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values ('lead_distribution_round_robin', 'implementation_changed', 'Hermes', 'Excluído usuário de teste Aspalamar da regra de distribuição e ampliada redistribuição para owner inválido/deletado/desativado.', '{"excluded_user":"aspalamar","function":"public.distribute_invalid_deal_owners"}'::jsonb);
