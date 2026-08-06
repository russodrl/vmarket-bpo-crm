-- Remove etapas Pipedrive locais criadas pelo sync indevido de 2026-08-06 que ficaram sem negócios após o rollback.

select set_config('request.jwt.claim.role', 'service_role', false);

with removed_empty_stages as (
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
  'Limpeza de etapas vazias criadas pelo sync indevido de etapas do Pipedrive após rollback.',
  jsonb_build_object(
    'stage_overwrite_timestamp', '2026-08-06T15:27:45.926983Z',
    'removed_empty_stage_count', (select count(*) from removed_empty_stages),
    'removed_empty_stages', coalesce((select jsonb_agg(to_jsonb(removed_empty_stages)) from removed_empty_stages), '[]'::jsonb)
  )
);
