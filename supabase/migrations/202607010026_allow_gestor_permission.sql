alter table public.crm_users
  drop constraint if exists crm_users_permission_check;

alter table public.crm_users
  add constraint crm_users_permission_check
  check (permission in ('Admin', 'BPO', 'Gestor', 'Vendas', 'Teste'));
