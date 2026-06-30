-- Automation rules catalog and execution history for CRM BPO integrations.

create extension if not exists pgcrypto;

create table if not exists public.automation_rules (
  id text primary key,
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'draft', 'deprecated')),
  source_system text not null,
  target_system text not null,
  trigger_system text not null,
  trigger_type text not null,
  description text not null,
  triggers jsonb not null default '[]'::jsonb,
  filters jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  fields_involved jsonb not null default '[]'::jsonb,
  implementation_refs jsonb not null default '[]'::jsonb,
  owner text not null default 'CRM BPO',
  created_by text not null default 'system',
  updated_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_rule_changes (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null references public.automation_rules(id) on delete cascade,
  change_type text not null check (change_type in ('created', 'updated', 'status_changed', 'implementation_changed')),
  changed_by text not null default 'system',
  summary text not null,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_rule_executions (
  id uuid primary key default gen_random_uuid(),
  rule_id text not null references public.automation_rules(id) on delete cascade,
  integration_event_id uuid references public.integration_events(id) on delete set null,
  status text not null default 'processing' check (status in ('processing', 'success', 'error', 'ignored')),
  trigger_system text,
  trigger_type text,
  record_entity text,
  internal_id uuid,
  external_id text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  changed_fields jsonb not null default '[]'::jsonb,
  filters_evaluated jsonb not null default '[]'::jsonb,
  actions_performed jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  error_message text
);

create index if not exists automation_rule_executions_rule_started_idx on public.automation_rule_executions(rule_id, started_at desc);
create index if not exists automation_rule_executions_status_idx on public.automation_rule_executions(status, started_at desc);
create index if not exists automation_rule_changes_rule_created_idx on public.automation_rule_changes(rule_id, created_at desc);

drop trigger if exists touch_automation_rules on public.automation_rules;
create trigger touch_automation_rules before update on public.automation_rules for each row execute function public.touch_updated_at();

create or replace function public.log_automation_rule_seed_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
    values (new.id, 'created', coalesce(new.created_by, 'system'), 'Regra registrada no catálogo de automações.', to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' and to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
    insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, before_snapshot, after_snapshot)
    values (new.id, 'updated', coalesce(new.updated_by, 'system'), 'Regra alterada no catálogo de automações.', to_jsonb(old), to_jsonb(new));
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists log_automation_rule_seed_change on public.automation_rules;
create trigger log_automation_rule_seed_change after insert or update on public.automation_rules for each row execute function public.log_automation_rule_seed_change();

alter table public.automation_rules enable row level security;
alter table public.automation_rule_changes enable row level security;
alter table public.automation_rule_executions enable row level security;

drop policy if exists "automation rules admin read" on public.automation_rules;
drop policy if exists "automation rules admin write" on public.automation_rules;
create policy "automation rules admin read" on public.automation_rules for select to authenticated using (public.is_admin());
create policy "automation rules admin write" on public.automation_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "automation rule changes admin read" on public.automation_rule_changes;
drop policy if exists "automation rule changes admin write" on public.automation_rule_changes;
create policy "automation rule changes admin read" on public.automation_rule_changes for select to authenticated using (public.is_admin());
create policy "automation rule changes admin write" on public.automation_rule_changes for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "automation executions admin read" on public.automation_rule_executions;
drop policy if exists "automation executions admin write" on public.automation_rule_executions;
create policy "automation executions admin read" on public.automation_rule_executions for select to authenticated using (public.is_admin());
create policy "automation executions admin write" on public.automation_rule_executions for all to authenticated using (public.is_admin()) with check (public.is_admin());

with rules(id, name, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs) as (
  values
  (
    'pipedrive_deal_webhook_to_crm',
    'Pipedrive → CRM BPO: importar/criar/atualizar negócio de Aleksander',
    'Pipedrive', 'CRM BPO', 'Pipedrive', 'Webhook deal.create / deal.change',
    'Recebe webhooks do Pipedrive, busca o negócio completo na API e cria ou atualiza negócio, empresa, pessoa, atividades, notas e campos customizados no CRM BPO.',
    '[{"system":"Pipedrive","event":"deal.create","webhook_id":"1879953"},{"system":"Pipedrive","event":"deal.change","webhook_id":"1879954"}]'::jsonb,
    '[{"field":"owner/user_id","operator":"equals when new","value":"Aleksander Pipedrive user id 28696367"},{"field":"external_records","operator":"or exists","value":"Atualiza se o negócio já tiver vínculo externo, mesmo se owner mudar"},{"field":"payload.current.id","operator":"is not empty","value":"ID do negócio Pipedrive obrigatório"}]'::jsonb,
    '[{"system":"Pipedrive API","action":"GET /deals/{id}"},{"system":"CRM BPO","action":"upsert organizations, people, deals"},{"system":"CRM BPO","action":"upsert custom_field_values"},{"system":"CRM BPO","action":"sync notes and activities from Pipedrive"},{"system":"CRM BPO","action":"upsert external_records and integration logs"}]'::jsonb,
    '["Pipedrive deal.id","Pipedrive deal.title","Pipedrive deal.value","Pipedrive deal.status","Pipedrive deal.stage_id","Pipedrive deal.pipeline_id","Pipedrive deal.user_id","Pipedrive org_id","Pipedrive person_id","deals.title","deals.value","deals.status","deals.stage_id","deals.pipedrive_owner_name","deals.pipedrive_deal_created_at","organizations.name","people.full_name","people.email","people.phone","custom_fields.pipedrive_key","custom_field_values.value","external_records.external_id"]'::jsonb,
    '[{"file":"supabase/functions/pipedrive-sync/index.ts","functions":["handlePipedriveWebhook","upsertCrmDealFromPipedrive","syncPipedriveNotesToHistory","syncPipedriveActivitiesToCrm"]},{"table":"integration_events"},{"table":"integration_logs"}]'::jsonb
  ),
  (
    'crm_deal_full_sync_to_pipedrive',
    'CRM BPO → Pipedrive: sincronizar campos do negócio existente',
    'CRM BPO', 'Pipedrive', 'CRM BPO', 'Edição da ficha do negócio / chamada sync-existing-deal-to-pipedrive',
    'Quando um negócio já vinculado ao Pipedrive é editado no CRM BPO dentro do Pipeline de Vendas, envia dados do negócio, empresa, pessoa, etapa e campos customizados para o Pipedrive.',
    '[{"system":"CRM BPO","event":"Salvar alterações na ficha do negócio"},{"system":"Edge Function","event":"action=sync-existing-deal-to-pipedrive"}]'::jsonb,
    '[{"field":"pipeline_stages.pipeline_name","operator":"equals","value":"Pipeline de Vendas"},{"field":"external_records(provider=pipedrive, entity=deal)","operator":"exists","value":"Não cria negócio novo por alteração comum"},{"field":"deals.owner_id","operator":"authorization","value":"Usuário só sincroniza negócios próprios quando aplicável"}]'::jsonb,
    '[{"system":"Pipedrive API","action":"PUT /deals/{id} ou POST /deals quando chamado como sync-deal-to-pipedrive"},{"system":"Pipedrive API","action":"create/update organization and person as needed"},{"system":"CRM BPO","action":"upsert external_records"},{"system":"CRM BPO","action":"insert deal_history Integração"}]'::jsonb,
    '["deals.title","deals.value","deals.expected_close_date","deals.status","deals.stage_id","organizations.name","people.full_name","people.email","people.phone","custom_fields.pipedrive_key","custom_field_values.value","external_records.external_id"]'::jsonb,
    '[{"file":"src/App.tsx","functions":["saveDeal","syncExistingDealToPipedriveIfSalesPipeline"]},{"file":"supabase/functions/pipedrive-sync/index.ts","functions":["syncExistingDealToPipedrive","syncDealToPipedrive","ensurePipedriveOrganization","ensurePipedrivePerson"]}]'::jsonb
  ),
  (
    'crm_deal_stage_to_pipedrive',
    'CRM BPO → Pipedrive: enviar mudança de etapa',
    'CRM BPO', 'Pipedrive', 'CRM BPO', 'Drag/drop no Kanban ou alteração de etapa',
    'Quando a etapa de um negócio vinculado muda dentro do Pipeline de Vendas, envia somente o stage_id correspondente para o Pipedrive.',
    '[{"system":"CRM BPO","event":"Drag/drop do card no Kanban"},{"system":"CRM BPO","event":"Alteração do campo Etapa"},{"system":"Edge Function","event":"action=sync-existing-deal-stage-to-pipedrive"}]'::jsonb,
    '[{"field":"pipeline_stages.pipeline_name","operator":"equals","value":"Pipeline de Vendas"},{"field":"external_records(provider=pipedrive, entity=deal)","operator":"exists","value":"Negócio precisa estar vinculado ao Pipedrive"},{"field":"pipeline_stages.pipedrive_stage_id","operator":"is not empty","value":"Etapa precisa ter ID do Pipedrive"}]'::jsonb,
    '[{"system":"Pipedrive API","action":"PUT /deals/{id} body { stage_id }"},{"system":"CRM BPO","action":"update external_records.last_payload"},{"system":"CRM BPO","action":"insert deal_history Integração"}]'::jsonb,
    '["deals.stage_id","pipeline_stages.name","pipeline_stages.pipeline_name","pipeline_stages.pipedrive_stage_id","external_records.external_id"]'::jsonb,
    '[{"file":"src/App.tsx","functions":["moveDeal","saveDeal","syncExistingDealToPipedriveIfSalesPipeline"]},{"file":"supabase/functions/pipedrive-sync/index.ts","functions":["syncExistingDealStageToPipedrive"]}]'::jsonb
  ),
  (
    'crm_manual_deal_create_to_pipedrive',
    'CRM BPO → Pipedrive: criar ou atualizar negócio por chamada explícita',
    'CRM BPO', 'Pipedrive', 'CRM BPO / Make autorizado', 'Edge Function action=sync-deal-to-pipedrive',
    'Endpoint explícito para criar ou atualizar um negócio do CRM no Pipedrive quando há empresa e pessoa preenchidas. Pode ser chamado pelo CRM ou por automações laterais autorizadas.',
    '[{"system":"Edge Function","event":"action=sync-deal-to-pipedrive"}]'::jsonb,
    '[{"field":"deals.organization_id","operator":"is not empty","value":"Empresa obrigatória"},{"field":"deals.person_id","operator":"is not empty","value":"Pessoa obrigatória"},{"field":"organizations.name","operator":"is not empty","value":"Nome da empresa obrigatório"},{"field":"people.full_name","operator":"is not empty","value":"Nome da pessoa obrigatório"}]'::jsonb,
    '[{"system":"Pipedrive API","action":"find/create/update organization"},{"system":"Pipedrive API","action":"find/create/update person"},{"system":"Pipedrive API","action":"POST /deals ou PUT /deals/{id}"},{"system":"CRM BPO","action":"upsert external_records"}]'::jsonb,
    '["deals.title","deals.value","deals.expected_close_date","deals.status","deals.stage_id","organizations.name","people.full_name","people.email","people.phone","custom_field_values.value"]'::jsonb,
    '[{"file":"supabase/functions/pipedrive-sync/index.ts","functions":["syncDealToPipedrive"]},{"doc":"docs/make-pipedrive-api.md"}]'::jsonb
  ),
  (
    'tally_bpo_forms_to_crm_and_pipedrive',
    'Tally → CRM BPO/Pipedrive: processar formulários BPO',
    'Tally', 'CRM BPO e Pipedrive', 'Hermes cron', 'every 5m vmarket-tally-bpo-pipedrive-sync',
    'Rotina recorrente que lê respostas dos formulários Tally BPO, atualiza usuários do CRM BPO, cria/enriquece pessoa, organização, negócio, campos e notas no Pipedrive.',
    '[{"system":"Hermes cron","event":"vmarket-tally-bpo-pipedrive-sync every 5m"},{"system":"Tally API","event":"novas respostas dos forms ODEM5M e pbv8PJ"}]'::jsonb,
    '[{"field":"submission_id","operator":"not processed","value":"Idempotência via .sync-state/tally_bpo_pipedrive_state.json"},{"field":"Form ID","operator":"in","value":"ODEM5M, pbv8PJ"},{"field":"phone/email","operator":"fallback match","value":"Localiza pessoa no Pipedrive por telefone e email"}]'::jsonb,
    '[{"system":"CRM BPO","action":"sync crm_users from registration form"},{"system":"Pipedrive API","action":"create/reuse person and organization"},{"system":"Pipedrive API","action":"create/reuse deal in Contratos BPO"},{"system":"Pipedrive API","action":"update person/deal custom fields and notes"}]'::jsonb,
    '["crm_users.full_name","crm_users.email","crm_users.cnpj","crm_users.crm_phone","crm_users.service_regions","Pipedrive person.name","Pipedrive person.email","Pipedrive person.phone","Pipedrive deal.title","Pipedrive deal.pipeline_id=7","Pipedrive deal.stage_id=62","Pipedrive label_id=264","Razão Social Principal","CNPJ Principal","Endereço CNPJ Principal"]'::jsonb,
    '[{"file":"scripts/sync-tally-crm-users.py"},{"file":"scripts/tally_bpo_pipedrive_sync.py"},{"doc":"docs/tally-bpo-direct-automation.md"},{"cron":"vmarket-tally-bpo-pipedrive-sync"}]'::jsonb
  )
)
insert into public.automation_rules (id, name, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs, created_by, updated_by)
select id, name, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs, 'Hermes', 'Hermes'
from rules
on conflict (id) do update set
  name = excluded.name,
  source_system = excluded.source_system,
  target_system = excluded.target_system,
  trigger_system = excluded.trigger_system,
  trigger_type = excluded.trigger_type,
  description = excluded.description,
  triggers = excluded.triggers,
  filters = excluded.filters,
  actions = excluded.actions,
  fields_involved = excluded.fields_involved,
  implementation_refs = excluded.implementation_refs,
  updated_by = 'Hermes';

insert into public.automation_rule_executions (rule_id, integration_event_id, status, trigger_system, trigger_type, record_entity, internal_id, external_id, started_at, finished_at, details, error_message)
select
  case
    when event_type in ('deal.create', 'deal.change', 'pipedrive_webhook') and direction = 'inbound' then 'pipedrive_deal_webhook_to_crm'
    when direction = 'outbound' and event_type ilike '%stage%' then 'crm_deal_stage_to_pipedrive'
    when direction = 'outbound' then 'crm_deal_full_sync_to_pipedrive'
    else 'pipedrive_deal_webhook_to_crm'
  end,
  id,
  status,
  case when direction = 'inbound' then 'Pipedrive' else 'CRM BPO' end,
  event_type,
  entity,
  internal_id,
  external_id,
  created_at,
  processed_at,
  jsonb_build_object('source', 'backfill from integration_events', 'payload_keys', coalesce((select jsonb_agg(key) from jsonb_object_keys(payload) as key), '[]'::jsonb)),
  error_message
from public.integration_events e
where not exists (select 1 from public.automation_rule_executions x where x.integration_event_id = e.id);
