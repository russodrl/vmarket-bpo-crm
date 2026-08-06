-- Restaura a ordem local das etapas do CRM BPO após rollback do sync indevido de etapas.
-- Não altera negócios e não chama Pipedrive; apenas corrige public.pipeline_stages.sort_order.

select set_config('request.jwt.claim.role', 'service_role', false);

with desired(pipedrive_stage_id, pipeline_name, name, sort_order) as (
  values
    (24, 'Pipeline de Vendas', 'Sem Contato', 1),
    (1, 'Pipeline de Vendas', 'Qualificado', 2),
    (2, 'Pipeline de Vendas', 'Contato Feito', 3),
    (14, 'Pipeline de Vendas', 'Confirmar Apresentação', 4),
    (3, 'Pipeline de Vendas', 'Reunião Agendada', 5),
    (12, 'Pipeline de Vendas', 'Enviar Proposta', 6),
    (4, 'Pipeline de Vendas', 'Feedback Proposta', 7),
    (5, 'Pipeline de Vendas', 'Em Negociação', 8),
    (15, 'Pipeline de Vendas', 'Contrato Enviado', 9),
    (61, 'Pipeline de Vendas', 'Contrato Assinado/ Boleto Gerado', 10),
    (39, 'Pipeline de Vendas', 'Ganho', 11),
    (27, 'Onboarding', 'Ag. Onboarding', 20),
    (28, 'Onboarding', 'Ag. Entrevista', 21),
    (29, 'Onboarding', 'Ag. Treinamento', 22),
    (30, 'Onboarding', 'Ag. 1ª Compra', 23),
    (55, 'Onboarding', 'Ag. 2ª Compra', 24),
    (56, 'Onboarding', 'Ag. 3ª Compra', 25),
    (57, 'Onboarding', 'Feita 3ª Compra', 26),
    (52, 'Onboarding', 'Terminado Ac. Compras', 27),
    (32, 'Onboarding', 'Ñ Engajado - Risco Churn', 28),
    (33, 'CS', '1ª Compra Sozinho', 29),
    (34, 'CS', '2ª  Compra Sozinho', 30),
    (35, 'CS', '3ª  Compra Sozinho', 31),
    (36, 'CS', 'Fidelizado', 32),
    (60, 'CS', 'Stand By', 33),
    (37, 'CS', 'Sem Uso - Risco Churn', 34),
    (53, 'CS', 'Usou - Risco Churn', 35),
    (41, 'CS', 'Ped. Cortesia', 36),
    (42, 'CS', 'Em Cortesia', 37),
    (40, 'CS', 'Ped. Cancelamento', 38),
    (38, 'CS', 'Cancelado', 39),
    (58, 'CS', 'Paga e ñ usa', 40),
    (59, 'CS', 'Parou de pagar - ñ comunicou cancelamento', 41)
), updated as (
  update public.pipeline_stages ps
  set
    sort_order = d.sort_order,
    pipeline_name = d.pipeline_name,
    name = d.name
  from desired d
  where ps.pipedrive_stage_id = d.pipedrive_stage_id
    and (ps.sort_order is distinct from d.sort_order
      or ps.pipeline_name is distinct from d.pipeline_name
      or ps.name is distinct from d.name)
  returning ps.id, ps.name, ps.pipeline_name, ps.pipedrive_stage_id, ps.sort_order
)
insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'pipedrive_deal_webhook_to_crm',
  'implementation_changed',
  'Hermes',
  'Ordem local das etapas do CRM BPO restaurada após sync indevido; sem alteração no Pipedrive.',
  jsonb_build_object(
    'updated_stage_count', (select count(*) from updated),
    'updated_stages', coalesce((select jsonb_agg(to_jsonb(updated) order by sort_order) from updated), '[]'::jsonb),
    'pipedrive_calls', 0
  )
);
