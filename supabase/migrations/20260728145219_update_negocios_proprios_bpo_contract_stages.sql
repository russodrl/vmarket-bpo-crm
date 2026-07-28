-- Update local BPO-owned deals pipeline so Won only comes after the VMarketing contract is signed.

with desired_stages(sort_order, name, deal_probability) as (
  values
    (42, 'Contrato BPO Enviado', 35),
    (43, 'Contrato BPO Assinado', 55),
    (44, 'Contrato VMarketing Enviado', 75),
    (45, 'Contrato VMarketing Assinado', 95),
    (46, 'Ganho', 100)
)
update public.pipeline_stages ps
set
  name = desired_stages.name,
  deal_probability = desired_stages.deal_probability,
  color = '#8b5cf6',
  is_pipedrive_replica = false,
  pipedrive_stage_id = null,
  pipedrive_pipeline_id = null
from desired_stages
where ps.pipeline_name = 'Negocios Próprios BPO'
  and ps.sort_order = desired_stages.sort_order;

with desired_stages(sort_order, name, deal_probability) as (
  values
    (42, 'Contrato BPO Enviado', 35),
    (43, 'Contrato BPO Assinado', 55),
    (44, 'Contrato VMarketing Enviado', 75),
    (45, 'Contrato VMarketing Assinado', 95),
    (46, 'Ganho', 100)
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
  desired_stages.name,
  desired_stages.sort_order,
  '#8b5cf6',
  'Negocios Próprios BPO',
  desired_stages.deal_probability,
  false
from desired_stages
where not exists (
  select 1
  from public.pipeline_stages ps
  where ps.pipeline_name = 'Negocios Próprios BPO'
    and ps.sort_order = desired_stages.sort_order
);
