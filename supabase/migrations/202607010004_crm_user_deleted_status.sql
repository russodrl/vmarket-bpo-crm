-- Allow soft-deleted CRM users so historical deal ownership can keep showing the original assignee.

alter table public.crm_users
  drop constraint if exists crm_users_status_check;

alter table public.crm_users
  add constraint crm_users_status_check
  check (status in ('pending', 'invited', 'active', 'disabled', 'deleted'));
