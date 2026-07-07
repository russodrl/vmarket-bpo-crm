alter table public.crm_users
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-avatars', 'user-avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "user avatars public read" on storage.objects;
create policy "user avatars public read"
on storage.objects for select
to public
using (bucket_id = 'user-avatars');

drop policy if exists "user avatars own upload" on storage.objects;
create policy "user avatars own upload"
on storage.objects for insert
to authenticated
with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "user avatars own update" on storage.objects;
create policy "user avatars own update"
on storage.objects for update
to authenticated
using (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'user-avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "crm users own profile update" on public.crm_users;
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

drop trigger if exists guard_crm_user_self_update on public.crm_users;
create trigger guard_crm_user_self_update
before update on public.crm_users
for each row execute function public.guard_crm_user_self_update();

create policy "crm users own profile update"
on public.crm_users for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

drop policy if exists "activities delete admin" on public.activities;
drop policy if exists "activities delete scope" on public.activities;
create policy "activities delete scope"
on public.activities for delete
to authenticated
using (public.is_admin() or owner_id = auth.uid());
