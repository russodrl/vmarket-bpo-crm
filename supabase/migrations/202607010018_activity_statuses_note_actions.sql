alter type public.activity_status add value if not exists 'rescheduled';
alter type public.activity_status add value if not exists 'no_show';

alter table public.deal_history
  add column if not exists is_pinned boolean not null default false;

create index if not exists deal_history_deal_pinned_created_idx
  on public.deal_history (deal_id, is_pinned desc, created_at desc);

drop policy if exists "history update scoped" on public.deal_history;
create policy "history update scoped" on public.deal_history for update to authenticated using (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
) with check (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
);

drop policy if exists "history delete scoped" on public.deal_history;
create policy "history delete scoped" on public.deal_history for delete to authenticated using (
  public.is_admin() or exists (select 1 from public.deals d where d.id = deal_id and d.owner_id = auth.uid())
);
