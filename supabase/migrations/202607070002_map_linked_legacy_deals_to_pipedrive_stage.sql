-- Move linked legacy/no-stage deals to the mapped Pipedrive "Sem Contato" CRM stage.
-- No records are deleted.

begin;

create temporary table tmp_linked_unmapped_deals on commit drop as
select d.id
from public.deals d
join public.external_records er on er.provider = 'pipedrive' and er.entity = 'deal' and er.internal_id = d.id
left join public.pipeline_stages ps on ps.id = d.stage_id
where ps.pipedrive_stage_id is null;

with target_stage as (
  select id
  from public.pipeline_stages
  where pipeline_name = 'Pipeline de Vendas'
    and name = 'Sem Contato'
    and pipedrive_stage_id is not null
  limit 1
)
update public.deals d
   set stage_id = (select id from target_stage),
       updated_at = now()
  from tmp_linked_unmapped_deals u
 where d.id = u.id
   and exists (select 1 from target_stage);

insert into public.deal_history (deal_id, event_type, title, description)
select u.id,
       'Integração',
       'Etapa legada mapeada para Pipedrive',
       'Negócio vinculado ao Pipedrive estava em etapa sem mapeamento; movido para Pipeline de Vendas · Sem Contato para permitir sincronização de etapa.'
from tmp_linked_unmapped_deals u
where exists (
  select 1
  from public.pipeline_stages
  where pipeline_name = 'Pipeline de Vendas'
    and name = 'Sem Contato'
    and pipedrive_stage_id is not null
);

commit;
