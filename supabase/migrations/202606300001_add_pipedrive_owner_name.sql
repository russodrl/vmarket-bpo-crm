-- Add a visible Pipedrive owner label to CRM deals without removing legacy plan data.
-- The former "Plano recomendado" field is hidden from the UI but kept in the database for compatibility.

alter table public.deals
  add column if not exists pipedrive_owner_name text;

update public.deals d
set pipedrive_owner_name = nullif(er.last_payload->'user_id'->>'name', '')
from public.external_records er
where er.provider = 'pipedrive'
  and er.entity = 'deal'
  and er.internal_id = d.id
  and d.pipedrive_owner_name is null
  and jsonb_typeof(er.last_payload->'user_id') = 'object'
  and nullif(er.last_payload->'user_id'->>'name', '') is not null;
