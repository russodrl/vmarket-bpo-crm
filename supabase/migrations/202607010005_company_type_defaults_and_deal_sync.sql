-- Default company type to restaurante and mirror company type into deal type fields.
-- Company type is the source of truth, so remove the previous deal-to-company type mirror.

drop trigger if exists sync_organization_type_from_deal_after_write on public.deals;

update public.organizations
set type = 'restaurante', updated_at = now()
where type is null;

update public.deals d
set business_type = coalesce(o.type, 'restaurante'),
    vm_product_type = coalesce(o.type, 'restaurante'),
    updated_at = now()
from public.organizations o
where d.organization_id = o.id
  and (d.business_type is distinct from coalesce(o.type, 'restaurante')
       or d.vm_product_type is distinct from coalesce(o.type, 'restaurante'));

create or replace function public.default_organization_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.type is null then
    new.type := 'restaurante';
  end if;
  return new;
end;
$$;

drop trigger if exists default_organization_type_before_write on public.organizations;
create trigger default_organization_type_before_write
before insert or update of type on public.organizations
for each row
execute function public.default_organization_type();

create or replace function public.sync_deal_type_from_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.deals d
  set business_type = coalesce(new.type, 'restaurante'),
      vm_product_type = coalesce(new.type, 'restaurante'),
      updated_at = now()
  where d.organization_id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_deal_type_after_organization_type on public.organizations;
create trigger sync_deal_type_after_organization_type
after insert or update of type on public.organizations
for each row
execute function public.sync_deal_type_from_organization();

create or replace function public.sync_deal_type_on_organization_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  org_type text;
begin
  if new.organization_id is null then
    return new;
  end if;
  select coalesce(type, 'restaurante') into org_type
  from public.organizations
  where id = new.organization_id;
  if org_type is not null then
    new.business_type := org_type;
    new.vm_product_type := org_type;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_deal_type_before_deal_org_link on public.deals;
create trigger sync_deal_type_before_deal_org_link
before insert or update of organization_id on public.deals
for each row
execute function public.sync_deal_type_on_organization_link();
