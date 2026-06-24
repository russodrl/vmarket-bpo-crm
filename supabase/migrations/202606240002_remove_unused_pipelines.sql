-- Remove unused BPO CRM pipelines.
-- Deals pointing to these stages are set to no stage before deleting the stages.

with removed_stages as (
  select id
  from public.pipeline_stages
  where pipeline_name in ('Pós-Venda', 'Suporte', 'Contratos BPO')
)
update public.deals
set stage_id = null,
    updated_at = now()
where stage_id in (select id from removed_stages);

delete from public.pipeline_stages
where pipeline_name in ('Pós-Venda', 'Suporte', 'Contratos BPO');
