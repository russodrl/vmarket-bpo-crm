-- Direct Pipedrive integration layer for VMarket BPO CRM
-- Run after 202606100001_vmarket_bpo_crm.sql.

create extension if not exists pgcrypto;

create table if not exists public.external_integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('pipedrive')),
  name text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  base_url text not null default 'https://api.pipedrive.com/v1',
  webhook_secret_hint text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, name)
);

create table if not exists public.external_records (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.external_integrations(id) on delete cascade,
  provider text not null default 'pipedrive' check (provider in ('pipedrive')),
  entity text not null check (entity in ('deal', 'organization', 'person', 'activity')),
  internal_id uuid not null,
  external_id text not null,
  external_key text,
  last_payload jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, entity, external_id),
  unique(provider, entity, internal_id)
);

create table if not exists public.external_field_mappings (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.external_integrations(id) on delete cascade,
  custom_field_id uuid references public.custom_fields(id) on delete cascade,
  entity text not null check (entity in ('deal', 'organization', 'person', 'activity')),
  crm_field text,
  provider text not null default 'pipedrive' check (provider in ('pipedrive')),
  provider_field_id text,
  provider_field_key text not null,
  provider_field_name text,
  direction text not null default 'bidirectional' check (direction in ('inbound', 'outbound', 'bidirectional')),
  transform text,
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (custom_field_id is not null or crm_field is not null),
  unique(integration_id, entity, provider_field_key)
);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references public.external_integrations(id) on delete set null,
  provider text not null default 'pipedrive' check (provider in ('pipedrive')),
  event_type text not null,
  entity text,
  external_id text,
  internal_id uuid,
  direction text not null check (direction in ('inbound', 'outbound')),
  status text not null default 'received' check (status in ('received', 'processing', 'success', 'error', 'ignored')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.integration_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.integration_events(id) on delete cascade,
  level text not null default 'info' check (level in ('debug', 'info', 'warning', 'error')),
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

drop trigger if exists touch_external_integrations on public.external_integrations;
drop trigger if exists touch_external_records on public.external_records;
drop trigger if exists touch_external_field_mappings on public.external_field_mappings;
create trigger touch_external_integrations before update on public.external_integrations for each row execute function public.touch_updated_at();
create trigger touch_external_records before update on public.external_records for each row execute function public.touch_updated_at();
create trigger touch_external_field_mappings before update on public.external_field_mappings for each row execute function public.touch_updated_at();

alter table public.external_integrations enable row level security;
alter table public.external_records enable row level security;
alter table public.external_field_mappings enable row level security;
alter table public.integration_events enable row level security;
alter table public.integration_logs enable row level security;

drop policy if exists "external integrations admin read" on public.external_integrations;
drop policy if exists "external integrations admin write" on public.external_integrations;
create policy "external integrations admin read" on public.external_integrations for select to authenticated using (public.is_admin());
create policy "external integrations admin write" on public.external_integrations for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "external records admin read" on public.external_records;
drop policy if exists "external records admin write" on public.external_records;
create policy "external records admin read" on public.external_records for select to authenticated using (public.is_admin());
create policy "external records admin write" on public.external_records for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "external field mappings admin read" on public.external_field_mappings;
drop policy if exists "external field mappings admin write" on public.external_field_mappings;
create policy "external field mappings admin read" on public.external_field_mappings for select to authenticated using (public.is_admin());
create policy "external field mappings admin write" on public.external_field_mappings for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "integration events admin read" on public.integration_events;
drop policy if exists "integration events admin write" on public.integration_events;
create policy "integration events admin read" on public.integration_events for select to authenticated using (public.is_admin());
create policy "integration events admin write" on public.integration_events for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "integration logs admin read" on public.integration_logs;
drop policy if exists "integration logs admin write" on public.integration_logs;
create policy "integration logs admin read" on public.integration_logs for select to authenticated using (public.is_admin());
create policy "integration logs admin write" on public.integration_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.external_integrations (provider, name, status, base_url, webhook_secret_hint)
values ('pipedrive', 'Pipedrive principal', 'active', 'https://api.pipedrive.com/v1', 'Configure PIPEDRIVE_WEBHOOK_SECRET as Supabase Function secret')
on conflict (provider, name) do update set status = excluded.status, base_url = excluded.base_url;

-- Suggested CRM native field mappings. Provider field keys must be replaced by actual Pipedrive keys after inspecting /dealFields.
with integration as (
  select id from public.external_integrations where provider = 'pipedrive' and name = 'Pipedrive principal' limit 1
)
insert into public.external_field_mappings (integration_id, entity, crm_field, provider_field_key, provider_field_name, direction)
select id, 'deal', 'title', 'title', 'Title', 'bidirectional' from integration
union all select id, 'deal', 'value', 'value', 'Value', 'bidirectional' from integration
union all select id, 'deal', 'status', 'status', 'Status', 'bidirectional' from integration
union all select id, 'deal', 'expected_close_date', 'expected_close_date', 'Expected close date', 'bidirectional' from integration
union all select id, 'organization', 'name', 'org_id.name', 'Organization name', 'bidirectional' from integration
union all select id, 'person', 'full_name', 'person_id.name', 'Person name', 'bidirectional' from integration
on conflict (integration_id, entity, provider_field_key) do nothing;
