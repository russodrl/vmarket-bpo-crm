-- Deal labels for Kanban/list/detail views.

create table if not exists public.deal_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#3b82f6',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists public.deal_label_assignments (
  deal_id uuid not null references public.deals(id) on delete cascade,
  label_id uuid not null references public.deal_labels(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (deal_id, label_id)
);

drop trigger if exists touch_deal_labels on public.deal_labels;
create trigger touch_deal_labels before update on public.deal_labels for each row execute function public.touch_updated_at();

alter table public.deal_labels enable row level security;
alter table public.deal_label_assignments enable row level security;

drop policy if exists "deal labels read authenticated" on public.deal_labels;
drop policy if exists "deal labels write authenticated" on public.deal_labels;
create policy "deal labels read authenticated" on public.deal_labels for select to authenticated using (true);
create policy "deal labels write authenticated" on public.deal_labels for all to authenticated using (true) with check (true);

drop policy if exists "deal label assignments read visible deals" on public.deal_label_assignments;
drop policy if exists "deal label assignments write visible deals" on public.deal_label_assignments;
create policy "deal label assignments read visible deals" on public.deal_label_assignments for select to authenticated using (
  public.is_admin() or exists (
    select 1 from public.deals d
    where d.id = deal_label_assignments.deal_id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);
create policy "deal label assignments write visible deals" on public.deal_label_assignments for all to authenticated using (
  public.is_admin() or exists (
    select 1 from public.deals d
    where d.id = deal_label_assignments.deal_id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
) with check (
  public.is_admin() or exists (
    select 1 from public.deals d
    where d.id = deal_label_assignments.deal_id
      and (d.owner_id = auth.uid() or d.bpo_id = public.current_bpo_id())
  )
);

insert into public.deal_labels (name, color)
values
  ('PATROCINIO CAYENA', '#f59e0b'),
  ('+ 9 CNPJs', '#dc2626'),
  ('5 A 8 CNPJs', '#fde047'),
  ('2 A 4 CNPJs', '#2563eb'),
  ('CLIENTE DIFÍCIL', '#92400e'),
  ('CLIENTE NORMAL', '#e5e7eb')
on conflict (name) do nothing;
