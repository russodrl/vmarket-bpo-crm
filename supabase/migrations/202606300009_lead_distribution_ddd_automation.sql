-- Normalize current lead source, register lead distribution, and enrich contact DDD fields.

alter table public.people
  add column if not exists ddd_prefix text,
  add column if not exists ddd_state text,
  add column if not exists ddd_region text;

create table if not exists public.ddd_prefixes (
  prefix text primary key,
  state text not null,
  region text not null,
  source_url text not null default 'https://pt.wikipedia.org/wiki/Discagem_direta_a_dist%C3%A2ncia',
  updated_at timestamptz not null default now()
);

insert into public.ddd_prefixes (prefix, state, region)
values
  ('11','São Paulo','Região Metropolitana de São Paulo / Região Metropolitana de Jundiaí / Região Geográfica Imediata de Bragança Paulista'),
  ('12','São Paulo','Região Metropolitana do Vale do Paraíba e Litoral Norte'),
  ('13','São Paulo','Região Metropolitana da Baixada Santista / Vale do Ribeira'),
  ('14','São Paulo','Avaré / Bauru / Botucatu / Jaú / Lins / Marília / Ourinhos'),
  ('15','São Paulo','Itapetininga / Itapeva / Sorocaba / Tatuí'),
  ('16','São Paulo','Araraquara / Franca / Jaboticabal / Matão / Ribeirão Preto / São Carlos / Sertãozinho'),
  ('17','São Paulo','Barretos / Bebedouro / Catanduva / Fernandópolis / São José do Rio Preto / Votuporanga'),
  ('18','São Paulo','Araçatuba / Assis / Birigui / Presidente Prudente'),
  ('19','São Paulo','Americana / Araras / Campinas / Indaiatuba / Limeira / Piracicaba / Rio Claro / Santa Bárbara D''Oeste / São João da Boa Vista / Sumaré'),
  ('21','Rio de Janeiro','Rio de Janeiro e Região Metropolitana / Teresópolis'),
  ('22','Rio de Janeiro','Cabo Frio / Campos dos Goytacazes / Itaperuna / Macaé / Nova Friburgo'),
  ('24','Rio de Janeiro','Angra dos Reis / Petrópolis / Volta Redonda / Piraí'),
  ('27','Espírito Santo','Vitória e Região Metropolitana / Colatina / Linhares / Santa Maria de Jetibá'),
  ('28','Espírito Santo','Cachoeiro de Itapemirim / Castelo / Itapemirim / Marataízes'),
  ('31','Minas Gerais','Belo Horizonte e Região Metropolitana / Conselheiro Lafaiete / Ipatinga / Viçosa'),
  ('32','Minas Gerais','Barbacena / Juiz de Fora / Muriaé / São João del-Rei / Ubá'),
  ('33','Minas Gerais','Almenara / Caratinga / Governador Valadares / Manhuaçu / Teófilo Otoni'),
  ('34','Minas Gerais','Araguari / Araxá / Patos de Minas / Uberlândia / Uberaba'),
  ('35','Minas Gerais','Alfenas / Guaxupé / Lavras / Poços de Caldas / Pouso Alegre / Varginha'),
  ('37','Minas Gerais','Bom Despacho / Divinópolis / Formiga / Itaúna / Pará de Minas'),
  ('38','Minas Gerais','Curvelo / Diamantina / Montes Claros / Pirapora / Unaí'),
  ('41','Paraná','Curitiba , Região Metropolitana e Litoral do Paraná'),
  ('42','Paraná','Ponta Grossa / Guarapuava'),
  ('43','Paraná','Apucarana / Londrina'),
  ('44','Paraná','Maringá / Campo Mourão / Umuarama'),
  ('45','Paraná','Cascavel / Foz do Iguaçu'),
  ('46','Paraná','Francisco Beltrão / Pato Branco'),
  ('47','Santa Catarina','Blumenau/ Itajaí / Navegantes / Joinville / Brusque/ Pomerode / Rio do Sul / Balneário Camboriú'),
  ('48','Santa Catarina','Florianópolis e Região Metropolitana / Nova Trento / São João Batista / Criciúma'),
  ('49','Santa Catarina','Caçador / Chapecó / Concórdia / Lages'),
  ('51','Rio Grande do Sul','Porto Alegre e Região Metropolitana / Santa Cruz do Sul / Litoral Norte'),
  ('53','Rio Grande do Sul','Pelotas / Rio Grande'),
  ('54','Rio Grande do Sul','Caxias do Sul / Passo Fundo'),
  ('55','Rio Grande do Sul','Santa Maria / Santana do Livramento / Santo Ângelo / Uruguaiana'),
  ('61','Distrito Federal / Goiás','Abrangência em todo o Distrito Federal e alguns municípios da Região Integrada de Desenvolvimento do Distrito Federal e Entorno'),
  ('62','Goiás','Goiânia e Região Metropolitana / Anápolis / Niquelândia / Porangatu'),
  ('63','Tocantins','Abrangência em todo o estado'),
  ('64','Goiás','Caldas Novas / Catalão / Itumbiara / Rio Verde'),
  ('65','Mato Grosso','Cuiabá e Região Metropolitana'),
  ('66','Mato Grosso','Rondonópolis / Sinop'),
  ('67','Mato Grosso do Sul','Abrangência em todo o estado'),
  ('68','Acre','Abrangência em todo o estado'),
  ('69','Rondônia','Abrangência em todo o estado'),
  ('71','Bahia','Salvador e Região Metropolitana'),
  ('73','Bahia','Eunápolis / Ilhéus / Itabuna / Porto Seguro / Teixeira de Freitas'),
  ('74','Bahia','Irecê / Jacobina / Juazeiro / Xique-Xique'),
  ('75','Bahia','Alagoinhas / Feira de Santana / Paulo Afonso / Valença'),
  ('77','Bahia','Barreiras / Bom Jesus da Lapa / Guanambi / Vitória da Conquista'),
  ('79','Sergipe','Abrangência em todo o estado'),
  ('81','Pernambuco','Recife e Região Metropolitana / Caruaru'),
  ('82','Alagoas','Abrangência em todo o estado'),
  ('83','Paraíba','Abrangência em todo o estado'),
  ('84','Rio Grande do Norte','Abrangência em todo o estado'),
  ('85','Ceará','Fortaleza e Região Metropolitana'),
  ('86','Piauí','Teresina e alguns municípios da Região Integrada de Desenvolvimento da Grande Teresina / Parnaíba'),
  ('87','Pernambuco','Garanhuns / Petrolina / Salgueiro / Serra Talhada'),
  ('88','Ceará','Juazeiro do Norte / Sobral'),
  ('89','Piauí','Picos / Floriano'),
  ('91','Pará','Belém e Região Metropolitana'),
  ('92','Amazonas','Manaus e Região Metropolitana / Parintins'),
  ('93','Pará','Santarém / Altamira / Itaituba'),
  ('94','Pará','Marabá'),
  ('95','Roraima','Abrangência em todo o estado'),
  ('96','Amapá','Abrangência em todo o estado'),
  ('97','Amazonas','Abrangência no interior do estado'),
  ('98','Maranhão','São Luís e Região Metropolitana'),
  ('99','Maranhão','Caxias / Codó / Imperatriz')
on conflict (prefix) do update set state = excluded.state, region = excluded.region, updated_at = now();

alter table public.ddd_prefixes enable row level security;
drop policy if exists "ddd prefixes readable" on public.ddd_prefixes;
create policy "ddd prefixes readable" on public.ddd_prefixes for select to authenticated using (true);

-- For the current imported base, every existing lead is considered VMarket.
update public.deals set lead_source = 'vmarket';

create or replace function public.extract_br_ddd(raw_phone text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g');
  if digits = '' then return null; end if;
  if left(digits, 2) = '55' and length(digits) >= 12 then
    digits := substr(digits, 3);
  end if;
  if left(digits, 1) = '0' and length(digits) >= 11 then
    digits := substr(digits, 2);
    if length(digits) >= 12 then
      digits := substr(digits, 3);
    end if;
  end if;
  if length(digits) >= 10 then
    return substr(digits, 1, 2);
  end if;
  return null;
end;
$$;

create or replace function public.jsonb_text(value jsonb)
returns text
language sql
immutable
as $$
  select nullif(trim(coalesce(value #>> '{}', value::text, '')), '')
$$;

create or replace function public.enrich_person_ddd(target_person_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
begin
  with person_ddd_fields as (
    select
      p.id,
      nullif(trim(max(case when lower(cf.name) in ('ddd prefixo','prefixo ddd','prefixo') then public.jsonb_text(cfv.value) end)), '') as pipedrive_prefix,
      nullif(trim(max(case when lower(cf.name) in ('ddd estado','estado ddd') then public.jsonb_text(cfv.value) end)), '') as pipedrive_state,
      nullif(trim(max(case when lower(cf.name) in ('ddd região','região ddd','ddd regiao','regiao ddd') then public.jsonb_text(cfv.value) end)), '') as pipedrive_region
    from public.people p
    left join public.custom_field_values cfv on cfv.entity_id = p.id
    left join public.custom_fields cf on cf.id = cfv.field_id and cf.entity = 'person'
    where target_person_id is null or p.id = target_person_id
    group by p.id
  ), resolved as (
    select
      p.id,
      coalesce(pdf.pipedrive_prefix, public.extract_br_ddd(p.phone)) as prefix,
      pdf.pipedrive_state,
      pdf.pipedrive_region
    from public.people p
    join person_ddd_fields pdf on pdf.id = p.id
  ), final_values as (
    select
      r.id,
      r.prefix,
      coalesce(r.pipedrive_state, d.state) as state,
      coalesce(r.pipedrive_region, d.region) as region
    from resolved r
    left join public.ddd_prefixes d on d.prefix = r.prefix
  ), updated as (
    update public.people p
    set ddd_prefix = f.prefix,
        ddd_state = f.state,
        ddd_region = f.region,
        updated_at = now()
    from final_values f
    where p.id = f.id
      and f.prefix is not null
      and (p.ddd_prefix is distinct from f.prefix or p.ddd_state is distinct from f.state or p.ddd_region is distinct from f.region)
    returning p.id
  )
  select count(*) into changed from updated;
  return changed;
end;
$$;

create or replace function public.trigger_enrich_person_ddd()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enrich_person_ddd(new.id);
  return new;
end;
$$;

drop trigger if exists enrich_person_ddd_after_phone on public.people;
create trigger enrich_person_ddd_after_phone
after insert or update of phone on public.people
for each row execute function public.trigger_enrich_person_ddd();

create or replace function public.next_lead_owner()
returns uuid
language sql
security definer
set search_path = public
as $$
  select cu.auth_user_id
  from public.crm_users cu
  left join public.profiles p on p.id = cu.auth_user_id
  where cu.auth_user_id is not null
    and cu.status = 'active'
    and coalesce(p.role, 'bpo_partner') = 'bpo_partner'
  order by (select count(*) from public.deals d where d.owner_id = cu.auth_user_id), cu.full_name
  limit 1
$$;

create or replace function public.distribute_unassigned_leads()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  assigned uuid;
  changed integer := 0;
  rule_id text := 'lead_distribution_round_robin';
begin
  for rec in select id, title from public.deals where owner_id is null order by created_at, id loop
    assigned := public.next_lead_owner();
    exit when assigned is null;
    update public.deals set owner_id = assigned, updated_at = now() where id = rec.id;
    changed := changed + 1;
    insert into public.automation_rule_executions (rule_id, integration_event_id, status, trigger_system, trigger_type, record_entity, internal_id, started_at, finished_at, changed_fields, filters_evaluated, actions_performed, details)
    values (rule_id, rec.id, 'success', 'CRM BPO', 'manual_run distribute_unassigned_leads', 'deal', rec.id, now(), now(), '["deals.owner_id"]'::jsonb, jsonb_build_array(jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true)), '["assigned lead owner"]'::jsonb, jsonb_build_object('deal_id', rec.id, 'deal_title', rec.title, 'assigned_owner_id', assigned));
  end loop;
  return changed;
end;
$$;

create or replace function public.assign_lead_owner_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned uuid;
  rule_id text := 'lead_distribution_round_robin';
begin
  if new.owner_id is null then
    assigned := public.next_lead_owner();
    if assigned is not null then
      new.owner_id := assigned;
      insert into public.automation_rule_executions (rule_id, integration_event_id, status, trigger_system, trigger_type, record_entity, internal_id, started_at, finished_at, changed_fields, filters_evaluated, actions_performed, details)
      values (rule_id, new.id, 'success', 'CRM BPO', 'deals.insert owner_id null', 'deal', new.id, now(), now(), '["deals.owner_id"]'::jsonb, jsonb_build_array(jsonb_build_object('field','owner_id','expected','is null','actual',null,'result',true)), '["assigned lead owner"]'::jsonb, jsonb_build_object('deal_id', new.id, 'deal_title', new.title, 'assigned_owner_id', assigned));
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assign_lead_owner_before_insert on public.deals;
create trigger assign_lead_owner_before_insert
before insert on public.deals
for each row execute function public.assign_lead_owner_on_insert();

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'lead_distribution_round_robin',
  'CRM BPO: distribuir leads sem proprietário entre parceiros ativos',
  'active',
  'CRM BPO',
  'CRM BPO',
  'Banco de dados CRM',
  'Novo negócio sem owner_id / execução manual de redistribuição',
  'Atribui leads sem proprietário para usuários parceiros ativos, balanceando pela menor quantidade de negócios já atribuídos. Cada atribuição gera execução com o negócio e o proprietário escolhido.',
  '[{"event":"deals.insert","condition":"owner_id is null"},{"event":"manual_run","function":"distribute_unassigned_leads"}]'::jsonb,
  '[{"field":"deals.owner_id","operator":"is null"},{"field":"crm_users.status","operator":"=","value":"active"},{"field":"profiles.role","operator":"=","value":"bpo_partner"}]'::jsonb,
  '[{"action":"set deals.owner_id","strategy":"round-robin by current deal count"},{"action":"insert automation_rule_executions","details":"deal and assigned owner"}]'::jsonb,
  '["deals.owner_id","crm_users.auth_user_id","profiles.role"]'::jsonb,
  '[{"type":"sql_function","name":"public.distribute_unassigned_leads"},{"type":"sql_trigger","name":"assign_lead_owner_before_insert"}]'::jsonb
)
on conflict (id) do update set name = excluded.name, status = excluded.status, source_system = excluded.source_system, target_system = excluded.target_system, trigger_system = excluded.trigger_system, trigger_type = excluded.trigger_type, description = excluded.description, triggers = excluded.triggers, filters = excluded.filters, actions = excluded.actions, fields_involved = excluded.fields_involved, implementation_refs = excluded.implementation_refs, updated_at = now();

insert into public.automation_rules (id, name, status, source_system, target_system, trigger_system, trigger_type, description, triggers, filters, actions, fields_involved, implementation_refs)
values (
  'contact_ddd_enrichment',
  'CRM BPO: enriquecer DDD de contatos por telefone ou campos Pipedrive',
  'active',
  'CRM BPO/Pipedrive',
  'CRM BPO',
  'Banco de dados CRM',
  'Contato criado/telefone alterado/importação Pipedrive com campos DDD',
  'Preenche Prefixo, Estado e Região do grupo DDD do contato. Se campos DDD vierem preenchidos do Pipedrive, eles têm prioridade; caso contrário, o prefixo é extraído do telefone e consultado na base DDD derivada da Wikipédia.',
  '[{"event":"people.insert"},{"event":"people.phone.update"},{"event":"manual_run","function":"enrich_person_ddd"}]'::jsonb,
  '[{"field":"people.phone","operator":"is not empty"}]'::jsonb,
  '[{"action":"derive ddd_prefix"},{"action":"lookup ddd_prefixes"},{"action":"set people.ddd_prefix/state/region"}]'::jsonb,
  '["people.phone","people.ddd_prefix","people.ddd_state","people.ddd_region","custom_field_values"]'::jsonb,
  '[{"type":"source","name":"Wikipédia: Discagem direta a distância","url":"https://pt.wikipedia.org/wiki/Discagem_direta_a_dist%C3%A2ncia"},{"type":"sql_function","name":"public.enrich_person_ddd"},{"type":"sql_trigger","name":"enrich_person_ddd_after_phone"}]'::jsonb
)
on conflict (id) do update set name = excluded.name, status = excluded.status, source_system = excluded.source_system, target_system = excluded.target_system, trigger_system = excluded.trigger_system, trigger_type = excluded.trigger_type, description = excluded.description, triggers = excluded.triggers, filters = excluded.filters, actions = excluded.actions, fields_involved = excluded.fields_involved, implementation_refs = excluded.implementation_refs, updated_at = now();

insert into public.automation_rule_changes (rule_id, change_type, changed_by, summary, after_snapshot)
values
  ('lead_distribution_round_robin', 'created', 'Hermes', 'Registrada automação de distribuição de leads sem proprietário', '{"request":"registrar distribuição de leads e atribuição"}'::jsonb),
  ('contact_ddd_enrichment', 'created', 'Hermes', 'Registrada automação de enriquecimento de DDD de contatos', '{"source":"Wikipedia DDD list"}'::jsonb);
