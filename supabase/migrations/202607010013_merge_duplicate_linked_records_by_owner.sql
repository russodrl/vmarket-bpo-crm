-- Merge duplicate CRM BPO contacts and companies within the same final owner.
-- The final owner is the owner of the linked deal when a unique deal owner exists, otherwise the record owner.

begin;

create or replace function public.crm_bpo_normalize_key(value text)
returns text
language sql
immutable
as $$
  select btrim(regexp_replace(lower(
    translate(coalesce(value, ''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'
    )),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

-- Sync owner from linked deals only when all linked deals for that record point to the same owner.
with org_owner as (
  select organization_id, (array_agg(owner_id))[1] as owner_id
  from public.deals
  where organization_id is not null and owner_id is not null
  group by organization_id
  having count(distinct owner_id) = 1
)
update public.organizations o
   set owner_id = oo.owner_id,
       updated_at = now()
  from org_owner oo
 where o.id = oo.organization_id
   and o.owner_id is distinct from oo.owner_id;

with person_owner as (
  select person_id, (array_agg(owner_id))[1] as owner_id
  from public.deals
  where person_id is not null and owner_id is not null
  group by person_id
  having count(distinct owner_id) = 1
)
update public.people p
   set owner_id = po.owner_id,
       updated_at = now()
  from person_owner po
 where p.id = po.person_id
   and p.owner_id is distinct from po.owner_id;

-- Merge duplicate organizations by normalized name + owner.
do $$
declare
  grp record;
  keeper uuid;
  remove_id uuid;
  merged_groups integer := 0;
  removed_records integer := 0;
begin
  for grp in
    with keyed as (
      select o.id,
             public.crm_bpo_normalize_key(o.name) as key,
             o.owner_id,
             exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'organization' and er.internal_id = o.id) as has_external,
             (select count(*) from public.deals d where d.organization_id = o.id) as deal_count,
             o.created_at
      from public.organizations o
      where public.crm_bpo_normalize_key(o.name) <> ''
    )
    select key, owner_id, array_agg(id order by has_external desc, deal_count desc, created_at asc nulls last, id asc) as ids
    from keyed
    group by key, owner_id
    having count(*) > 1
  loop
    keeper := grp.ids[1];
    merged_groups := merged_groups + 1;

    foreach remove_id in array grp.ids[2:array_length(grp.ids, 1)] loop
      update public.organizations k
         set segment = coalesce(k.segment, r.segment),
             city = coalesce(k.city, r.city),
             state = coalesce(k.state, r.state),
             cnpjs = coalesce(k.cnpjs, r.cnpjs),
             monthly_purchase = coalesce(k.monthly_purchase, r.monthly_purchase),
             supplier_count = coalesce(k.supplier_count, r.supplier_count),
             bpo_id = coalesce(k.bpo_id, r.bpo_id),
             owner_id = coalesce(k.owner_id, r.owner_id),
             type = coalesce(k.type, r.type),
             updated_at = now()
        from public.organizations r
       where k.id = keeper and r.id = remove_id;

      update public.deals set organization_id = keeper, updated_at = now() where organization_id = remove_id;
      update public.people set organization_id = keeper, updated_at = now() where organization_id = remove_id;
      update public.activities set organization_id = keeper, updated_at = now() where organization_id = remove_id;

      if exists(select 1 from public.external_records where provider = 'pipedrive' and entity = 'organization' and internal_id = keeper) then
        delete from public.external_records where provider = 'pipedrive' and entity = 'organization' and internal_id = remove_id;
      else
        update public.external_records set internal_id = keeper, updated_at = now() where provider = 'pipedrive' and entity = 'organization' and internal_id = remove_id;
      end if;

      delete from public.organizations where id = remove_id;
      removed_records := removed_records + 1;
    end loop;
  end loop;

  raise notice 'Merged organization duplicate groups: %, removed records: %', merged_groups, removed_records;
end $$;

-- Merge duplicate people by email if present, otherwise phone digits, otherwise normalized name, within same owner.
do $$
declare
  grp record;
  keeper uuid;
  remove_id uuid;
  merged_groups integer := 0;
  removed_records integer := 0;
begin
  for grp in
    with keyed as (
      select p.id,
             case
               when nullif(btrim(lower(p.email)), '') is not null then 'email:' || btrim(lower(p.email))
               when nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') is not null then 'phone:' || regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
               else 'name:' || public.crm_bpo_normalize_key(p.full_name)
             end as key,
             p.owner_id,
             exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'person' and er.internal_id = p.id) as has_external,
             (select count(*) from public.deals d where d.person_id = p.id) as deal_count,
             p.created_at
      from public.people p
      where public.crm_bpo_normalize_key(p.full_name) <> ''
         or nullif(btrim(lower(p.email)), '') is not null
         or nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') is not null
    )
    select key, owner_id, array_agg(id order by has_external desc, deal_count desc, created_at asc nulls last, id asc) as ids
    from keyed
    where key not in ('name:')
    group by key, owner_id
    having count(*) > 1
  loop
    keeper := grp.ids[1];
    merged_groups := merged_groups + 1;

    foreach remove_id in array grp.ids[2:array_length(grp.ids, 1)] loop
      update public.people k
         set role_title = coalesce(k.role_title, r.role_title),
             email = coalesce(k.email, r.email),
             phone = coalesce(k.phone, r.phone),
             organization_id = coalesce(k.organization_id, r.organization_id),
             labels = case
               when k.labels is null then r.labels
               when r.labels is null then k.labels
               else array(select distinct unnest(k.labels || r.labels))
             end,
             bpo_id = coalesce(k.bpo_id, r.bpo_id),
             owner_id = coalesce(k.owner_id, r.owner_id),
             ddd_prefix = coalesce(k.ddd_prefix, r.ddd_prefix),
             ddd_state = coalesce(k.ddd_state, r.ddd_state),
             ddd_region = coalesce(k.ddd_region, r.ddd_region),
             updated_at = now()
        from public.people r
       where k.id = keeper and r.id = remove_id;

      update public.deals set person_id = keeper, updated_at = now() where person_id = remove_id;
      update public.activities set person_id = keeper, updated_at = now() where person_id = remove_id;

      if exists(select 1 from public.external_records where provider = 'pipedrive' and entity = 'person' and internal_id = keeper) then
        delete from public.external_records where provider = 'pipedrive' and entity = 'person' and internal_id = remove_id;
      else
        update public.external_records set internal_id = keeper, updated_at = now() where provider = 'pipedrive' and entity = 'person' and internal_id = remove_id;
      end if;

      delete from public.people where id = remove_id;
      removed_records := removed_records + 1;
    end loop;
  end loop;

  raise notice 'Merged people duplicate groups: %, removed records: %', merged_groups, removed_records;
end $$;

commit;
