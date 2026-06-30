alter table public.activities
  add column if not exists completed_at timestamptz;

update public.activities
set completed_at = coalesce(completed_at, updated_at, now())
where status = 'done'
  and completed_at is null;
