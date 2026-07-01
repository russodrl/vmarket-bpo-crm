update public.automation_rules
set
  name = 'Pipedrive → CRM BPO: importar leads de Aleksander e limpar owner ao sair dele',
  description = 'Recebe webhooks do Pipedrive. Cria novos negócios no CRM BPO somente quando o proprietário do negócio no Pipedrive é Aleksander. Se um negócio já sincronizado mudar de Aleksander para outro proprietário no Pipedrive, atualiza o registro e remove o proprietário CRM para que apareça em Avisos como sem atribuição.',
  filters = '[{"field":"payload.current.id","operator":"is not empty","value":"ID do negócio Pipedrive obrigatório"},{"field":"owner/user_id","operator":"equals on new imports","value":"Aleksander Pipedrive user id 28696367"},{"field":"external_records","operator":"if exists and owner is not Aleksander","value":"Atualiza o negócio já vinculado e limpa deals.owner_id"}]'::jsonb,
  actions = '[{"system":"Pipedrive API","action":"GET /deals/{id}"},{"system":"CRM BPO","action":"ignore new Pipedrive deals whose owner is not Aleksander"},{"system":"CRM BPO","action":"upsert organizations, people, deals"},{"system":"CRM BPO","action":"set deals.owner_id = null when existing Pipedrive deal owner is no longer Aleksander"},{"system":"CRM BPO","action":"sync notes and activities from Pipedrive"},{"system":"CRM BPO","action":"upsert external_records and integration logs"}]'::jsonb,
  fields_involved = '["Pipedrive deal.id","Pipedrive deal.user_id","Pipedrive deal.title","Pipedrive deal.value","Pipedrive deal.status","Pipedrive deal.stage_id","Pipedrive org_id","Pipedrive person_id","deals.owner_id","deals.pipedrive_owner_name","deals.title","deals.value","deals.status","deals.stage_id","organizations.name","people.full_name","external_records.external_id"]'::jsonb,
  implementation_refs = '[{"type":"edge_function","name":"pipedrive-sync","file":"supabase/functions/pipedrive-sync/index.ts"},{"type":"environment_variable","name":"ALEKSANDER_PIPEDRIVE_USER_ID"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'pipedrive_deal_webhook_to_crm';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'pipedrive_deal_webhook_to_crm',
  'implementation_changed',
  'Hermes',
  'Novos leads Pipedrive só entram/distribuem quando o owner Pipedrive é Aleksander; negócios já vinculados que saem de Aleksander têm deals.owner_id limpo para Avisos.',
  '{"pipedrive_owner_gate":"Aleksander only for new imports","existing_non_aleksander_action":"clear deals.owner_id"}'::jsonb
);
