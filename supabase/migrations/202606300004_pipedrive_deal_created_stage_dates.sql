alter table public.deals
  add column if not exists pipedrive_deal_created_at timestamptz,
  add column if not exists pipedrive_stage_entered_at timestamptz;

update public.deals d
set
  pipedrive_deal_created_at = coalesce(
    d.pipedrive_deal_created_at,
    nullif(er.last_payload->>'add_time', '')::timestamptz,
    nullif(er.last_payload->>'create_time', '')::timestamptz
  ),
  pipedrive_stage_entered_at = coalesce(
    d.pipedrive_stage_entered_at,
    nullif(er.last_payload->>'stage_change_time', '')::timestamptz,
    nullif(er.last_payload->>'update_time', '')::timestamptz,
    nullif(er.last_payload->>'add_time', '')::timestamptz
  )
from public.external_records er
where er.provider = 'pipedrive'
  and er.entity = 'deal'
  and er.internal_id = d.id;
