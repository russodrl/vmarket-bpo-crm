-- Protege tabelas internas da distribuição automática de leads.
-- A chave anon do Supabase é pública por design; portanto estas filas só podem ser
-- manipuladas por funções SECURITY DEFINER internas e pelo service_role.

alter table public.lead_distribution_company_queue enable row level security;
alter table public.lead_distribution_user_queue enable row level security;
alter table public.lead_distribution_user_exclusions enable row level security;

-- Sem policies: anon/authenticated não têm leitura/escrita direta via PostgREST.
-- Revoke explícito reduz a superfície mesmo fora do caminho de RLS.
revoke all on table public.lead_distribution_company_queue from anon, authenticated;
revoke all on table public.lead_distribution_user_queue from anon, authenticated;
revoke all on table public.lead_distribution_user_exclusions from anon, authenticated;

grant select, insert, update, delete on table public.lead_distribution_company_queue to service_role;
grant select, insert, update, delete on table public.lead_distribution_user_queue to service_role;
grant select, insert, update, delete on table public.lead_distribution_user_exclusions to service_role;

-- Estas funções alteram/consultam a fila interna e não devem ser RPC pública.
revoke execute on function public.next_lead_owner(uuid) from public, anon, authenticated;
revoke execute on function public.distribute_unassigned_leads() from public, anon, authenticated;
revoke execute on function public.next_lead_company_by_location(text, text) from public, anon, authenticated;
revoke execute on function public.lead_distribution_user_is_eligible(uuid, text, text, text, text, text) from public, anon, authenticated;

grant execute on function public.next_lead_owner(uuid) to service_role;
grant execute on function public.distribute_unassigned_leads() to service_role;
grant execute on function public.next_lead_company_by_location(text, text) to service_role;
grant execute on function public.lead_distribution_user_is_eligible(uuid, text, text, text, text, text) to service_role;
