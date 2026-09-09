-- Authorized transfer: Felipe -> Arthur; Arthur is the only Compra Certa recipient.
-- Preserve the existing recipients of other companies and all deal stages/statuses.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
begin
  if not exists (
    select 1 from public.crm_users u join public.profiles p on p.id = u.auth_user_id
    where u.email = 'arthur@arthurmontenegro.com.br'
      and u.auth_user_id = '983e7cdd-d130-473a-83ef-760b2e0dc55a'
      and u.company_id = '5b6167d0-19cf-4d9d-9787-d3900efc9b87'
      and p.crm_company_id = u.company_id and u.status = 'active'
  ) then raise exception 'Arthur active company/profile verification failed'; end if;
  if not exists (
    select 1 from public.crm_users where email = 'felipejcvalina@gmail.com'
      and auth_user_id = 'ba2f0a29-23e8-416c-a4f3-2a906e290f4d'
      and company_id = '5b6167d0-19cf-4d9d-9787-d3900efc9b87'
  ) then raise exception 'Felipe identity verification failed'; end if;
end $$;

update public.deals set owner_id = '983e7cdd-d130-473a-83ef-760b2e0dc55a'
where owner_id = 'ba2f0a29-23e8-416c-a4f3-2a906e290f4d';
update public.people set owner_id = '983e7cdd-d130-473a-83ef-760b2e0dc55a'
where owner_id = 'ba2f0a29-23e8-416c-a4f3-2a906e290f4d';
update public.organizations set owner_id = '983e7cdd-d130-473a-83ef-760b2e0dc55a'
where owner_id = 'ba2f0a29-23e8-416c-a4f3-2a906e290f4d';
update public.activities set owner_id = '983e7cdd-d130-473a-83ef-760b2e0dc55a'
where owner_id = 'ba2f0a29-23e8-416c-a4f3-2a906e290f4d';

insert into public.lead_distribution_user_exclusions(auth_user_id, reason)
select auth_user_id, 'Compra Certa Food: somente Arthur Montenegro recebe novos leads; autorizado por Russo.'
from public.crm_users
where company_id = '5b6167d0-19cf-4d9d-9787-d3900efc9b87'
  and auth_user_id is not null and auth_user_id <> '983e7cdd-d130-473a-83ef-760b2e0dc55a'
on conflict (auth_user_id) do update set reason = excluded.reason, updated_at = now();
delete from public.lead_distribution_user_exclusions where auth_user_id = '983e7cdd-d130-473a-83ef-760b2e0dc55a';
delete from public.lead_distribution_user_queue q using public.crm_users u
where q.auth_user_id = u.auth_user_id and u.company_id = '5b6167d0-19cf-4d9d-9787-d3900efc9b87'
  and u.auth_user_id <> '983e7cdd-d130-473a-83ef-760b2e0dc55a';

create or replace function public.lead_distribution_user_is_eligible(
 candidate_auth_user_id uuid, candidate_role text, candidate_permission text,
 candidate_status text, candidate_full_name text, candidate_email text
) returns boolean language sql stable security definer set search_path to 'public'
as $function$
 select candidate_auth_user_id is not null
 and candidate_status = 'active'
 and not exists (select 1 from public.lead_distribution_user_exclusions ex where ex.auth_user_id = candidate_auth_user_id)
 and not public.crm_assignment_user_is_test(candidate_full_name, candidate_email)
 and lower(coalesce(candidate_email, '')) in (
   'adriano.bsp1@gmail.com', 'renata@gasnagestao.com.br', 'arthur@arthurmontenegro.com.br'
 )
 and not exists (
   select 1 from public.crm_users u
   where u.auth_user_id = candidate_auth_user_id
     and u.company_id = '5b6167d0-19cf-4d9d-9787-d3900efc9b87'
     and u.auth_user_id <> '983e7cdd-d130-473a-83ef-760b2e0dc55a'
 );
$function$;

with previous as (
 select * from public.automation_rules where id = 'lead_distribution_round_robin'
), changed as (
 update public.automation_rules r
 set filters = (
   select jsonb_agg(case when f->>'field' = 'crm_users.email'
     then jsonb_set(f, '{value}', '["adriano.bsp1@gmail.com","renata@gasnagestao.com.br","arthur@arthurmontenegro.com.br"]'::jsonb)
     else f end)
   from jsonb_array_elements(r.filters) f
 ),
 actions = r.actions || '[{"action":"Compra Certa Food: somente Arthur Montenegro recebe novos leads; demais empresas preservadas"}]'::jsonb,
 updated_by = 'Russo via bpo-agent', updated_at = now()
 where r.id = 'lead_distribution_round_robin'
 returning r.*
)
insert into public.automation_rule_changes(rule_id, change_type, changed_by, summary, before_snapshot, after_snapshot)
select changed.id, 'updated', 'Russo via bpo-agent',
 'Compra Certa: Arthur como único destinatário; Felipe excluído da fila, Erica permanece excluída. Registros de Felipe transferidos para Arthur. Adriano e Renata preservados.',
 to_jsonb(previous), to_jsonb(changed)
from previous cross join changed;
commit;
