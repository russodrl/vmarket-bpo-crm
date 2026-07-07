-- Relink duplicate CRM contacts and organizations to a canonical row without deleting data.
-- This keeps historical duplicate rows for audit/safety, but all deals/activities point to one contact/company.

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

-- Organizations: canonical key is normalized company name.
with keyed as (
  select o.id,
         public.crm_bpo_normalize_key(o.name) as dedupe_key,
         exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'organization' and er.internal_id = o.id) as has_external,
         (select count(*) from public.deals d where d.organization_id = o.id) as deal_count,
         o.created_at
  from public.organizations o
  where public.crm_bpo_normalize_key(o.name) <> ''
), ranked as (
  select *, first_value(id) over (partition by dedupe_key order by deal_count desc, has_external desc, created_at asc nulls last, id asc) as keeper_id
  from keyed
), relink as (
  select id as duplicate_id, keeper_id from ranked where id <> keeper_id
)
update public.deals d
   set organization_id = r.keeper_id,
       updated_at = now()
  from relink r
 where d.organization_id = r.duplicate_id;

with keyed as (
  select o.id,
         public.crm_bpo_normalize_key(o.name) as dedupe_key,
         exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'organization' and er.internal_id = o.id) as has_external,
         (select count(*) from public.deals d where d.organization_id = o.id) as deal_count,
         o.created_at
  from public.organizations o
  where public.crm_bpo_normalize_key(o.name) <> ''
), ranked as (
  select *, first_value(id) over (partition by dedupe_key order by deal_count desc, has_external desc, created_at asc nulls last, id asc) as keeper_id
  from keyed
), relink as (
  select id as duplicate_id, keeper_id from ranked where id <> keeper_id
)
update public.people p
   set organization_id = r.keeper_id,
       updated_at = now()
  from relink r
 where p.organization_id = r.duplicate_id;

with keyed as (
  select o.id,
         public.crm_bpo_normalize_key(o.name) as dedupe_key,
         exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'organization' and er.internal_id = o.id) as has_external,
         (select count(*) from public.deals d where d.organization_id = o.id) as deal_count,
         o.created_at
  from public.organizations o
  where public.crm_bpo_normalize_key(o.name) <> ''
), ranked as (
  select *, first_value(id) over (partition by dedupe_key order by deal_count desc, has_external desc, created_at asc nulls last, id asc) as keeper_id
  from keyed
), relink as (
  select id as duplicate_id, keeper_id from ranked where id <> keeper_id
)
update public.activities a
   set organization_id = r.keeper_id,
       updated_at = now()
  from relink r
 where a.organization_id = r.duplicate_id;

-- People: canonical key is email when available, otherwise phone digits, otherwise normalized name.
with keyed as (
  select p.id,
         case
           when nullif(btrim(lower(p.email)), '') is not null then 'email:' || btrim(lower(p.email))
           when nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') is not null then 'phone:' || regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
           else 'name:' || public.crm_bpo_normalize_key(p.full_name)
         end as dedupe_key,
         exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'person' and er.internal_id = p.id) as has_external,
         (select count(*) from public.deals d where d.person_id = p.id) as deal_count,
         p.created_at
  from public.people p
  where nullif(btrim(lower(p.email)), '') is not null
     or nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') is not null
     or public.crm_bpo_normalize_key(p.full_name) <> ''
), ranked as (
  select *, first_value(id) over (partition by dedupe_key order by deal_count desc, has_external desc, created_at asc nulls last, id asc) as keeper_id
  from keyed
), relink as (
  select id as duplicate_id, keeper_id from ranked where id <> keeper_id
)
update public.deals d
   set person_id = r.keeper_id,
       updated_at = now()
  from relink r
 where d.person_id = r.duplicate_id;

with keyed as (
  select p.id,
         case
           when nullif(btrim(lower(p.email)), '') is not null then 'email:' || btrim(lower(p.email))
           when nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') is not null then 'phone:' || regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
           else 'name:' || public.crm_bpo_normalize_key(p.full_name)
         end as dedupe_key,
         exists(select 1 from public.external_records er where er.provider = 'pipedrive' and er.entity = 'person' and er.internal_id = p.id) as has_external,
         (select count(*) from public.deals d where d.person_id = p.id) as deal_count,
         p.created_at
  from public.people p
  where nullif(btrim(lower(p.email)), '') is not null
     or nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), '') is not null
     or public.crm_bpo_normalize_key(p.full_name) <> ''
), ranked as (
  select *, first_value(id) over (partition by dedupe_key order by deal_count desc, has_external desc, created_at asc nulls last, id asc) as keeper_id
  from keyed
), relink as (
  select id as duplicate_id, keeper_id from ranked where id <> keeper_id
)
update public.activities a
   set person_id = r.keeper_id,
       updated_at = now()
  from relink r
 where a.person_id = r.duplicate_id;

commit;
