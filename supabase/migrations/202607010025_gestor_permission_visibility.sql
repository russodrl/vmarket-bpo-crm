-- Add CRM user permission "Gestor".
-- Gestor keeps the normal BPO profile/access level, but can read CRM data owned by BPO users.

create or replace function public.current_crm_permission()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(cu.permission, 'BPO')
  from public.profiles p
  left join public.crm_users cu on cu.id = p.crm_user_id
  where p.id = auth.uid()
  limit 1
$$;

create or replace function public.is_gestor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_crm_permission(), 'BPO') = 'Gestor'
$$;

create or replace function public.gestor_can_view_auth_user(target_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_auth_user_id is not null
    and (
      target_auth_user_id = auth.uid()
      or public.is_admin()
      or (
        public.is_gestor()
        and exists (
          select 1
          from public.crm_users cu
          where cu.auth_user_id = target_auth_user_id
            and cu.status = 'active'
            and coalesce(cu.permission, 'BPO') = 'BPO'
        )
      )
    )
$$;

create or replace function public.gestor_can_view_deal(target_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deals d
    where d.id = target_deal_id
      and public.gestor_can_view_auth_user(d.owner_id)
  )
$$;

-- CRM admin/user directory visibility.
drop policy if exists "crm companies read" on public.crm_companies;
create policy "crm companies read" on public.crm_companies
for select to authenticated
using (
  public.is_admin()
  or id = public.current_crm_company_id()
  or (
    public.is_gestor()
    and exists (
      select 1
      from public.crm_users cu
      where cu.company_id = crm_companies.id
        and cu.status = 'active'
        and coalesce(cu.permission, 'BPO') = 'BPO'
    )
  )
);

drop policy if exists "crm users read" on public.crm_users;
create policy "crm users read" on public.crm_users
for select to authenticated
using (
  public.is_admin()
  or auth_user_id = auth.uid()
  or (
    public.is_gestor()
    and status = 'active'
    and coalesce(permission, 'BPO') = 'BPO'
  )
);

drop policy if exists "profiles readable by admin or self" on public.profiles;
create policy "profiles readable by admin or self" on public.profiles
for select to authenticated
using (
  public.is_admin()
  or id = auth.uid()
  or (
    public.is_gestor()
    and exists (
      select 1
      from public.crm_users cu
      where cu.auth_user_id = profiles.id
        and cu.status = 'active'
        and coalesce(cu.permission, 'BPO') = 'BPO'
    )
  )
);

-- Business rows: Gestor can read rows owned by active BPO users, while write permissions stay BPO-like.
drop policy if exists "deals scope" on public.deals;
create policy "deals scope" on public.deals
for select to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or public.gestor_can_view_auth_user(owner_id)
);

drop policy if exists "organizations scope" on public.organizations;
create policy "organizations scope" on public.organizations
for select to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or public.gestor_can_view_auth_user(owner_id)
  or exists (
    select 1
    from public.deals d
    where d.organization_id = organizations.id
      and public.gestor_can_view_auth_user(d.owner_id)
  )
);

drop policy if exists "people scope" on public.people;
create policy "people scope" on public.people
for select to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or public.gestor_can_view_auth_user(owner_id)
  or exists (
    select 1
    from public.deals d
    where d.person_id = people.id
      and public.gestor_can_view_auth_user(d.owner_id)
  )
);

drop policy if exists "activities scope" on public.activities;
create policy "activities scope" on public.activities
for select to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or public.gestor_can_view_auth_user(owner_id)
  or public.gestor_can_view_deal(deal_id)
);

drop policy if exists "history scope" on public.deal_history;
create policy "history scope" on public.deal_history
for select to authenticated
using (
  public.is_admin()
  or public.gestor_can_view_deal(deal_id)
  or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
);

drop policy if exists "deal attachments select scope" on public.deal_attachments;
create policy "deal attachments select scope" on public.deal_attachments
for select to authenticated
using (
  public.is_admin()
  or uploaded_by = auth.uid()
  or public.gestor_can_view_deal(deal_id)
  or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
);

