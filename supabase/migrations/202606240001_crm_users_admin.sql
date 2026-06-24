-- CRM users, companies, owner-based visibility and admin user panel support

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email citext not null unique,
  company_id uuid not null references public.crm_companies(id) on delete restrict,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'invited', 'active', 'disabled')),
  last_invited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists crm_user_id uuid references public.crm_users(id) on delete set null;
alter table public.profiles add column if not exists crm_company_id uuid references public.crm_companies(id) on delete set null;

create trigger touch_crm_companies before update on public.crm_companies for each row execute function public.touch_updated_at();
create trigger touch_crm_users before update on public.crm_users for each row execute function public.touch_updated_at();

create or replace function public.current_crm_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select crm_company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  matched_crm_user public.crm_users%rowtype;
begin
  select * into matched_crm_user
  from public.crm_users
  where email = new.email::citext
  limit 1;

  insert into public.profiles (id, full_name, role, crm_user_id, crm_company_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', matched_crm_user.full_name, new.email),
    'bpo_partner',
    matched_crm_user.id,
    matched_crm_user.company_id
  )
  on conflict (id) do update set
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    crm_user_id = coalesce(excluded.crm_user_id, public.profiles.crm_user_id),
    crm_company_id = coalesce(excluded.crm_company_id, public.profiles.crm_company_id),
    updated_at = now();

  if matched_crm_user.id is not null then
    update public.crm_users
    set auth_user_id = new.id,
        status = 'active',
        updated_at = now()
    where id = matched_crm_user.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.crm_companies enable row level security;
alter table public.crm_users enable row level security;

drop policy if exists "crm companies read" on public.crm_companies;
drop policy if exists "crm companies admin write" on public.crm_companies;
create policy "crm companies read" on public.crm_companies for select to authenticated using (public.is_admin() or id = public.current_crm_company_id());
create policy "crm companies admin write" on public.crm_companies for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "crm users read" on public.crm_users;
drop policy if exists "crm users admin write" on public.crm_users;
create policy "crm users read" on public.crm_users for select to authenticated using (public.is_admin() or auth_user_id = auth.uid());
create policy "crm users admin write" on public.crm_users for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Make business records private to the CRM user owner. Admin sees all.
drop policy if exists "profiles readable by admin or self" on public.profiles;
drop policy if exists "profiles self update" on public.profiles;
drop policy if exists "profiles admin write" on public.profiles;
create policy "profiles readable by admin or self" on public.profiles for select to authenticated using (public.is_admin() or id = auth.uid());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "organizations scope" on public.organizations;
drop policy if exists "organizations insert scope" on public.organizations;
drop policy if exists "organizations update scope" on public.organizations;
drop policy if exists "organizations delete admin" on public.organizations;
create policy "organizations scope" on public.organizations for select to authenticated using (public.is_admin() or owner_id = auth.uid());
create policy "organizations insert scope" on public.organizations for insert to authenticated with check (public.is_admin() or owner_id = auth.uid());
create policy "organizations update scope" on public.organizations for update to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy "organizations delete admin" on public.organizations for delete to authenticated using (public.is_admin());

drop policy if exists "people scope" on public.people;
drop policy if exists "people insert scope" on public.people;
drop policy if exists "people update scope" on public.people;
drop policy if exists "people delete admin" on public.people;
create policy "people scope" on public.people for select to authenticated using (public.is_admin() or owner_id = auth.uid());
create policy "people insert scope" on public.people for insert to authenticated with check (public.is_admin() or owner_id = auth.uid());
create policy "people update scope" on public.people for update to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy "people delete admin" on public.people for delete to authenticated using (public.is_admin());

drop policy if exists "deals scope" on public.deals;
drop policy if exists "deals insert scope" on public.deals;
drop policy if exists "deals update scope" on public.deals;
drop policy if exists "deals delete admin" on public.deals;
create policy "deals scope" on public.deals for select to authenticated using (public.is_admin() or owner_id = auth.uid());
create policy "deals insert scope" on public.deals for insert to authenticated with check (public.is_admin() or owner_id = auth.uid());
create policy "deals update scope" on public.deals for update to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy "deals delete admin" on public.deals for delete to authenticated using (public.is_admin());

drop policy if exists "activities scope" on public.activities;
drop policy if exists "activities insert scope" on public.activities;
drop policy if exists "activities update scope" on public.activities;
drop policy if exists "activities delete admin" on public.activities;
create policy "activities scope" on public.activities for select to authenticated using (public.is_admin() or owner_id = auth.uid());
create policy "activities insert scope" on public.activities for insert to authenticated with check (public.is_admin() or owner_id = auth.uid());
create policy "activities update scope" on public.activities for update to authenticated using (public.is_admin() or owner_id = auth.uid()) with check (public.is_admin() or owner_id = auth.uid());
create policy "activities delete admin" on public.activities for delete to authenticated using (public.is_admin());

drop policy if exists "history scope" on public.deal_history;
drop policy if exists "history insert scoped" on public.deal_history;
create policy "history scope" on public.deal_history for select to authenticated using (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
);
create policy "history insert scoped" on public.deal_history for insert to authenticated with check (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
);

with seed(full_name, email, company_name) as (
  values
    ('Felippe Saadia', 'financeiro@flowgestaofinanceira.com', 'FLOW360'),
    ('Adriano Bispo dos Santos', 'adriano.bsp1@gmail.com', 'Supleasy'),
    ('Guilherme Araújo de Sá e Camargo', 'guiaraujo532@gmail.com', 'GSA BPO Compras'),
    ('Felipe José Campos Valina', 'felipejcvalina@gmail.com', 'Compra Certa Food'),
    ('Elaine Cristina Domingos Guedes', 'contato@almeconsultoria.com.br', 'Alme Consultoria'),
    ('Renata Almeida', 'contato@gastronomiaalemdosabor.com.br', 'Gas na Gestão'),
    ('Henrique Malta Coelho', 'henrique.vmarket@gmail.com', 'HM Vale Representações'),
    ('Felipe Ferreira Teixeira', 'felipeft01@gmail.com', 'Felipe Ferreira Teixeira')
), companies as (
  insert into public.crm_companies (name)
  select distinct company_name from seed
  on conflict (name) do update set name = excluded.name
  returning id, name
)
insert into public.crm_users (full_name, email, company_id, status)
select seed.full_name, seed.email::citext, companies.id, 'pending'
from seed
join companies on companies.name = seed.company_name
on conflict (email) do update set
  full_name = excluded.full_name,
  company_id = excluded.company_id,
  updated_at = now();

-- Link any existing auth users to the seeded CRM users by email.
update public.crm_users cu
set auth_user_id = au.id,
    status = case when cu.status = 'pending' then 'active' else cu.status end,
    updated_at = now()
from auth.users au
where cu.email = au.email::citext
  and (cu.auth_user_id is distinct from au.id);

update public.profiles p
set crm_user_id = cu.id,
    crm_company_id = cu.company_id,
    full_name = coalesce(p.full_name, cu.full_name),
    updated_at = now()
from public.crm_users cu
where p.id = cu.auth_user_id
  and (p.crm_user_id is distinct from cu.id or p.crm_company_id is distinct from cu.company_id);

-- Current operator remains the admin account.
update public.profiles p
set role = 'admin_vmarket', full_name = 'Admin', updated_at = now()
from auth.users au
where p.id = au.id
  and lower(au.email) = 'russo@digitalrootslab.com.br';
