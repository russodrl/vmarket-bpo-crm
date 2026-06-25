-- Add Tally partner registration fields to CRM users

alter table public.crm_users add column if not exists legal_company_name text;
alter table public.crm_users add column if not exists cnpj text;
alter table public.crm_users add column if not exists headquarters_address text;
alter table public.crm_users add column if not exists state_registration text;

alter table public.crm_users add column if not exists legal_representative_name text;
alter table public.crm_users add column if not exists nationality text;
alter table public.crm_users add column if not exists marital_status text;
alter table public.crm_users add column if not exists profession text;
alter table public.crm_users add column if not exists rg_issuer text;
alter table public.crm_users add column if not exists cpf text;
alter table public.crm_users add column if not exists company_role text;
alter table public.crm_users add column if not exists primary_email citext;

alter table public.crm_users add column if not exists crm_phone text;
alter table public.crm_users add column if not exists additional_contacts jsonb not null default '[]'::jsonb;

alter table public.crm_users add column if not exists issues_service_invoice boolean;
alter table public.crm_users add column if not exists bank_name text;
alter table public.crm_users add column if not exists bank_agency text;
alter table public.crm_users add column if not exists bank_account text;
alter table public.crm_users add column if not exists pix_key text;

alter table public.crm_users add column if not exists service_regions text;
alter table public.crm_users add column if not exists operation_types text[] not null default '{}'::text[];
alter table public.crm_users add column if not exists monthly_new_clients_capacity integer;
alter table public.crm_users add column if not exists food_service_experience text;
alter table public.crm_users add column if not exists current_clients_count integer;
alter table public.crm_users add column if not exists current_purchasing_clients_count integer;
alter table public.crm_users add column if not exists purchasing_ticket_avg numeric;
alter table public.crm_users add column if not exists offered_services text[] not null default '{}'::text[];
alter table public.crm_users add column if not exists data_authorization text;

alter table public.crm_users add column if not exists tally_form_id text;
alter table public.crm_users add column if not exists tally_submission_id text unique;
alter table public.crm_users add column if not exists tally_submitted_at timestamptz;
alter table public.crm_users add column if not exists tally_synced_at timestamptz;

create index if not exists idx_crm_users_cnpj on public.crm_users (cnpj);
create index if not exists idx_crm_users_tally_submission_id on public.crm_users (tally_submission_id);
create index if not exists idx_crm_users_service_regions on public.crm_users using gin (to_tsvector('portuguese', coalesce(service_regions, '')));
