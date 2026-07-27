-- Allow Supabase Auth's internal user-created trigger to bind a pending CRM user
-- to the newly created auth user. The trigger runs without a request JWT, so
-- auth.role() is NULL rather than service_role, while regular browser updates
-- are still constrained by RLS and the self-update guard below.

create or replace function public.guard_crm_user_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  if auth.uid() is null
    and old.auth_user_id is null
    and new.auth_user_id is not null
    and new.status = 'active'
    and new.id = old.id
    and new.company_id = old.company_id
    and coalesce(new.permission::text, '') = coalesce(old.permission::text, '')
    and coalesce(new.ddd_prefix, '') = coalesce(old.ddd_prefix, '')
    and coalesce(new.ddd_state, '') = coalesce(old.ddd_state, '')
    and coalesce(new.ddd_region, '') = coalesce(old.ddd_region, '')
    and coalesce(new.last_invited_at::text, '') = coalesce(old.last_invited_at::text, '')
    and coalesce(new.password_reset_sent_at::text, '') = coalesce(old.password_reset_sent_at::text, '')
    and coalesce(new.password_reset_completed_at::text, '') = coalesce(old.password_reset_completed_at::text, '')
    and coalesce(new.tally_form_id, '') = coalesce(old.tally_form_id, '')
    and coalesce(new.tally_submission_id, '') = coalesce(old.tally_submission_id, '')
  then
    return new;
  end if;

  if old.auth_user_id = auth.uid()
    and new.id = old.id
    and new.company_id = old.company_id
    and new.auth_user_id = old.auth_user_id
    and new.status = old.status
    and coalesce(new.permission::text, '') = coalesce(old.permission::text, '')
    and coalesce(new.ddd_prefix, '') = coalesce(old.ddd_prefix, '')
    and coalesce(new.ddd_state, '') = coalesce(old.ddd_state, '')
    and coalesce(new.ddd_region, '') = coalesce(old.ddd_region, '')
    and coalesce(new.last_invited_at::text, '') = coalesce(old.last_invited_at::text, '')
    and coalesce(new.password_reset_sent_at::text, '') = coalesce(old.password_reset_sent_at::text, '')
    and coalesce(new.password_reset_completed_at::text, '') = coalesce(old.password_reset_completed_at::text, '')
    and coalesce(new.tally_form_id, '') = coalesce(old.tally_form_id, '')
    and coalesce(new.tally_submission_id, '') = coalesce(old.tally_submission_id, '')
  then
    return new;
  end if;

  raise exception 'Usuários comuns só podem editar nome, email, telefone e foto do próprio perfil.';
end;
$$;
