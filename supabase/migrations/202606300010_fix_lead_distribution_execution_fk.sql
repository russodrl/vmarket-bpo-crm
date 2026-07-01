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
  for rec in select id, title from public.deals where owner_id is null order by created_at, id loop
    assigned := public.next_lead_owner();
    exit when assigned is null;
    update public.deals set owner_id = assigned, updated_at = now() where id = rec.id;
    changed := changed + 1;
    insert into public.automation_rule_executions (rule_id, status, trigger_system, trigger_type, record_entity, internal_id, external_id, started_at, finished_at, changed_fields, filters_evaluated, actions_performed, details)
    values (rule_id, 'success', 'CRM BPO', 'manual_run distribute_unassigned_leads', 'deal', rec.id, rec.id::text, now(), now(), '["deals.owner_id"]'::jsonb, jsonb_build_array(jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true)), '["assigned lead owner"]'::jsonb, jsonb_build_object('deal_id', rec.id, 'deal_title', rec.title, 'assigned_owner_id', assigned));
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
  rule_id text := 'lead_distribution_round_robin';
begin
  if new.owner_id is null then
    assigned := public.next_lead_owner();
    if assigned is not null then
      new.owner_id := assigned;
      insert into public.automation_rule_executions (rule_id, status, trigger_system, trigger_type, record_entity, internal_id, external_id, started_at, finished_at, changed_fields, filters_evaluated, actions_performed, details)
      values (rule_id, 'success', 'CRM BPO', 'deals.insert owner_id null', 'deal', new.id, new.id::text, now(), now(), '["deals.owner_id"]'::jsonb, jsonb_build_array(jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true)), '["assigned lead owner"]'::jsonb, jsonb_build_object('deal_id', new.id, 'deal_title', new.title, 'assigned_owner_id', assigned));
    end if;
  end if;
  return new;
end;
$$;
