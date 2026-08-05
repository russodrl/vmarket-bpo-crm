-- Map Pipedrive lead fields into CRM BPO native fields and keep the CRM label aligned.
-- Pipedrive deal field 12593: "Qual tipo do seu estabelecimento?"
-- Pipedrive deal field 12487: "Estado"

update public.custom_fields
set name = 'Tipo de estabelecimento',
    pipedrive_key = 'b5f8384335673360a4c562ebc8dec13b23a51279',
    pipedrive_field_type = 'varchar',
    pipedrive_id = 12593
where entity = 'deal'
  and (name = 'Tipo de estabelecimento' or name = 'Qual tipo do seu estabelecimento?' or pipedrive_key = 'b5f8384335673360a4c562ebc8dec13b23a51279');

insert into public.custom_fields (
  entity,
  name,
  field_type,
  options,
  sort_order,
  pipedrive_key,
  pipedrive_field_type,
  pipedrive_id,
  pipedrive_options
)
select
  'deal',
  'Tipo de estabelecimento',
  'text',
  array[]::text[],
  45,
  'b5f8384335673360a4c562ebc8dec13b23a51279',
  'varchar',
  12593,
  '[]'::jsonb
where not exists (
  select 1 from public.custom_fields
  where entity = 'deal'
    and (name = 'Tipo de estabelecimento' or pipedrive_key = 'b5f8384335673360a4c562ebc8dec13b23a51279')
);

update public.custom_fields
set name = 'Estado',
    pipedrive_key = 'afc28ad710ac0f144f69fddab33ee686695ad967',
    pipedrive_field_type = 'enum',
    pipedrive_id = 12487,
    options = array[
      'Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Espírito Santo','Goiás',
      'Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba',
      'Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul',
      'Rondônia','Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins','Distrito Federal',
      'Distrito Federal/Goiás'
    ],
    pipedrive_options = '[
      {"id":34,"label":"Acre"},{"id":35,"label":"Alagoas"},{"id":36,"label":"Amapá"},
      {"id":37,"label":"Amazonas"},{"id":38,"label":"Bahia"},{"id":39,"label":"Ceará"},
      {"id":40,"label":"Espírito Santo"},{"id":41,"label":"Goiás"},{"id":42,"label":"Maranhão"},
      {"id":43,"label":"Mato Grosso"},{"id":44,"label":"Mato Grosso do Sul"},{"id":45,"label":"Minas Gerais"},
      {"id":46,"label":"Pará"},{"id":47,"label":"Paraíba"},{"id":48,"label":"Paraná"},
      {"id":49,"label":"Pernambuco"},{"id":50,"label":"Piauí"},{"id":51,"label":"Rio de Janeiro"},
      {"id":52,"label":"Rio Grande do Norte"},{"id":53,"label":"Rio Grande do Sul"},{"id":54,"label":"Rondônia"},
      {"id":55,"label":"Roraima"},{"id":56,"label":"Santa Catarina"},{"id":57,"label":"São Paulo"},
      {"id":58,"label":"Sergipe"},{"id":59,"label":"Tocantins"},{"id":60,"label":"Distrito Federal"},
      {"id":275,"label":"Distrito Federal/Goiás"}
    ]'::jsonb
where entity = 'deal'
  and (name = 'Estado' or pipedrive_key = 'afc28ad710ac0f144f69fddab33ee686695ad967');
