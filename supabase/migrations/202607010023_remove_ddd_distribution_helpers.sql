drop function if exists public.next_lead_owner_by_location(text, text);
drop function if exists public.lead_distribution_queue_for_location(text, text);

update public.automation_rule_changes
set after_snapshot = after_snapshot || '{"ddd_state_queue_removed":true}'::jsonb
where rule_id = 'lead_distribution_round_robin'
  and summary = 'Distribuição agora exclui usuários com permissão Admin ou Teste, além de usuários de teste como Aspalamar.';
