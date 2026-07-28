-- Add local pipeline for BPO-originated deals that generate direct commission.

with new_stages(name, sort_order, color, deal_probability) as (
  values
    ('Novo Negócio', 42, '#8b5cf6', 20),
    ('Proposta Enviada', 43, '#8b5cf6', 50),
    ('Contrato Enviado', 44, '#8b5cf6', 75),
    ('Contrato Assinado', 45, '#8b5cf6', 95),
    ('Ganho', 46, '#8b5cf6', 100)
)
insert into public.pipeline_stages (
  name,
  sort_order,
  color,
  pipeline_name,
  deal_probability,
  is_pipedrive_replica
)
select
  ns.name,
  ns.sort_order,
  ns.color,
  'Negocios Próprios BPO',
  ns.deal_probability,
  false
from new_stages ns
where not exists (
  select 1
  from public.pipeline_stages existing
  where existing.pipeline_name = 'Negocios Próprios BPO'
    and existing.name = ns.name
);
