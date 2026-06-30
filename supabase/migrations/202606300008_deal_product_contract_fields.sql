alter table public.deals
  add column if not exists lead_source text not null default 'parceiro' check (lead_source in ('vmarket', 'parceiro')),
  add column if not exists vm_sale boolean not null default false,
  add column if not exists contract_with text check (contract_with in ('cliente', 'parceiro')),
  add column if not exists vm_product_type text check (vm_product_type in ('restaurante', 'hotel', 'fornecedor')),
  add column if not exists vm_cnpj_count integer,
  add column if not exists vm_plan text,
  add column if not exists vm_value_per_cnpj numeric(14,2),
  add column if not exists contract_legal_name text,
  add column if not exists contract_tax_id text,
  add column if not exists contract_address text,
  add column if not exists contract_representative text,
  add column if not exists contract_email text,
  add column if not exists contract_phone text,
  add column if not exists partner_services jsonb not null default '{}'::jsonb;

update public.deals
set lead_source = case when source = 'Pipedrive API' then 'vmarket' else 'parceiro' end
where lead_source is null or lead_source not in ('vmarket', 'parceiro');

update public.deals
set contract_with = coalesce(contract_with, 'cliente')
where vm_sale = true;

update public.deals
set partner_services = '{}'::jsonb
where partner_services is null;
