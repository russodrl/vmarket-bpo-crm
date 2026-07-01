create or replace function public.pipedrive_deal_owner_id_from_payload(payload jsonb)
returns bigint
language sql
immutable
as $$
  select case
    when coalesce(payload #>> '{user_id,id}', '') ~ '^[0-9]+$' then (payload #>> '{user_id,id}')::bigint
    when coalesce(payload ->> 'user_id', '') ~ '^[0-9]+$' then (payload ->> 'user_id')::bigint
    else null
  end
$$;

create or replace function public.pipedrive_deal_is_aleksander_owner(target_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.pipedrive_deal_owner_id_from_payload(er.last_payload) = 28696367
    from public.external_records er
    where er.provider = 'pipedrive'
      and er.entity = 'deal'
      and er.internal_id = target_deal_id
    limit 1
  ), true)
$$;

create or replace function public.distribute_invalid_deal_owners()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  assigned uuid;
  changed integer := 0;
  rule_id text := 'lead_distribution_round_robin';
begin
  for rec in
    select d.id, d.title, d.owner_id, cu.full_name as old_owner_name, cu.status as old_owner_status
    from public.deals d
    left join public.crm_users cu on cu.auth_user_id = d.owner_id
    where (
        d.owner_id is null
        or cu.id is null
        or cu.status in ('deleted', 'disabled')
        or public.crm_assignment_user_is_test(cu.full_name, cu.email::text)
      )
      and public.pipedrive_deal_is_aleksander_owner(d.id)
    order by d.created_at, d.id
  loop
    assigned := public.next_lead_owner(rec.id);
    exit when assigned is null;

    update public.deals
       set owner_id = assigned,
           updated_at = now()
     where id = rec.id;

    changed := changed + 1;

    insert into public.automation_rule_executions (
      rule_id, status, trigger_system, trigger_type,
      record_entity, internal_id, external_id, started_at, finished_at, changed_fields,
      filters_evaluated, actions_performed, details
    ) values (
      rule_id, 'success', 'CRM BPO', 'manual_run distribute_invalid_deal_owners',
      'deal', rec.id, rec.id::text, now(), now(), '["deals.owner_id"]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('field', 'owner_id', 'expected', 'null/invalid/deleted/disabled/test', 'actual', rec.owner_id, 'result', true),
        jsonb_build_object('field', 'pipedrive.owner_user_id', 'expected', 'Aleksander or non-Pipedrive deal', 'actual', 'allowed', 'result', true)
      ),
      '["assigned valid lead owner", "excluded test user aspalamar", "skipped Pipedrive deals not owned by Aleksander"]'::jsonb,
      jsonb_build_object('deal_id', rec.id, 'deal_title', rec.title, 'old_owner_id', rec.owner_id, 'old_owner_name', rec.old_owner_name, 'old_owner_status', rec.old_owner_status, 'assigned_owner_id', assigned)
    );
  end loop;

  return changed;
end;
$$;

update public.automation_rules
set
  description = 'Atribui negócios sem proprietário ou com proprietário inválido/deletado/desativado para parceiros ativos. Negócios vindos do Pipedrive só entram na redistribuição quando o proprietário Pipedrive é Aleksander; se o negócio Pipedrive já vinculado saiu de Aleksander, permanece sem owner CRM para aparecer em Avisos.',
  filters = '[{"field":"deals.owner_id","operator":"is null or invalid/deleted/disabled/test"},{"field":"external_records.provider/entity","operator":"not Pipedrive deal or owner is Aleksander","value":"Pipedrive user id 28696367"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"},{"field":"crm_users.full_name/email","operator":"not contains","value":"aspalamar"}]'::jsonb,
  actions = '[{"action":"skip ownerless Pipedrive deals whose Pipedrive owner is not Aleksander"},{"action":"set deals.owner_id"},{"action":"exclude test user aspalamar"},{"action":"insert automation_rule_executions","details":"deal and assigned owner"}]'::jsonb,
  implementation_refs = '[{"type":"sql_function","name":"public.distribute_invalid_deal_owners"},{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_function","name":"public.pipedrive_deal_is_aleksander_owner"},{"type":"sql_function","name":"public.next_lead_owner"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"}]'::jsonb,
  updated_by = 'Hermes',
  updated_at = now()
where id = 'lead_distribution_round_robin';

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values (
  'lead_distribution_round_robin',
  'implementation_changed',
  'Hermes',
  'Redistribuição manual/invalid-owner agora pula negócios Pipedrive cujo owner Pipedrive não é Aleksander, mantendo-os sem proprietário CRM em Avisos.',
  '{"pipedrive_owner_gate":"only Aleksander-owned Pipedrive deals can be distributed","skipped_state":"ownerless deals remain visible in Avisos"}'::jsonb
);
