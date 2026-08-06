-- Reverte a sobrescrita de etapas do CRM BPO feita em 2026-08-06 15:27:45 UTC.
-- Restaura os valores anteriores registrados em public.audit_logs e preserva negócios alterados depois por usuários.

select set_config('request.jwt.claim.role', 'service_role', false);

with stage_audit as (
  select
    entity_id as deal_id,
    trim(both '"' from old_value::text)::uuid as old_stage_id,
    trim(both '"' from new_value::text)::uuid as new_stage_id
  from public.audit_logs
  where table_name = 'deals'
    and field_name = 'stage_id'
    and created_at = '2026-08-06 15:27:45.926983+00'::timestamptz
), entered_audit as (
  select
    entity_id as deal_id,
    case
      when old_value = 'null'::jsonb then null::timestamptz
      else trim(both '"' from old_value::text)::timestamptz
    end as old_entered_at
  from public.audit_logs
  where table_name = 'deals'
    and field_name = 'pipedrive_stage_entered_at'
    and created_at = '2026-08-06 15:27:45.926983+00'::timestamptz
), restored as (
  update public.deals d
  set
    stage_id = sa.old_stage_id,
    pipedrive_stage_entered_at = case
      when ea.deal_id is not null then ea.old_entered_at
      else d.pipedrive_stage_entered_at
    end,
    updated_at = now()
  from stage_audit sa
  left join entered_audit ea on ea.deal_id = sa.deal_id
  where d.id = sa.deal_id
    -- Não sobrescreve negócios que foram mexidos depois do sync errado.
    and d.stage_id = sa.new_stage_id
  returning d.id
), removed_empty_stages as (
  delete from public.pipeline_stages ps
  where ps.created_at = '2026-08-06 15:27:45.926983+00'::timestamptz
    and ps.pipedrive_stage_id in (96, 97, 98, 99, 102)
    and not exists (
      select 1 from public.deals d where d.stage_id = ps.id
    )
  returning ps.id, ps.name, ps.pipeline_name, ps.pipedrive_stage_id
)
insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'pipedrive_deal_webhook_to_crm',
  'implementation_changed',
  'Hermes',
  'Rollback da sobrescrita de etapas do CRM BPO com etapas atuais do Pipedrive; valores anteriores restaurados a partir de audit_logs.',
  jsonb_build_object(
    'stage_overwrite_timestamp', '2026-08-06T15:27:45.926983Z',
    'restored_deals', (select count(*) from restored),
    'preserved_because_changed_after_sync', (select count(*) from stage_audit sa join public.deals d on d.id = sa.deal_id where d.stage_id <> sa.new_stage_id),
    'removed_empty_stage_count', (select count(*) from removed_empty_stages),
    'removed_empty_stages', coalesce((select jsonb_agg(to_jsonb(removed_empty_stages)) from removed_empty_stages), '[]'::jsonb)
  )
);
