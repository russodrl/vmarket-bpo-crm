-- Prevent external syncs or incomplete form saves from erasing visible CRM identity fields.
-- If an existing record has a meaningful value, an UPDATE that tries to replace it with
-- blank/NULL keeps the old value instead of making the deal/company/contact disappear.

create or replace function public.preserve_non_empty_crm_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'deals' then
    if nullif(old.title, '') is not null and nullif(new.title, '') is null then
      new.title := old.title;
    end if;
  elsif tg_table_name = 'organizations' then
    if nullif(old.name, '') is not null and nullif(new.name, '') is null then
      new.name := old.name;
    end if;
  elsif tg_table_name = 'people' then
    if nullif(old.full_name, '') is not null and nullif(new.full_name, '') is null then
      new.full_name := old.full_name;
    end if;
    if nullif(old.email, '') is not null and nullif(new.email, '') is null then
      new.email := old.email;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_deal_identity_fields on public.deals;
create trigger preserve_deal_identity_fields
before update of title on public.deals
for each row execute function public.preserve_non_empty_crm_identity_fields();

drop trigger if exists preserve_organization_identity_fields on public.organizations;
create trigger preserve_organization_identity_fields
before update of name on public.organizations
for each row execute function public.preserve_non_empty_crm_identity_fields();

drop trigger if exists preserve_person_identity_fields on public.people;
create trigger preserve_person_identity_fields
before update of full_name, email on public.people
for each row execute function public.preserve_non_empty_crm_identity_fields();

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'preserve_crm_identity_fields',
  'CRM BPO: preservar campos de identificação contra vazio',
  'active',
  'CRM BPO/Pipedrive',
  'CRM BPO',
  'Banco de dados CRM',
  'Atualização de negócio, empresa ou contato',
  'Impede que atualizações incompletas de ficha ou sincronizações externas apaguem título de negócio, nome de empresa, nome de contato ou email existente.',
  '[{"event":"deals.update.title"},{"event":"organizations.update.name"},{"event":"people.update.full_name/email"}]'::jsonb,
  '[{"field":"old value","operator":"is not empty"},{"field":"new value","operator":"is empty"}]'::jsonb,
  '[{"action":"keep old non-empty value"}]'::jsonb,
  '["deals.title","organizations.name","people.full_name","people.email"]'::jsonb,
  '[{"type":"sql_function","name":"public.preserve_non_empty_crm_identity_fields"},{"type":"sql_trigger","name":"preserve_deal_identity_fields"},{"type":"sql_trigger","name":"preserve_organization_identity_fields"},{"type":"sql_trigger","name":"preserve_person_identity_fields"}]'::jsonb
)
on conflict (id) do update set name = excluded.name, status = excluded.status, source_system = excluded.source_system, target_system = excluded.target_system, trigger_system = excluded.trigger_system, trigger_type = excluded.trigger_type, description = excluded.description, triggers = excluded.triggers, filters = excluded.filters, actions = excluded.actions, fields_involved = excluded.fields_involved, implementation_refs = excluded.implementation_refs, updated_by = 'Hermes', updated_at = now();

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'preserve_crm_identity_fields',
  'created',
  'Hermes',
  'Impede que atualização incompleta ou sync externo substitua título do negócio, nome da empresa, nome do contato ou email existente por vazio.',
  '{"tables":["deals","organizations","people"],"fields":["deals.title","organizations.name","people.full_name","people.email"],"behavior":"preserve old non-empty value when update sends blank/null"}'::jsonb
)
on conflict do nothing;
