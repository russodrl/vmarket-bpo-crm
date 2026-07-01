alter table public.crm_users
  add column if not exists permission text not null default 'BPO';

alter table public.crm_users
  drop constraint if exists crm_users_permission_check;

alter table public.crm_users
  add constraint crm_users_permission_check
  check (permission in ('Admin', 'BPO', 'Vendas', 'Teste'));

update public.crm_users
set permission = 'Teste'
where lower(coalesce(email, '')) like '%teste%'
   or lower(coalesce(full_name, '')) like '%teste%';
