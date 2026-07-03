alter table public.activities
  add column if not exists meeting_link text;

comment on column public.activities.meeting_link is 'Google Meet or meeting URL synchronized from Pipedrive activities.';
