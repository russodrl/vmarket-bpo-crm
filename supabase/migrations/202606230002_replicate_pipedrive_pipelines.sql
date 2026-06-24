-- Replicate Pipedrive pipelines/stages and add integration-safe local identifiers.

alter table public.pipeline_stages add column if not exists pipedrive_stage_id int;
alter table public.pipeline_stages add column if not exists pipedrive_pipeline_id int;
alter table public.pipeline_stages add column if not exists pipeline_name text;
alter table public.pipeline_stages add column if not exists deal_probability int;
alter table public.pipeline_stages add column if not exists is_pipedrive_replica boolean not null default false;

alter table public.pipeline_stages drop constraint if exists pipeline_stages_sort_order_key;

create unique index if not exists pipeline_stages_pipedrive_stage_id_idx
  on public.pipeline_stages(pipedrive_stage_id)
  where pipedrive_stage_id is not null;

create index if not exists pipeline_stages_pipeline_sort_idx
  on public.pipeline_stages(pipeline_name, sort_order);

with pd_stages(pipedrive_stage_id, pipedrive_pipeline_id, pipeline_name, name, order_nr, global_sort_order, color, deal_probability) as (
  values
    (24, 1, 'Pipeline de Vendas', 'Sem Contato', 1, 1, '#64748b', 100),
    (1, 1, 'Pipeline de Vendas', 'Qualificado', 1, 2, '#64748b', 100),
    (2, 1, 'Pipeline de Vendas', 'Contato Feito', 2, 3, '#64748b', 100),
    (14, 1, 'Pipeline de Vendas', 'Confirmar Apresentação', 3, 4, '#64748b', 100),
    (3, 1, 'Pipeline de Vendas', 'Reunião Agendada', 4, 5, '#64748b', 100),
    (12, 1, 'Pipeline de Vendas', 'Enviar Proposta', 5, 6, '#64748b', 100),
    (4, 1, 'Pipeline de Vendas', 'Feedback Proposta', 6, 7, '#64748b', 100),
    (5, 1, 'Pipeline de Vendas', 'Em Negociação', 7, 8, '#64748b', 100),
    (15, 1, 'Pipeline de Vendas', 'Contrato Enviado', 8, 9, '#64748b', 100),
    (61, 1, 'Pipeline de Vendas', 'Contrato Assinado/ Boleto Gerado', 9, 10, '#64748b', 100),
    (39, 1, 'Pipeline de Vendas', 'Ganho', 10, 11, '#64748b', 100),
    (21, 2, 'Pós-Venda', 'Entrevista', 1, 12, '#2563eb', 100),
    (23, 2, 'Pós-Venda', 'Rodrigo - on going', 2, 13, '#2563eb', 100),
    (25, 2, 'Pós-Venda', 'Lívia - on going', 3, 14, '#2563eb', 100),
    (22, 2, 'Pós-Venda', 'Kayky - on going', 4, 15, '#2563eb', 100),
    (26, 2, 'Pós-Venda', 'Alan - on going', 5, 16, '#2563eb', 100),
    (10, 2, 'Pós-Venda', 'Sem uso ( Desistência )', 6, 17, '#2563eb', 100),
    (11, 2, 'Pós-Venda', 'Fidelizado', 7, 18, '#2563eb', 100),
    (13, 2, 'Pós-Venda', 'Cancelado', 8, 19, '#2563eb', 100),
    (27, 4, 'Onboarding', 'Ag. Onboarding', 1, 20, '#f59e0b', 100),
    (28, 4, 'Onboarding', 'Ag. Entrevista', 2, 21, '#f59e0b', 100),
    (29, 4, 'Onboarding', 'Ag. Treinamento', 3, 22, '#f59e0b', 100),
    (30, 4, 'Onboarding', 'Ag. 1ª Compra', 4, 23, '#f59e0b', 100),
    (55, 4, 'Onboarding', 'Ag. 2ª Compra', 5, 24, '#f59e0b', 100),
    (56, 4, 'Onboarding', 'Ag. 3ª Compra', 6, 25, '#f59e0b', 100),
    (57, 4, 'Onboarding', 'Feita 3ª Compra', 7, 26, '#f59e0b', 100),
    (52, 4, 'Onboarding', 'Terminado Ac. Compras', 8, 27, '#f59e0b', 100),
    (32, 4, 'Onboarding', 'Ñ Engajado - Risco Churn', 9, 28, '#f59e0b', 100),
    (33, 5, 'CS', '1ª Compra Sozinho', 1, 29, '#10b981', 100),
    (34, 5, 'CS', '2ª  Compra Sozinho', 2, 30, '#10b981', 100),
    (35, 5, 'CS', '3ª  Compra Sozinho', 3, 31, '#10b981', 100),
    (36, 5, 'CS', 'Fidelizado', 4, 32, '#10b981', 100),
    (60, 5, 'CS', 'Stand By', 5, 33, '#10b981', 100),
    (37, 5, 'CS', 'Sem Uso - Risco Churn', 6, 34, '#10b981', 100),
    (53, 5, 'CS', 'Usou - Risco Churn', 7, 35, '#10b981', 100),
    (41, 5, 'CS', 'Ped. Cortesia', 8, 36, '#10b981', 100),
    (42, 5, 'CS', 'Em Cortesia', 9, 37, '#10b981', 100),
    (40, 5, 'CS', 'Ped. Cancelamento', 10, 38, '#10b981', 100),
    (38, 5, 'CS', 'Cancelado', 11, 39, '#10b981', 100),
    (58, 5, 'CS', 'Paga e ñ usa', 12, 40, '#10b981', 100),
    (59, 5, 'CS', 'Parou de pagar - ñ comunicou cancelamento', 13, 41, '#10b981', 100),
    (51, 6, 'Suporte', 'Ñ É Suporte - Excluir', 1, 42, '#ef4444', 100),
    (43, 6, 'Suporte', '1.Recebido', 2, 43, '#ef4444', 100),
    (44, 6, 'Suporte', '2.Nível 1 (Suporte)', 3, 44, '#ef4444', 100),
    (45, 6, 'Suporte', '3.Nível 2 (TI)', 4, 45, '#ef4444', 100),
    (48, 6, 'Suporte', '4.Retorno TI Teste', 5, 46, '#ef4444', 100),
    (49, 6, 'Suporte', '5.Testado e Aprovado', 6, 47, '#ef4444', 100),
    (46, 6, 'Suporte', '6.Aguardando Cliente', 7, 48, '#ef4444', 100),
    (50, 6, 'Suporte', 'Roadmap', 8, 49, '#ef4444', 100),
    (47, 6, 'Suporte', 'Resolvido', 9, 50, '#ef4444', 100),
    (62, 7, 'Contratos BPO', 'Novos', 1, 51, '#14b8a6', 100),
    (64, 7, 'Contratos BPO', 'Em Análise', 2, 52, '#14b8a6', 100),
    (95, 7, 'Contratos BPO', 'Aguardando Cadastro', 3, 53, '#14b8a6', 100),
    (96, 7, 'Contratos BPO', 'Aguardando Assinaturas', 4, 54, '#14b8a6', 100),
    (97, 7, 'Contratos BPO', 'Assinados', 5, 55, '#14b8a6', 100)
)
insert into public.pipeline_stages (name, sort_order, color, pipedrive_stage_id, pipedrive_pipeline_id, pipeline_name, deal_probability, is_pipedrive_replica)
select name, global_sort_order, color, pipedrive_stage_id, pipedrive_pipeline_id, pipeline_name, deal_probability, true
from pd_stages
on conflict (pipedrive_stage_id) where pipedrive_stage_id is not null do update set
  name = excluded.name,
  sort_order = excluded.sort_order,
  color = excluded.color,
  pipedrive_pipeline_id = excluded.pipedrive_pipeline_id,
  pipeline_name = excluded.pipeline_name,
  deal_probability = excluded.deal_probability,
  is_pipedrive_replica = true;
