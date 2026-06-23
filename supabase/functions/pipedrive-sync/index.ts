/// <reference lib="deno.ns" />
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type PipedriveDeal = Record<string, unknown>
type ExternalFieldMapping = Record<string, unknown> & {
  custom_field_id?: string
  provider_field_key: string
  direction: string
  integration_id?: string
}
type CustomFieldValueRow = Record<string, unknown> & {
  field_id: string
  value: unknown
}

type SyncPayload = {
  action?: 'webhook' | 'sync-deal-to-pipedrive'
  deal_id?: string
  provider?: 'pipedrive'
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const PIPEDRIVE_API_TOKEN = Deno.env.get('PIPEDRIVE_API_TOKEN') || ''
const PIPEDRIVE_BASE_URL = Deno.env.get('PIPEDRIVE_BASE_URL') || 'https://api.pipedrive.com/v1'
const PIPEDRIVE_WEBHOOK_SECRET = Deno.env.get('PIPEDRIVE_WEBHOOK_SECRET') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase service credentials are not configured' }, 500)
    if (!PIPEDRIVE_API_TOKEN) return json({ error: 'PIPEDRIVE_API_TOKEN is not configured' }, 500)

    const payload = await req.json().catch(() => ({})) as SyncPayload & Record<string, unknown>
    const url = new URL(req.url)
    const action = payload.action || url.searchParams.get('action') || 'webhook'

    if (action === 'sync-deal-to-pipedrive') {
      await requireInternalAuth(req)
      if (!payload.deal_id) return json({ error: 'deal_id is required' }, 400)
      const result = await syncDealToPipedrive(payload.deal_id)
      return json(result)
    }

    await verifyWebhook(req)
    const result = await handlePipedriveWebhook(payload)
    return json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logEvent({ level: 'error', message: 'Unhandled pipedrive-sync error', details: { message } }).catch(() => null)
    return json({ error: message }, 500)
  }
})

async function requireInternalAuth(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const expected = Deno.env.get('INTEGRATION_INTERNAL_TOKEN') || ''
  if (expected && auth !== `Bearer ${expected}`) throw new Error('Invalid internal integration token')
}

async function verifyWebhook(req: Request) {
  if (!PIPEDRIVE_WEBHOOK_SECRET) return
  const received = req.headers.get('x-vmarket-webhook-secret') || req.headers.get('x-pipedrive-webhook-secret') || ''
  if (received !== PIPEDRIVE_WEBHOOK_SECRET) throw new Error('Invalid webhook secret')
}

async function handlePipedriveWebhook(payload: Record<string, unknown>) {
  const integration = await getIntegration()
  const meta = (payload.meta || {}) as Record<string, unknown>
  const eventType = String(payload.event || meta['action'] || 'pipedrive_webhook')
  const current = (payload.current || payload.data || payload) as Record<string, unknown>
  const dealId = String(current.id || payload.id || '')

  const event = await createEvent({
    integration_id: integration.id,
    event_type: eventType,
    entity: 'deal',
    external_id: dealId || null,
    direction: 'inbound',
    status: 'processing',
    payload,
  })

  if (!dealId) {
    await updateEvent(event.id, { status: 'ignored', error_message: 'No Pipedrive deal id in webhook payload' })
    return { ok: true, ignored: true, reason: 'No deal id' }
  }

  const pipedriveDeal = await fetchPipedriveDeal(dealId)
  const crmDeal = await upsertCrmDealFromPipedrive(integration.id, pipedriveDeal)
  await updateEvent(event.id, { status: 'success', internal_id: crmDeal.id, processed_at: new Date().toISOString() })
  await logEvent({ event_id: event.id, message: 'Pipedrive deal synced inbound', details: { external_id: dealId, internal_id: crmDeal.id } })
  return { ok: true, deal_id: crmDeal.id, pipedrive_deal_id: dealId }
}

async function syncDealToPipedrive(dealId: string) {
  const integration = await getIntegration()
  const { data: deal, error } = await supabase
    .from('deals')
    .select('*, organizations(*), people(*), bpo_partners(*), pipeline_stages(*)')
    .eq('id', dealId)
    .single()
  if (error) throw error

  const external = await findExternalRecord('deal', dealId)
  const customPayload = await buildPipedriveCustomPayload(dealId, integration.id)
  const body: Record<string, unknown> = {
    title: deal.title,
    value: Number(deal.value || 0),
    expected_close_date: deal.expected_close_date,
    status: mapCrmStatusToPipedrive(deal.status),
    ...customPayload,
  }

  let response: PipedriveDeal
  if (external?.external_id) {
    response = await pipedrive(`/deals/${external.external_id}`, { method: 'PUT', body }) as PipedriveDeal
  } else {
    response = await pipedrive('/deals', { method: 'POST', body }) as PipedriveDeal
  }
  const pdDeal = (response.data || response) as PipedriveDeal
  const externalId = String(pdDeal.id || external?.external_id || '')
  if (!externalId) throw new Error('Pipedrive did not return a deal id')

  await upsertExternalRecord(integration.id, 'deal', dealId, externalId, pdDeal)
  await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Integração', title: 'Sincronizado com Pipedrive', description: `Pipedrive deal ID ${externalId}` })
  return { ok: true, deal_id: dealId, pipedrive_deal_id: externalId }
}

async function upsertCrmDealFromPipedrive(integrationId: string, pdDeal: PipedriveDeal) {
  const externalId = String(pdDeal.id)
  const title = String(pdDeal.title || `Negócio Pipedrive ${externalId}`)
  const value = Number(pdDeal.value || 0)
  const expectedClose = stringOrNull(pdDeal.expected_close_date)
  const status = mapPipedriveStatusToCrm(stringOrNull(pdDeal.status))

  const existing = await findExternalRecordByExternal('deal', externalId)
  const stageId = await firstStageId()

  const payload = {
    title,
    value,
    expected_close_date: expectedClose,
    status,
    source: 'Pipedrive API',
    stage_id: stageId,
  }

  let deal
  if (existing?.internal_id) {
    const { data, error } = await supabase.from('deals').update(payload).eq('id', existing.internal_id).select('*').single()
    if (error) throw error
    deal = data
  } else {
    const { data, error } = await supabase.from('deals').insert(payload).select('*').single()
    if (error) throw error
    deal = data
  }

  await upsertExternalRecord(integrationId, 'deal', deal.id, externalId, pdDeal)
  await syncMappedCustomFields(integrationId, deal.id, pdDeal)
  await supabase.from('deal_history').insert({ deal_id: deal.id, event_type: 'Integração', title: 'Atualizado pelo Pipedrive', description: `Pipedrive deal ID ${externalId}` })
  return deal
}

async function syncMappedCustomFields(integrationId: string, dealId: string, pdDeal: PipedriveDeal) {
  const { data: mappings, error } = await supabase
    .from('external_field_mappings')
    .select('*, custom_fields(*)')
    .eq('integration_id', integrationId)
    .eq('entity', 'deal')
    .in('direction', ['inbound', 'bidirectional'])
    .not('custom_field_id', 'is', null)
  if (error) throw error

  const rows = ((mappings || []) as ExternalFieldMapping[])
    .filter((mapping: ExternalFieldMapping) => mapping.provider_field_key in pdDeal)
    .map((mapping: ExternalFieldMapping) => ({
      field_id: mapping.custom_field_id,
      entity_id: dealId,
      value: pdDeal[mapping.provider_field_key],
    }))
  if (!rows.length) return
  const { error: upsertError } = await supabase.from('custom_field_values').upsert(rows, { onConflict: 'field_id,entity_id' })
  if (upsertError) throw upsertError
}

async function buildPipedriveCustomPayload(dealId: string, integrationId: string) {
  const { data: values, error: valuesError } = await supabase.from('custom_field_values').select('*').eq('entity_id', dealId)
  if (valuesError) throw valuesError
  const valueRows = (values || []) as CustomFieldValueRow[]
  const fieldIds = valueRows.map((row: CustomFieldValueRow) => row.field_id)
  if (!fieldIds.length) return {}
  const { data: mappings, error: mappingError } = await supabase
    .from('external_field_mappings')
    .select('*')
    .eq('integration_id', integrationId)
    .in('custom_field_id', fieldIds)
    .in('direction', ['outbound', 'bidirectional'])
  if (mappingError) throw mappingError
  const payload: Record<string, unknown> = {}
  for (const mapping of ((mappings || []) as ExternalFieldMapping[])) {
    const value = valueRows.find((row: CustomFieldValueRow) => row.field_id === mapping.custom_field_id)
    if (value) payload[mapping.provider_field_key] = value.value
  }
  return payload
}

async function fetchPipedriveDeal(id: string) {
  const response = await pipedrive(`/deals/${id}`) as PipedriveDeal
  return (response.data || response) as PipedriveDeal
}

async function pipedrive(path: string, opts: { method?: string; body?: Record<string, unknown> } = {}) {
  const url = new URL(`${PIPEDRIVE_BASE_URL}${path}`)
  url.searchParams.set('api_token', PIPEDRIVE_API_TOKEN)
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Pipedrive API ${res.status}: ${JSON.stringify(body)}`)
  return body
}

async function getIntegration() {
  const { data, error } = await supabase.from('external_integrations').select('*').eq('provider', 'pipedrive').eq('name', 'Pipedrive principal').single()
  if (error) throw error
  return data
}

async function firstStageId() {
  const { data, error } = await supabase.from('pipeline_stages').select('id').order('sort_order').limit(1).maybeSingle()
  if (error) throw error
  return data?.id || null
}

async function findExternalRecord(entity: string, internalId: string) {
  const { data, error } = await supabase.from('external_records').select('*').eq('provider', 'pipedrive').eq('entity', entity).eq('internal_id', internalId).maybeSingle()
  if (error) throw error
  return data
}

async function findExternalRecordByExternal(entity: string, externalId: string) {
  const { data, error } = await supabase.from('external_records').select('*').eq('provider', 'pipedrive').eq('entity', entity).eq('external_id', externalId).maybeSingle()
  if (error) throw error
  return data
}

async function upsertExternalRecord(integrationId: string, entity: string, internalId: string, externalId: string, payload: unknown) {
  const { error } = await supabase.from('external_records').upsert({
    integration_id: integrationId,
    provider: 'pipedrive',
    entity,
    internal_id: internalId,
    external_id: externalId,
    external_key: externalId,
    last_payload: payload,
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'provider,entity,external_id' })
  if (error) throw error
}

async function createEvent(payload: Record<string, unknown>) {
  const { data, error } = await supabase.from('integration_events').insert(payload).select('*').single()
  if (error) throw error
  return data
}

async function updateEvent(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('integration_events').update(patch).eq('id', id)
  if (error) throw error
}

async function logEvent(payload: { event_id?: string; level?: string; message: string; details?: Record<string, unknown> }) {
  const { error } = await supabase.from('integration_logs').insert({ level: payload.level || 'info', message: payload.message, details: payload.details || {}, event_id: payload.event_id })
  if (error) throw error
}

function stringOrNull(value: unknown) {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function mapPipedriveStatusToCrm(status: string | null) {
  if (status === 'won') return 'ganho'
  if (status === 'lost') return 'perdido'
  return 'morno'
}

function mapCrmStatusToPipedrive(status: string | null) {
  if (status === 'ganho') return 'won'
  if (status === 'perdido') return 'lost'
  return 'open'
}
