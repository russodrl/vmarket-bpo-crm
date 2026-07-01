drop policy if exists "organizations scope" on public.organizations;
drop policy if exists "organizations update scope" on public.organizations;
drop policy if exists "people scope" on public.people;
drop policy if exists "people update scope" on public.people;

create policy "organizations scope" on public.organizations
for select to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.deals d
    where d.organization_id = organizations.id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);

create policy "organizations update scope" on public.organizations
for update to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.deals d
    where d.organization_id = organizations.id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
)
with check (
  public.is_admin()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.deals d
    where d.organization_id = organizations.id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);

create policy "people scope" on public.people
for select to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.deals d
    where d.person_id = people.id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);

create policy "people update scope" on public.people
for update to authenticated
using (
  public.is_admin()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.deals d
    where d.person_id = people.id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
)
with check (
  public.is_admin()
  or owner_id = auth.uid()
  or exists (
    select 1
    from public.deals d
    where d.person_id = people.id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);
