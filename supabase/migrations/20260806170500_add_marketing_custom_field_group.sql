-- Cria o grupo lógico Marketing para campos configuráveis de negócio vindos do Pipedrive.
-- A integração de novos leads já usa custom_fields.pipedrive_key em pipedrive-sync; esta migration garante
-- que os campos de Marketing existam, estejam agrupados e preservem os IDs/keys do Pipedrive.

select set_config('request.jwt.claim.role', 'service_role', false);

alter table public.custom_fields
  add column if not exists field_group text;

with marketing_fields(entity, name, field_type, options, sort_order, pipedrive_key, pipedrive_field_type, pipedrive_id, field_group) as (
  values
    ('deal', 'Origem do Lead', 'single_option'::public.field_type, '{}'::text[], 46, '35b7d222715476c8b0267d90a76ee7ccf65cb7b6', 'enum', 12485, 'Marketing'),
    ('deal', 'Indicação Cliente', 'organization_ref'::public.field_type, '{}'::text[], 50, '0d76e61d157a4b729b92915bbf3c8c8ea4856ec6', 'org', 12584, 'Marketing'),
    ('deal', 'Indicação Externa', 'single_option'::public.field_type, '{}'::text[], 51, '5e64c9f820adb78f8b2925fee4bbdd27f9fba91d', 'enum', 12540, 'Marketing'),
    ('deal', 'Source origin', 'single_option'::public.field_type, '{}'::text[], 53, 'origin', 'enum', 12504, 'Marketing'),
    ('deal', 'Source origin ID', 'text'::public.field_type, '{}'::text[], 54, 'origin_id', 'varchar', 12505, 'Marketing'),
    ('deal', 'Source channel', 'single_option'::public.field_type, '{}'::text[], 55, 'channel', 'enum', 12506, 'Marketing'),
    ('deal', 'Source channel ID', 'text'::public.field_type, '{}'::text[], 56, 'channel_id', 'varchar', 12507, 'Marketing'),
    ('deal', 'utm_source', 'text'::public.field_type, '{}'::text[], 57, 'f1b6bc80290b31d0e223d727964db76027d3827d', 'varchar', 12496, 'Marketing'),
    ('deal', 'utm_medium', 'text'::public.field_type, '{}'::text[], 58, '8a44f21e6cf324156d48fe4c823857e2d7fd2ec5', 'varchar', 12497, 'Marketing'),
    ('deal', 'utm_campaing', 'text'::public.field_type, '{}'::text[], 59, '1392f5b92106c5c53f27c23db70e91e525025a9e', 'varchar', 12498, 'Marketing'),
    ('deal', 'utm_content', 'text'::public.field_type, '{}'::text[], 60, 'e5d47239621e9988dcefbad16b3a8ae0d99d667c', 'varchar', 12499, 'Marketing'),
    ('deal', 'utm_term', 'text'::public.field_type, '{}'::text[], 61, 'ab03d4443e21d00227e9f010440718a8dc2ac21a', 'varchar', 12500, 'Marketing')
), existing_options as (
  select mf.*, cf.options as current_options, cf.pipedrive_options as current_pipedrive_options
  from marketing_fields mf
  left join public.custom_fields cf
    on cf.entity = mf.entity
   and (cf.pipedrive_key = mf.pipedrive_key or cf.name = mf.name)
), updated as (
  update public.custom_fields cf
  set
    name = eo.name,
    field_type = eo.field_type,
    options = coalesce(nullif(cf.options, '{}'::text[]), eo.options),
    sort_order = eo.sort_order,
    pipedrive_key = eo.pipedrive_key,
    pipedrive_field_type = eo.pipedrive_field_type,
    pipedrive_id = eo.pipedrive_id,
    field_group = eo.field_group
  from existing_options eo
  where cf.entity = eo.entity
    and (cf.pipedrive_key = eo.pipedrive_key or cf.name = eo.name)
  returning cf.id, cf.name, cf.pipedrive_key, cf.pipedrive_id, cf.field_group
), inserted as (
  insert into public.custom_fields (entity, name, field_type, options, sort_order, pipedrive_key, pipedrive_field_type, pipedrive_id, pipedrive_options, field_group)
  select eo.entity, eo.name, eo.field_type, eo.options, eo.sort_order, eo.pipedrive_key, eo.pipedrive_field_type, eo.pipedrive_id, '[]'::jsonb, eo.field_group
  from existing_options eo
  where not exists (
    select 1 from public.custom_fields cf
    where cf.entity = eo.entity
      and (cf.pipedrive_key = eo.pipedrive_key or cf.name = eo.name)
  )
  returning id, name, pipedrive_key, pipedrive_id, field_group
)
insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'pipedrive_deal_webhook_to_crm',
  'implementation_changed',
  'Hermes',
  'Campos de Marketing do Pipedrive agrupados no CRM BPO e preparados para importação automática em novos leads.',
  jsonb_build_object(
    'field_group', 'Marketing',
    'updated_fields', (select count(*) from updated),
    'inserted_fields', (select count(*) from inserted),
    'fields', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (select * from updated union all select * from inserted) x), '[]'::jsonb),
    'new_leads_integration', 'pipedrive-sync imports any custom_fields row with pipedrive_key into custom_field_values'
  )
);
