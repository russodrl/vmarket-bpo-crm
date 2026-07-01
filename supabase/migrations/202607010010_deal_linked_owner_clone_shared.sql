-- Refine owner sync automation: if a linked contact/company is shared by deals from
-- different owners, clone the linked record for the current deal instead of stealing it
-- from the other owner's deal.

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
        'updated_people', updated_people
      )
    from public.automation_rules ar
    where ar.name = 'deal_linked_record_owner_sync'
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_deal_linked_record_owners_after_deal_change on public.deals;
drop trigger if exists sync_deal_linked_record_owners_before_deal_change on public.deals;
create trigger sync_deal_linked_record_owners_before_deal_change
before insert or update of owner_id, organization_id, person_id on public.deals
for each row
when (new.owner_id is not null)
execute function public.sync_deal_linked_record_owners();

update public.automation_rules
set
  description = 'Mantém o mesmo proprietário CRM no negócio, contato e empresa vinculados. Se contato ou empresa estiverem compartilhados por negócios de outros proprietários, a automação clona o registro vinculado para preservar a atribuição de cada negócio.',
  actions = '["clone shared linked organizations when owners differ","clone shared linked people when owners differ","update organizations.owner_id from deals.owner_id","update people.owner_id from deals.owner_id","record automation_rule_executions"]'::jsonb,
  implementation_refs = '["supabase/migrations/202607010009_deal_linked_owner_sync.sql","supabase/migrations/202607010010_deal_linked_owner_clone_shared.sql","public.sync_deal_linked_record_owners","trigger sync_deal_linked_record_owners_before_deal_change"]'::jsonb,
  updated_at = now()
where name = 'deal_linked_record_owner_sync';

insert into public.automation_rule_changes (rule_id, change_type, summary, after_snapshot, created_at)
select
  ar.id,
  'implementation_changed',
  'A automação passou a clonar contato/empresa compartilhados quando há negócios de proprietários diferentes, evitando que um negócio roube o contato/empresa de outro proprietário.',
  jsonb_build_object('trigger', 'sync_deal_linked_record_owners_before_deal_change', 'clone_shared_records', true),
  now()
from public.automation_rules ar
where ar.name = 'deal_linked_record_owner_sync';

-- Backfill remaining conflicts by re-saving mismatched deals. The BEFORE trigger clones
-- shared records when necessary and updates simple owner mismatches directly.
update public.deals d
   set updated_at = now()
 where d.owner_id is not null
   and (
     exists (select 1 from public.organizations o where o.id = d.organization_id and o.owner_id is distinct from d.owner_id)
     or exists (select 1 from public.people p where p.id = d.person_id and p.owner_id is distinct from d.owner_id)
   );
