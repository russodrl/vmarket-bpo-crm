-- Keep linked company/contact ownership synchronized with the deal owner.
-- If a deal is assigned to a user, its linked organization and person must carry the same owner_id.

create or replace function public.sync_deal_linked_record_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_fields jsonb := '[]'::jsonb;
  updated_orgs integer := 0;
  updated_people integer := 0;
begin
  if new.owner_id is null then
    return new;
  end if;

  if new.organization_id is not null then
    update public.organizations
       set owner_id = new.owner_id,
           updated_at = now()
     where id = new.organization_id
       and owner_id is distinct from new.owner_id;
    get diagnostics updated_orgs = row_count;
    if updated_orgs > 0 then
      changed_fields := changed_fields || '["organizations.owner_id"]'::jsonb;
    end if;
  end if;

  if new.person_id is not null then
    update public.people
       set owner_id = new.owner_id,
           updated_at = now()
     where id = new.person_id
       and owner_id is distinct from new.owner_id;
    get diagnostics updated_people = row_count;
    if updated_people > 0 then
      changed_fields := changed_fields || '["people.owner_id"]'::jsonb;
    end if;
  end if;

  if jsonb_array_length(changed_fields) > 0 then
    insert into public.automation_rule_executions (
      rule_id,
      status,
      started_at,
      finished_at,
      changed_fields,
      actions_performed,
      details
    )
    select
      ar.id,
      'success',
      now(),
      now(),
      changed_fields,
      jsonb_build_array('sync linked organization owner', 'sync linked person owner'),
      jsonb_build_object(
        'deal_id', new.id,
        'deal_owner_id', new.owner_id,
        'organization_id', new.organization_id,
        'person_id', new.person_id,
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
create trigger sync_deal_linked_record_owners_after_deal_change
after insert or update of owner_id, organization_id, person_id on public.deals
for each row
when (new.owner_id is not null)
execute function public.sync_deal_linked_record_owners();

update public.automation_rules
set
  source_system = 'CRM BPO',
  target_system = 'CRM BPO',
  trigger_type = 'database_trigger',
  description = 'Mantém o mesmo proprietário CRM no negócio, contato e empresa vinculados. Quando o negócio recebe ou troca owner_id, o contato e a empresa vinculados são atualizados para o mesmo usuário.',
  triggers = '[{"event":"deals.insert"},{"event":"deals.update owner_id"},{"event":"deals.update organization_id"},{"event":"deals.update person_id"},{"event":"manual_backfill"}]'::jsonb,
  filters = '[{"field":"deals.owner_id","operator":"is not empty"},{"field":"deals.organization_id/person_id","operator":"is not empty"},{"field":"linked owner_id","operator":"is distinct from deals.owner_id"}]'::jsonb,
  actions = '["update organizations.owner_id from deals.owner_id","update people.owner_id from deals.owner_id","record automation_rule_executions"]'::jsonb,
  fields_involved = '["deals.owner_id","deals.organization_id","deals.person_id","organizations.owner_id","people.owner_id"]'::jsonb,
  implementation_refs = '["supabase/migrations/202607010009_deal_linked_owner_sync.sql","public.sync_deal_linked_record_owners","trigger sync_deal_linked_record_owners_after_deal_change"]'::jsonb,
  status = 'active',
  updated_at = now()
where name = 'deal_linked_record_owner_sync';

insert into public.automation_rules (
  id,
  name,
  source_system,
  target_system,
  trigger_system,
  trigger_type,
  description,
  triggers,
  filters,
  actions,
  fields_involved,
  implementation_refs,
  status,
  created_at,
  updated_at
)
select
  'deal_linked_record_owner_sync',
  'deal_linked_record_owner_sync',
  'CRM BPO',
  'CRM BPO',
  'PostgreSQL',
  'database_trigger',
  'Mantém o mesmo proprietário CRM no negócio, contato e empresa vinculados. Quando o negócio recebe ou troca owner_id, o contato e a empresa vinculados são atualizados para o mesmo usuário.',
  '[{"event":"deals.insert"},{"event":"deals.update owner_id"},{"event":"deals.update organization_id"},{"event":"deals.update person_id"},{"event":"manual_backfill"}]'::jsonb,
  '[{"field":"deals.owner_id","operator":"is not empty"},{"field":"deals.organization_id/person_id","operator":"is not empty"},{"field":"linked owner_id","operator":"is distinct from deals.owner_id"}]'::jsonb,
  '["update organizations.owner_id from deals.owner_id","update people.owner_id from deals.owner_id","record automation_rule_executions"]'::jsonb,
  '["deals.owner_id","deals.organization_id","deals.person_id","organizations.owner_id","people.owner_id"]'::jsonb,
  '["supabase/migrations/202607010009_deal_linked_owner_sync.sql","public.sync_deal_linked_record_owners","trigger sync_deal_linked_record_owners_after_deal_change"]'::jsonb,
  'active',
  now(),
  now()
where not exists (select 1 from public.automation_rules where name = 'deal_linked_record_owner_sync');

insert into public.automation_rule_changes (rule_id, change_type, summary, after_snapshot, created_at)
select
  ar.id,
  'updated',
  'Criada automação para sincronizar proprietário de contato e empresa vinculados com o proprietário do negócio.',
  jsonb_build_object('changed_fields', '["deals.owner_id","organizations.owner_id","people.owner_id"]'::jsonb),
  now()
from public.automation_rules ar
where ar.name = 'deal_linked_record_owner_sync';

with org_updates as (
  update public.organizations o
     set owner_id = d.owner_id,
         updated_at = now()
    from public.deals d
   where d.organization_id = o.id
     and d.owner_id is not null
     and o.owner_id is distinct from d.owner_id
   returning d.id as deal_id, o.id as organization_id, d.owner_id
), person_updates as (
  update public.people p
     set owner_id = d.owner_id,
         updated_at = now()
    from public.deals d
   where d.person_id = p.id
     and d.owner_id is not null
     and p.owner_id is distinct from d.owner_id
   returning d.id as deal_id, p.id as person_id, d.owner_id
), summary as (
  select
    (select count(*) from org_updates) as updated_organizations,
    (select count(*) from person_updates) as updated_people
)
insert into public.automation_rule_executions (
  rule_id,
  status,
  started_at,
  finished_at,
  changed_fields,
  actions_performed,
  details
)
select
  ar.id,
  'success',
  now(),
  now(),
  '["organizations.owner_id","people.owner_id"]'::jsonb,
  '["manual backfill existing linked organizations","manual backfill existing linked people"]'::jsonb,
  jsonb_build_object('updated_organizations', summary.updated_organizations, 'updated_people', summary.updated_people)
from public.automation_rules ar
cross join summary
where ar.name = 'deal_linked_record_owner_sync';
