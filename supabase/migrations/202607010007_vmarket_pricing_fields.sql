alter table public.deals
  add column if not exists vm_loyalty_period text,
  add column if not exists total_value numeric generated always as (coalesce(value, 0) + coalesce(partner_value, 0)) stored;

alter table public.deals
  drop constraint if exists deals_vm_loyalty_period_check;

alter table public.deals
  add constraint deals_vm_loyalty_period_check
  check (vm_loyalty_period is null or vm_loyalty_period in ('mensal', 'semestral'));
