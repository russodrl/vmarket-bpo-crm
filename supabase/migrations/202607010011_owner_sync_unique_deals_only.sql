-- Refine linked owner sync: skip possible duplicate deals and only run for unique
-- deals. When duplicate deals are merged, the UI re-saves the kept deal after the
-- duplicate is deleted, so the same trigger runs once the deal is unique.

create or replace function public.deal_duplicate_key(value text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      lower(
        translate(
          coalesce(value, ''),
          'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
          'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
        )
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    ),
    ''
  )
$$;

create or replace function public.deal_has_duplicate(p_deal_id uuid, p_title text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deals d
    where d.id is distinct from p_deal_id
      and public.deal_duplicate_key(d.title) = public.deal_duplicate_key(p_title)
  )
$$;

create or replace function public.sync_deal_linked_record_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_organization_id uuid := new.organization_id;
  old_person_id uuid := new.person_id;
  cloned_organization_id uuid;
  cloned_person_id uuid;
  changed_fields jsonb := '[]'::jsonb;
  updated_orgs integer := 0;
  updated_people integer := 0;
begin
  if new.owner_id is null then
    return new;
  end if;

  -- Do not apply this automation while the deal is part of a possible duplicate
  -- group. The duplicate merge flow deletes the extra deal first, then re-saves
  -- the kept deal so this trigger runs only when the kept deal is unique.
  if public.deal_has_duplicate(case when tg_op = 'INSERT' then null else new.id end, new.title) then
    insert into public.automation_rule_executions (
      rule_id,
      status,
      trigger_system,
      trigger_type,
      record_entity,
      internal_id,
      started_at,
      finished_at,
      changed_fields,
      actions_performed,
      details
    )
    select
      ar.id,
      'ignored',
      'PostgreSQL',
      'database_trigger',
      'deal',
      new.id,
      now(),
      now(),
      '[]'::jsonb,
      '["skip linked owner sync because deal has possible duplicates"]'::jsonb,
      jsonb_build_object(
        'deal_id', new.id,
        'deal_title', new.title,
        'duplicate_key', public.deal_duplicate_key(new.title),
        'reason', 'possible_duplicate_deal'
      )
    from public.automation_rules ar
    where ar.name = 'deal_linked_record_owner_sync'
    limit 1;

    return new;
  end if;

  if new.organization_id is not null and exists (
    select 1
    from public.deals d
    where d.organization_id = new.organization_id
      and d.owner_id is not null
      and d.owner_id is distinct from new.owner_id
      and (tg_op = 'INSERT' or d.id is distinct from new.id)
  ) then
    insert into public.organizations (
      id, name, segment, city, state, cnpjs, monthly_purchase, supplier_count,
      bpo_id, owner_id, created_at, updated_at, type
    )
    select
      gen_random_uuid(), name, segment, city, state, cnpjs, monthly_purchase, supplier_count,
      bpo_id, new.owner_id, now(), now(), type
    from public.organizations
    where id = new.organization_id
    returning id into cloned_organization_id;

    if cloned_organization_id is not null then
      new.organization_id := cloned_organization_id;
      changed_fields := changed_fields || '["deals.organization_id","organizations.owner_id"]'::jsonb;
    end if;
  end if;

  if new.person_id is not null and exists (
    select 1
    from public.deals d
    where d.person_id = new.person_id
      and d.owner_id is not null
      and d.owner_id is distinct from new.owner_id
      and (tg_op = 'INSERT' or d.id is distinct from new.id)
  ) then
    insert into public.people (
      id, full_name, role_title, email, phone, organization_id, labels,
      bpo_id, owner_id, created_at, updated_at, ddd_prefix, ddd_state, ddd_region
    )
    select
      gen_random_uuid(), full_name, role_title, email, phone,
      case when organization_id = old_organization_id then new.organization_id else organization_id end,
      labels, bpo_id, new.owner_id, now(), now(), ddd_prefix, ddd_state, ddd_region
    from public.people
    where id = new.person_id
    returning id into cloned_person_id;

    if cloned_person_id is not null then
      new.person_id := cloned_person_id;
      changed_fields := changed_fields || '["deals.person_id","people.owner_id"]'::jsonb;
    end if;
  end if;

  if new.organization_id is not null then
    update public.organizations
       set owner_id = new.owner_id,
           updated_at = now()
     where id = new.organization_id
       and owner_id is distinct from new.owner_id;
    get diagnostics updated_orgs = row_count;
    if updated_orgs > 0 and not (changed_fields ? 'organizations.owner_id') then
      changed_fields := changed_fields || '["organizations.owner_id"]'::jsonb;
    end if;
  end if;

  if new.person_id is not null then
    update public.people
       set owner_id = new.owner_id,
           organization_id = case when organization_id = old_organization_id then new.organization_id else organization_id end,
           updated_at = now()
     where id = new.person_id
       and (owner_id is distinct from new.owner_id or (old_organization_id is not null and organization_id = old_organization_id and new.organization_id is distinct from old_organization_id));
    get diagnostics updated_people = row_count;
    if updated_people > 0 and not (changed_fields ? 'people.owner_id') then
      changed_fields := changed_fields || '["people.owner_id"]'::jsonb;
    end if;
  end if;

  if jsonb_array_length(changed_fields) > 0 then
    insert into public.automation_rule_executions (
      rule_id,
      status,
      trigger_system,
      trigger_type,
      record_entity,
      internal_id,
      started_at,
      finished_at,
      changed_fields,
      actions_performed,
      details
    )
    select
      ar.id,
      'success',
      'PostgreSQL',
      'database_trigger',
      'deal',
      new.id,
      now(),
      now(),
      changed_fields,
      jsonb_build_array('sync linked organization owner', 'sync linked person owner', 'clone shared linked records when needed'),
      jsonb_build_object(
        'deal_id', new.id,
        'deal_owner_id', new.owner_id,
        'old_organization_id', old_organization_id,
        'new_organization_id', new.organization_id,
        'old_person_id', old_person_id,
        'new_person_id', new.person_id,
        'updated_organizations', updated_orgs,
        'updated_people', updated_people,
        'duplicate_key', public.deal_duplicate_key(new.title)
      )
    from public.automation_rules ar
    where ar.name = 'deal_linked_record_owner_sync'
    limit 1;
  end if;

  return new;
end;
$$;

update public.automation_rules
set
  description = 'Mantém o mesmo proprietário CRM no negócio único, contato e empresa vinculados. Se houver possível duplicata de negócio pelo título normalizado, a automação não altera contato/empresa. Depois da mesclagem, o negócio mantido é salvo novamente e a automação roda quando ele se torna único.',
  filters = '["deals.owner_id is not null","deal title is unique after normalization"]'::jsonb,
  actions = '["skip when possible duplicate deal exists","clone shared linked organizations when owners differ","clone shared linked people when owners differ","update organizations.owner_id from deals.owner_id","update people.owner_id from deals.owner_id","record automation_rule_executions"]'::jsonb,
  implementation_refs = '["supabase/migrations/202607010009_deal_linked_owner_sync.sql","supabase/migrations/202607010010_deal_linked_owner_clone_shared.sql","supabase/migrations/202607010011_owner_sync_unique_deals_only.sql","public.sync_deal_linked_record_owners","public.deal_has_duplicate","trigger sync_deal_linked_record_owners_before_deal_change"]'::jsonb,
  updated_at = now()
where name = 'deal_linked_record_owner_sync';

insert into public.automation_rule_changes (rule_id, change_type, summary, after_snapshot, created_at)
select
  ar.id,
  'implementation_changed',
  'A automação passou a ignorar negócios com possível duplicata pelo título normalizado e a rodar apenas quando o negócio estiver único, incluindo após a mesclagem de duplicatas.',
  jsonb_build_object('unique_deals_only', true, 'duplicate_key_function', 'public.deal_duplicate_key', 'merge_flow_resaves_kept_deal', true),
  now()
from public.automation_rules ar
where ar.name = 'deal_linked_record_owner_sync';
