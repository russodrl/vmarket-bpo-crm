-- Ensure CRM BPO has all Pipedrive lead fields shown in the supplier lead card.
-- These fields are synced from Pipedrive deal custom fields into public.custom_field_values.

with desired(entity, name, field_type, options, sort_order, pipedrive_key, pipedrive_field_type, pipedrive_id, pipedrive_options) as (
  values
    (
      'deal',
      'Origem do Lead',
      'single_option'::public.field_type,
      array['Meta Ads','Indicação','BPO','Prospecção Comercial','Site VMarket','Parcerias','Google Ads','Novos CNPJs Base','Feiras - Eventos','Influencer','ChatGPT']::text[],
      46,
      '35b7d222715476c8b0267d90a76ee7ccf65cb7b6',
      'enum',
      12485,
      '[{"id":114,"label":"Meta Ads"},{"id":27,"label":"Indicação"},{"id":274,"label":"BPO"},{"id":25,"label":"Prospecção Comercial"},{"id":24,"label":"Site VMarket"},{"id":26,"label":"Parcerias"},{"id":94,"label":"Google Ads"},{"id":23,"label":"Novos CNPJs Base"},{"id":32,"label":"Feiras - Eventos"},{"id":233,"label":"Influencer"},{"id":278,"label":"ChatGPT"}]'::jsonb
    ),
    (
      'deal',
      'Estado',
      'single_option'::public.field_type,
      array['Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia','Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins','Distrito Federal','Distrito Federal/Goiás']::text[],
      47,
      'afc28ad710ac0f144f69fddab33ee686695ad967',
      'enum',
      12487,
      '[{"id":34,"label":"Acre"},{"id":35,"label":"Alagoas"},{"id":36,"label":"Amapá"},{"id":37,"label":"Amazonas"},{"id":38,"label":"Bahia"},{"id":39,"label":"Ceará"},{"id":40,"label":"Espírito Santo"},{"id":41,"label":"Goiás"},{"id":42,"label":"Maranhão"},{"id":43,"label":"Mato Grosso"},{"id":44,"label":"Mato Grosso do Sul"},{"id":45,"label":"Minas Gerais"},{"id":46,"label":"Pará"},{"id":47,"label":"Paraíba"},{"id":48,"label":"Paraná"},{"id":49,"label":"Pernambuco"},{"id":50,"label":"Piauí"},{"id":51,"label":"Rio de Janeiro"},{"id":52,"label":"Rio Grande do Norte"},{"id":53,"label":"Rio Grande do Sul"},{"id":54,"label":"Rondônia"},{"id":55,"label":"Roraima"},{"id":56,"label":"Santa Catarina"},{"id":57,"label":"São Paulo"},{"id":58,"label":"Sergipe"},{"id":59,"label":"Tocantins"},{"id":60,"label":"Distrito Federal"},{"id":275,"label":"Distrito Federal/Goiás"}]'::jsonb
    ),
    ('deal','Tipo de estabelecimento','text'::public.field_type,array[]::text[],48,'b5f8384335673360a4c562ebc8dec13b23a51279','varchar',12593,'[]'::jsonb),
    ('deal','Quantos CNPJs?','text'::public.field_type,array[]::text[],49,'2d85a69bb070d2ad8db81959127fe906c92b9521','varchar',12574,'[]'::jsonb),
    ('deal','Quanto compram de insumos por mês?','text'::public.field_type,array[]::text[],50,'a59111b5743a72db4b684230b59122487fd5a752','varchar',12594,'[]'::jsonb),
    ('deal','Quais categorias de produtos fornece?','text'::public.field_type,array[]::text[],51,'950d51f781336cbd31f3aaaa8dac5b54141cb27b','varchar',12579,'[]'::jsonb),
    ('deal','Qual região atende?','text'::public.field_type,array[]::text[],52,'3a6292e42a3f28d9921d8f19b9bc5d4d690806c5','varchar',12580,'[]'::jsonb)
), updated as (
  update public.custom_fields cf
  set name = d.name,
      field_type = d.field_type,
      options = d.options,
      sort_order = d.sort_order,
      pipedrive_key = d.pipedrive_key,
      pipedrive_field_type = d.pipedrive_field_type,
      pipedrive_id = d.pipedrive_id,
      pipedrive_options = d.pipedrive_options
  from desired d
  where cf.entity = d.entity
    and (cf.pipedrive_key = d.pipedrive_key or cf.name = d.name)
  returning cf.id, cf.pipedrive_key
)
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
select d.entity,
       d.name,
       d.field_type,
       d.options,
       d.sort_order,
       d.pipedrive_key,
       d.pipedrive_field_type,
       d.pipedrive_id,
       d.pipedrive_options
from desired d
where not exists (
  select 1
  from public.custom_fields cf
  where cf.entity = d.entity
    and (cf.pipedrive_key = d.pipedrive_key or cf.name = d.name)
);
