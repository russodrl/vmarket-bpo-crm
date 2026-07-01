alter table public.crm_users
  add column if not exists password_reset_sent_at timestamptz,
  add column if not exists password_reset_completed_at timestamptz;

create or replace function public.mark_own_crm_password_reset_completed()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.crm_users
  set password_reset_completed_at = now(),
      updated_at = now()
  where auth_user_id = auth.uid();
end;
$$;

grant execute on function public.mark_own_crm_password_reset_completed() to authenticated;
