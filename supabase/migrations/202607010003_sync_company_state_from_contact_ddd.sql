-- Keep organization state aligned with the contact DDD state while preserving manual edits.

create or replace function public.sync_organization_state_from_contact_ddd(target_deal_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
begin
  with targets as (
    select d.organization_id, p.ddd_state
    from public.deals d
    join public.people p on p.id = d.person_id
    where d.organization_id is not null
      and p.ddd_state is not null
      and (target_deal_id is null or d.id = target_deal_id)
  ), updated as (
    update public.organizations o
    set state = t.ddd_state,
        updated_at = now()
    from targets t
    where o.id = t.organization_id
      and (o.state is null or o.state = '' or o.state is distinct from t.ddd_state)
    returning o.id
  )
  select count(*) into changed from updated;

  return changed;
end;
$$;

create or replace function public.trigger_sync_organization_state_from_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_organization_state_from_contact_ddd(new.id);
  return new;
end;
$$;

drop trigger if exists sync_organization_state_after_deal_contact_change on public.deals;
create trigger sync_organization_state_after_deal_contact_change
after insert or update of person_id, organization_id on public.deals
for each row execute function public.trigger_sync_organization_state_from_deal();

create or replace function public.trigger_sync_organization_state_from_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.organizations o
  set state = new.ddd_state,
      updated_at = now()
  from public.deals d
  where d.person_id = new.id
    and d.organization_id = o.id
    and new.ddd_state is not null
    and (o.state is null or o.state = '' or o.state is distinct from new.ddd_state);
  return new;
end;
$$;

drop trigger if exists sync_organization_state_after_person_ddd_change on public.people;
create trigger sync_organization_state_after_person_ddd_change
after insert or update of ddd_state on public.people
for each row execute function public.trigger_sync_organization_state_from_person();

select public.sync_organization_state_from_contact_ddd(null);

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'company_state_from_contact_ddd',
  'CRM BPO: preencher estado da empresa pelo DDD do contato',
  'active',
  'CRM BPO',
  'CRM BPO',
  'Banco de dados CRM',
  'Contato/negócio com DDD estado preenchido',
  'Preenche o campo Estado da empresa a partir do DDD Estado do contato vinculado ao negócio. O campo permanece editável na ficha.',
  '[{"event":"deals.insert/update person_id organization_id"},{"event":"people.ddd_state.update"},{"event":"manual_run","function":"sync_organization_state_from_contact_ddd"}]'::jsonb,
  '[{"field":"people.ddd_state","operator":"is not empty"},{"field":"deals.organization_id","operator":"is not empty"}]'::jsonb,
  '[{"action":"set organizations.state from people.ddd_state"}]'::jsonb,
  '["organizations.state","people.ddd_state","deals.person_id","deals.organization_id"]'::jsonb,
  '[{"type":"sql_function","name":"public.sync_organization_state_from_contact_ddd"},{"type":"sql_trigger","name":"sync_organization_state_after_deal_contact_change"},{"type":"sql_trigger","name":"sync_organization_state_after_person_ddd_change"}]'::jsonb
)
on conflict (id) do update set name = excluded.name, status = excluded.status, source_system = excluded.source_system, target_system = excluded.target_system, trigger_system = excluded.trigger_system, trigger_type = excluded.trigger_type, description = excluded.description, triggers = excluded.triggers, filters = excluded.filters, actions = excluded.actions, fields_involved = excluded.fields_involved, implementation_refs = excluded.implementation_refs, updated_by = 'Hermes', updated_at = now();

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values ('company_state_from_contact_ddd', 'created', 'Hermes', 'Registrada automação para preencher Estado da empresa pelo DDD Estado do contato.', '{"fields":["organizations.state","people.ddd_state"]}'::jsonb);
