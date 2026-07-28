-- Reorganize the local BPO-owned deals pipeline with complete ordered stages and Vmarket spelling.

with desired_stages(sort_order, name, deal_probability) as (
  values
    (42, 'Novo Negócio', 15),
    (43, 'Proposta Enviada', 30),
    (44, 'Contrato BPO Enviado', 45),
    (45, 'Contrato BPO Assinado', 60),
    (46, 'Contrato Vmarket Enviado', 75),
    (47, 'Contrato Vmarket Assinado', 95),
    (48, 'Ganho', 100)
), reusable_existing as (
  select
    ps.id,
    ps.name,
    row_number() over (order by ps.sort_order, ps.created_at, ps.id) as rn
  from public.pipeline_stages ps
  where ps.pipeline_name = 'Negocios Próprios BPO'
), desired_numbered as (
  select
    desired_stages.*,
    row_number() over (order by desired_stages.sort_order) as rn
  from desired_stages
)
update public.pipeline_stages ps
set
  name = desired_numbered.name,
  sort_order = desired_numbered.sort_order,
  deal_probability = desired_numbered.deal_probability,
  color = '#8b5cf6',
  is_pipedrive_replica = false,
  pipedrive_stage_id = null,
  pipedrive_pipeline_id = null
from reusable_existing
join desired_numbered on desired_numbered.rn = reusable_existing.rn
where ps.id = reusable_existing.id;

with desired_stages(sort_order, name, deal_probability) as (
  values
    (42, 'Novo Negócio', 15),
    (43, 'Proposta Enviada', 30),
    (44, 'Contrato BPO Enviado', 45),
    (45, 'Contrato BPO Assinado', 60),
    (46, 'Contrato Vmarket Enviado', 75),
    (47, 'Contrato Vmarket Assinado', 95),
    (48, 'Ganho', 100)
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
    and ps.name = desired_stages.name
);

-- Normalize any pre-existing spelling just in case an older row survived by name.
update public.pipeline_stages
set name = replace(name, 'VMarketing', 'Vmarket')
where pipeline_name = 'Negocios Próprios BPO'
  and name like '%VMarketing%';
