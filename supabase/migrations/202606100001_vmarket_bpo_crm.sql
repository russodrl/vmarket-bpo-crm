-- VMarket BPO CRM, Supabase schema + RLS + mock seed
-- Rode este arquivo no Supabase SQL Editor do projeto ujmjqbqhipjbkokncjja.
-- Depois crie usuários em Authentication > Users e atualize public.profiles com role/bpo_id.

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin_vmarket', 'bpo_partner');
create type public.deal_status as enum ('quente', 'morno', 'risco', 'ganho', 'perdido');
create type public.activity_status as enum ('open', 'done', 'cancelled');
create type public.field_type as enum ('text', 'large_text', 'single_option', 'multi_option', 'autocomplete', 'numeric', 'monetary', 'user_ref', 'organization_ref', 'person_ref', 'phone', 'time', 'time_range', 'date', 'date_range', 'address', 'formula');

create table public.bpo_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'bpo_partner',
  bpo_id uuid references public.bpo_partners(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null,
  color text default '#10b981',
  created_at timestamptz not null default now(),
  unique(sort_order)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text,
  city text,
  state text,
  cnpjs int default 1,
  monthly_purchase numeric(14,2),
  supplier_count int,
  bpo_id uuid references public.bpo_partners(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  role_title text,
  email text,
  phone text,
  organization_id uuid references public.organizations(id) on delete set null,
  labels text[] default '{}',
  bpo_id uuid references public.bpo_partners(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  bpo_id uuid references public.bpo_partners(id) on delete set null,
  value numeric(14,2) default 0,
  monthly_purchase numeric(14,2),
  estimated_savings numeric(14,2),
  probability int default 50 check (probability >= 0 and probability <= 100),
  status public.deal_status default 'morno',
  source text,
  plan text,
  expected_close_date date,
  score int default 50 check (score >= 0 and score <= 100),
  focus_items text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  activity_type text not null default 'task',
  due_at timestamptz,
  status public.activity_status not null default 'open',
  note text,
  deal_id uuid references public.deals(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  person_id uuid references public.people(id) on delete set null,
  owner_id uuid references public.profiles(id) on delete set null,
  bpo_id uuid references public.bpo_partners(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.custom_fields (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('deal', 'organization', 'person', 'activity')),
  name text not null,
  field_type public.field_type not null,
  options text[] default '{}',
  sort_order int default 0,
  created_at timestamptz not null default now()
);

create table public.custom_field_values (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references public.custom_fields(id) on delete cascade,
  entity_id uuid not null,
  value jsonb not null default 'null'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(field_id, entity_id)
);

create table public.deal_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin_vmarket')
$$;

create or replace function public.current_bpo_id()
returns uuid language sql stable security definer set search_path = public as $$
  select bpo_id from public.profiles where id = auth.uid()
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_organizations before update on public.organizations for each row execute function public.touch_updated_at();
create trigger touch_people before update on public.people for each row execute function public.touch_updated_at();
create trigger touch_deals before update on public.deals for each row execute function public.touch_updated_at();
create trigger touch_activities before update on public.activities for each row execute function public.touch_updated_at();
create trigger touch_custom_field_values before update on public.custom_field_values for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'bpo_partner')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.bpo_partners enable row level security;
alter table public.profiles enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.organizations enable row level security;
alter table public.people enable row level security;
alter table public.deals enable row level security;
alter table public.activities enable row level security;
alter table public.custom_fields enable row level security;
alter table public.custom_field_values enable row level security;
alter table public.deal_history enable row level security;

create policy "stages readable" on public.pipeline_stages for select to authenticated using (true);
create policy "stages admin write" on public.pipeline_stages for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "bpo readable by admin or own" on public.bpo_partners for select to authenticated using (public.is_admin() or id = public.current_bpo_id());
create policy "bpo admin write" on public.bpo_partners for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "profiles readable by admin or self" on public.profiles for select to authenticated using (public.is_admin() or id = auth.uid() or bpo_id = public.current_bpo_id());
create policy "profiles self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin write" on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "organizations scope" on public.organizations for select to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "organizations insert scope" on public.organizations for insert to authenticated with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "organizations update scope" on public.organizations for update to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid()) with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "organizations delete admin" on public.organizations for delete to authenticated using (public.is_admin());

create policy "people scope" on public.people for select to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "people insert scope" on public.people for insert to authenticated with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "people update scope" on public.people for update to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid()) with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "people delete admin" on public.people for delete to authenticated using (public.is_admin());

create policy "deals scope" on public.deals for select to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "deals insert scope" on public.deals for insert to authenticated with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "deals update scope" on public.deals for update to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid()) with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "deals delete admin" on public.deals for delete to authenticated using (public.is_admin());

create policy "activities scope" on public.activities for select to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "activities insert scope" on public.activities for insert to authenticated with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "activities update scope" on public.activities for update to authenticated using (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid()) with check (public.is_admin() or bpo_id = public.current_bpo_id() or owner_id = auth.uid());
create policy "activities delete admin" on public.activities for delete to authenticated using (public.is_admin());

create policy "custom fields readable" on public.custom_fields for select to authenticated using (true);
create policy "custom fields admin write" on public.custom_fields for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "custom values readable" on public.custom_field_values for select to authenticated using (true);
create policy "custom values write authenticated" on public.custom_field_values for all to authenticated using (true) with check (true);

create policy "history scope" on public.deal_history for select to authenticated using (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and (d.bpo_id = public.current_bpo_id() or d.owner_id = auth.uid()))
);
create policy "history insert scoped" on public.deal_history for insert to authenticated with check (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and (d.bpo_id = public.current_bpo_id() or d.owner_id = auth.uid()))
);

insert into public.pipeline_stages (name, sort_order, color) values
('Lead recebido', 1, '#64748b'),
('Diagnóstico', 2, '#0ea5e9'),
('Proposta BPO', 3, '#10b981'),
('Contrato', 4, '#f59e0b'),
('Onboarding', 5, '#8b5cf6'),
('Carteira ativa', 6, '#059669')
on conflict (sort_order) do update set name = excluded.name, color = excluded.color;

insert into public.bpo_partners (name, contact_name, email, phone) values
('Gas na Gestão', 'Equipe Gas na Gestão', 'contato@gastronomiaalemdosabor.com.br', '(21) 99906-2933'),
('Parceiro piloto RJ', 'Consultor Parceiro', 'parceiro.rj@example.com', '(21) 98800-4455')
on conflict do nothing;

insert into public.custom_fields (entity, name, field_type, options, sort_order) values
('deal', 'Volume mensal de compras', 'monetary', '{}', 1),
('deal', 'Plano recomendado', 'single_option', array['Implantação','Implantação + Consultoria','BPO completo'], 2),
('deal', 'Economia estimada', 'formula', '{}', 3),
('organization', 'Tipo de operação', 'single_option', array['Restaurante','Hotel','Bar','Padaria','Rede'], 4),
('person', 'Perfil do decisor', 'multi_option', array['Dono','Financeiro','Comprador','Chef','Gerente'], 5),
('activity', 'Objetivo comercial', 'single_option', array['Diagnóstico','Demo','Proposta','Assinatura','Onboarding'], 6),
('deal', 'BPO parceiro', 'organization_ref', '{}', 7),
('deal', 'Cotação coletiva', 'single_option', array['Elegível','Parcial','Não elegível'], 8)
on conflict do nothing;

with gas as (select id from public.bpo_partners where name = 'Gas na Gestão' limit 1),
rj as (select id from public.bpo_partners where name = 'Parceiro piloto RJ' limit 1),
st_diag as (select id from public.pipeline_stages where name = 'Diagnóstico'),
st_prop as (select id from public.pipeline_stages where name = 'Proposta BPO'),
st_contract as (select id from public.pipeline_stages where name = 'Contrato'),
orgs as (
  insert into public.organizations (name, segment, city, state, cnpjs, monthly_purchase, supplier_count, bpo_id)
  values
  ('Dona Lia Cozinha Brasileira', 'Restaurante médio porte', 'Rio de Janeiro', 'RJ', 1, 82000, 38, (select id from gas)),
  ('Hotel Atlântico Mar', 'Hotel boutique', 'Niterói', 'RJ', 2, 190000, 67, (select id from rj)),
  ('Botânico Bar e Cozinha', 'Bar de bairro', 'São Paulo', 'SP', 1, 42000, 24, (select id from gas))
  returning *
), people_seed as (
  insert into public.people (full_name, role_title, email, phone, organization_id, labels, bpo_id)
  select 'Mariana Alves', 'Dona', 'mariana@donalia.example', '(21) 99900-1212', id, array['Decisor','Food service'], bpo_id from public.organizations where name = 'Dona Lia Cozinha Brasileira'
  union all select 'Paulo Nogueira', 'Gerente geral', 'paulo@atlantico.example', '(21) 98800-4455', id, array['Hotel','Operação média'], bpo_id from public.organizations where name = 'Hotel Atlântico Mar'
  union all select 'Rafael Torres', 'Sócio operador', 'rafael@botanico.example', '(11) 97777-5522', id, array['Bar','Contrato'], bpo_id from public.organizations where name = 'Botânico Bar e Cozinha'
  returning *
), deals_seed as (
  insert into public.deals (title, organization_id, person_id, stage_id, bpo_id, value, monthly_purchase, estimated_savings, probability, status, source, plan, expected_close_date, score, focus_items)
  select 'Restaurante Dona Lia, BPO completo', o.id, p.id, (select id from st_prop), o.bpo_id, 1899, 82000, 9840, 72, 'quente', 'Lead sub-50k VMarket', 'BPO completo + Essencial', current_date + 8, 86, array['Enviar simulação de economia por CMV','Confirmar CNPJs e fornecedores ativos','Agendar diagnóstico de 5 dias úteis'] from public.organizations o join public.people p on p.organization_id=o.id where o.name='Dona Lia Cozinha Brasileira'
  union all select 'Hotel Atlântico, implantação + consultoria', o.id, p.id, (select id from st_diag), o.bpo_id, 1200, 190000, 15200, 54, 'morno', 'Prospecção BPO', 'Implantação + Consultoria', current_date + 15, 71, array['Receber planilha de fornecedores','Validar integração com fluxo atual','Marcar demo de dashboard e curva ABC'] from public.organizations o join public.people p on p.organization_id=o.id where o.name='Hotel Atlântico Mar'
  union all select 'Bar Botânico, implantação', o.id, p.id, (select id from st_contract), o.bpo_id, 2500, 42000, 3360, 88, 'ganho', 'Indicação BPO', 'Implantação', current_date + 2, 79, array['Subir cadastro de fornecedores','Programar capacitação de 8 horas','Abrir projeto de onboarding'] from public.organizations o join public.people p on p.organization_id=o.id where o.name='Botânico Bar e Cozinha'
  returning *
)
insert into public.activities (title, activity_type, due_at, status, deal_id, organization_id, person_id, bpo_id, note)
select 'Qualificar lead sub-50k', 'call', now() + interval '4 hours', 'open', d.id, d.organization_id, d.person_id, d.bpo_id, 'Confirmar dor de compras por WhatsApp' from public.deals d where d.title like 'Restaurante Dona Lia%'
union all select 'Diagnóstico gratuito', 'meeting', now() + interval '1 day', 'open', d.id, d.organization_id, d.person_id, d.bpo_id, 'Solicitar compras dos últimos 3 meses' from public.deals d where d.title like 'Hotel Atlântico%'
union all select 'Enviar proposta com ROI', 'email', now() + interval '6 hours', 'open', d.id, d.organization_id, d.person_id, d.bpo_id, 'Enviar PDF e simulação de economia' from public.deals d where d.title like 'Bar Botânico%';

insert into public.deal_history (deal_id, event_type, title, description)
select id, 'Atividade', 'Call de qualificação concluída', 'Cliente confirmou dor com cotação por WhatsApp' from public.deals where title like 'Restaurante Dona Lia%'
union all select id, 'Campo', 'Plano recomendado alterado para BPO completo', 'Atualizado durante diagnóstico' from public.deals where title like 'Restaurante Dona Lia%'
union all select id, 'Nota', 'Compras representam 36% do faturamento', 'Dado usado na proposta' from public.deals where title like 'Restaurante Dona Lia%';
