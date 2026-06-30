-- Simplify CRM deal statuses for the UI and store mandatory lost reason.

do $$
begin
  if exists (select 1 from pg_type where typname = 'deal_status_old') then
    drop type public.deal_status_old;
  end if;

  if exists (select 1 from pg_type where typname = 'deal_status') then
    alter type public.deal_status rename to deal_status_old;
  end if;

  create type public.deal_status as enum ('aberto', 'ganho', 'perdido');
end $$;

alter table public.deals
  alter column status drop default;

alter table public.deals
  alter column status type public.deal_status using (
    case
      when status::text = 'ganho' then 'ganho'
      when status::text = 'perdido' then 'perdido'
      else 'aberto'
    end
  )::public.deal_status;

alter table public.deals
  add column if not exists lost_reason text,
  alter column status set default 'aberto'::public.deal_status;

drop type if exists public.deal_status_old;

create or replace function public.validate_deal_lost_reason()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'perdido'::public.deal_status and nullif(trim(coalesce(new.lost_reason, '')), '') is null then
    raise exception 'Motivo da perda obrigatório para negócios perdidos';
  end if;
  if new.status is distinct from 'perdido'::public.deal_status then
    new.lost_reason = null;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_deal_lost_reason on public.deals;
create trigger validate_deal_lost_reason
before insert or update of status, lost_reason on public.deals
for each row execute function public.validate_deal_lost_reason();
