-- Add synchronized business type, partner value, and normalize filling source labels.

alter table public.deals
  add column if not exists business_type text check (business_type in ('restaurante', 'hotel', 'fornecedor')),
  add column if not exists partner_value numeric(14,2);

alter table public.organizations
  add column if not exists type text check (type in ('restaurante', 'hotel', 'fornecedor'));

update public.deals
set business_type = coalesce(business_type, vm_product_type)
where business_type is null and vm_product_type is not null;

update public.deals
set vm_product_type = business_type
where business_type is not null and (vm_product_type is distinct from business_type);

update public.organizations o
set type = d.business_type
from public.deals d
where d.organization_id = o.id
  and d.business_type is not null
  and o.type is distinct from d.business_type;

update public.deals
set source = case
  when source = 'Pipedrive API' then 'Pipedrive API'
  when source ilike '%make%' then 'Make'
  when source ilike '%automat%' then 'Automação CRM'
  when source ilike '%import%' then 'Importação'
  when source is null or source = '' then 'Importação'
  else 'Manual'
end;

update public.deals
set partner_value = coalesce(
  (select sum(coalesce(nullif(value->>'value', '')::numeric, 0))
   from jsonb_each(coalesce(partner_services, '{}'::jsonb))
   where coalesce(nullif(value->>'selected', '')::boolean, false)),
  0
)
where partner_value is null;

create or replace function public.sync_deal_business_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_type is null and new.vm_product_type is not null then
    new.business_type := new.vm_product_type;
  end if;

  if new.business_type is not null then
    new.vm_product_type := new.business_type;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_deal_business_type_before_write on public.deals;
create trigger sync_deal_business_type_before_write
before insert or update of business_type, vm_product_type on public.deals
for each row execute function public.sync_deal_business_type();

create or replace function public.sync_organization_type_from_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is not null and new.business_type is not null then
    update public.organizations
    set type = new.business_type, updated_at = now()
    where id = new.organization_id
      and type is distinct from new.business_type;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_organization_type_from_deal_after_write on public.deals;
create trigger sync_organization_type_from_deal_after_write
after insert or update of business_type, organization_id on public.deals
for each row execute function public.sync_organization_type_from_deal();

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'deal_type_sync',
  'CRM BPO: sincronizar tipo do negócio com contrato e empresa',
  'active',
  'CRM BPO',
  'CRM BPO',
  'CRM BPO',
  'insert/update deals.business_type',
  'Quando o campo Tipo do negócio é preenchido, sincroniza o mesmo tipo com o tipo do contrato VMarket e com o tipo da empresa vinculada.',
  '[{"table":"deals","event":"insert/update","field":"business_type"}]'::jsonb,
  '[{"field":"deals.business_type","operator":"is_not_null"}]'::jsonb,
  '[{"table":"deals","field":"vm_product_type","action":"set to deals.business_type"},{"table":"organizations","field":"type","action":"set to deals.business_type"}]'::jsonb,
  '["deals.business_type","deals.vm_product_type","organizations.type"]'::jsonb,
  '[{"migration":"202607010001_deal_type_values_source_display.sql","functions":["public.sync_deal_business_type","public.sync_organization_type_from_deal"]}]'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  status = excluded.status,
  source_system = excluded.source_system,
  target_system = excluded.target_system,
  trigger_system = excluded.trigger_system,
  trigger_type = excluded.trigger_type,
  description = excluded.description,
  triggers = excluded.triggers,
  filters = excluded.filters,
  actions = excluded.actions,
  fields_involved = excluded.fields_involved,
  implementation_refs = excluded.implementation_refs,
  updated_at = now();

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'deal_type_sync',
  'created',
  'Hermes',
  'Registrada automação de sincronização do Tipo entre negócio, contrato e empresa.',
  '{"fields":["deals.business_type","deals.vm_product_type","organizations.type"]}'::jsonb
);
