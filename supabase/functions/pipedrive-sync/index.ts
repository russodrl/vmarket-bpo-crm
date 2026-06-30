/// <reference lib="deno.ns" />
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type JsonRecord = Record<string, unknown>
type SyncPayload = {
  action?: 'webhook' | 'sync-deal-to-pipedrive' | 'sync-existing-deal-to-pipedrive' | 'sync-existing-deal-stage-to-pipedrive'
  deal_id?: string
}

type CustomFieldRow = {
  id: string
  entity: 'deal' | 'organization' | 'person' | 'activity'
  pipedrive_key?: string | null
  pipedrive_field_type?: string | null
}

type CustomFieldValueRow = {
  field_id: string
  value: unknown
  custom_fields?: CustomFieldRow | null
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const PIPEDRIVE_API_TOKEN = Deno.env.get('PIPEDRIVE_API_TOKEN') || ''
const PIPEDRIVE_BASE_URL = Deno.env.get('PIPEDRIVE_BASE_URL') || 'https://api.pipedrive.com/v1'
const PIPEDRIVE_WEBHOOK_SECRET = Deno.env.get('PIPEDRIVE_WEBHOOK_SECRET') || ''
const ALEKSANDER_PIPEDRIVE_USER_ID = Number(Deno.env.get('ALEKSANDER_PIPEDRIVE_USER_ID') || '28696367')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase service credentials are not configured' }, 500)
    if (!PIPEDRIVE_API_TOKEN) return json({ error: 'PIPEDRIVE_API_TOKEN is not configured' }, 500)

    const payload = await req.json().catch(() => ({})) as SyncPayload & JsonRecord
    const url = new URL(req.url)
    const action = payload.action || url.searchParams.get('action') || 'webhook'

    if (action === 'sync-deal-to-pipedrive') {
      const user = await requireInternalOrUserAuth(req)
      if (!payload.deal_id) return json({ error: 'deal_id is required' }, 400)
      const result = await syncDealToPipedrive(payload.deal_id, user?.id || null)
      return json(result)
    }

    if (action === 'sync-existing-deal-stage-to-pipedrive') {
      const user = await requireInternalOrUserAuth(req)
      if (!payload.deal_id) return json({ error: 'deal_id is required' }, 400)
      const result = await syncExistingDealStageToPipedrive(payload.deal_id, user?.id || null)
      return json(result)
    }

    if (action === 'sync-existing-deal-to-pipedrive') {
      const user = await requireInternalOrUserAuth(req)
      if (!payload.deal_id) return json({ error: 'deal_id is required' }, 400)
      const result = await syncExistingDealToPipedrive(payload.deal_id, user?.id || null)
      return json(result)
    }

    await verifyWebhook(req)
    const result = await handlePipedriveWebhook(payload)
    return json(result)
  } catch (error) {
    const message = errorMessage(error)
    await logEvent({ level: 'error', message: 'Unhandled pipedrive-sync error', details: { message } }).catch(() => null)
    return json({ error: message }, 500)
  }
})

async function requireInternalOrUserAuth(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const internal = Deno.env.get('INTEGRATION_INTERNAL_TOKEN') || ''
  if (internal && auth === `Bearer ${internal}`) return null
  if (!auth.startsWith('Bearer ')) throw new Error('Missing authorization bearer token')
  const token = auth.slice('Bearer '.length)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid Supabase user token')
  return data.user
}

async function verifyWebhook(req: Request) {
  if (!PIPEDRIVE_WEBHOOK_SECRET) return
  const url = new URL(req.url)
  const received = req.headers.get('x-vmarket-webhook-secret') || req.headers.get('x-pipedrive-webhook-secret') || url.searchParams.get('secret') || ''
  if (received !== PIPEDRIVE_WEBHOOK_SECRET) throw new Error('Invalid webhook secret')
}

async function handlePipedriveWebhook(payload: JsonRecord) {
  const integration = await getIntegration()
  const meta = (payload.meta || {}) as JsonRecord
  const eventType = String(payload.event || meta.action || 'pipedrive_webhook')
  const current = (payload.current || payload.data || payload) as JsonRecord
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
  const ownerId = pipedriveUserId(pipedriveDeal.user_id)
  const existing = await findExternalRecordByExternal('deal', dealId)
  if (!existing && ALEKSANDER_PIPEDRIVE_USER_ID && ownerId && ownerId !== ALEKSANDER_PIPEDRIVE_USER_ID) {
    await updateEvent(event.id, { status: 'ignored', error_message: `Owner ${ownerId} is not Aleksander` })
    return { ok: true, ignored: true, reason: 'Owner is not Aleksander', pipedrive_owner_id: ownerId }
  }

  const crmDeal = await upsertCrmDealFromPipedrive(integration.id, pipedriveDeal)
  const notesSynced = await syncPipedriveNotesToHistory(crmDeal.id, dealId).catch(async (error) => {
    await logEvent({ event_id: event.id, level: 'warning', message: 'Pipedrive notes sync skipped', details: { external_id: dealId, error: errorMessage(error) } }).catch(() => null)
    return 0
  })
  const activitiesSynced = await syncPipedriveActivitiesToCrm(integration.id, crmDeal, dealId).catch(async (error) => {
    await logEvent({ event_id: event.id, level: 'warning', message: 'Pipedrive activities sync skipped', details: { external_id: dealId, error: errorMessage(error) } }).catch(() => null)
    return 0
  })
  await updateEvent(event.id, { status: 'success', internal_id: crmDeal.id, processed_at: new Date().toISOString() })
  await logEvent({ event_id: event.id, message: 'Pipedrive deal synced inbound', details: { external_id: dealId, internal_id: crmDeal.id, notes_synced: notesSynced, activities_synced: activitiesSynced } })
  return { ok: true, deal_id: crmDeal.id, pipedrive_deal_id: dealId, notes_synced: notesSynced, activities_synced: activitiesSynced }
}

async function syncDealToPipedrive(dealId: string, userId: string | null) {
  const integration = await getIntegration()
  const { data: deal, error } = await supabase
    .from('deals')
    .select('*, organizations(*), people(*), bpo_partners(*), pipeline_stages(*)')
    .eq('id', dealId)
    .single()
  if (error) throw error
  if (userId && deal.owner_id && deal.owner_id !== userId) throw new Error('User cannot sync a deal owned by another CRM user')
  if (!deal.organization_id || !deal.person_id) throw new Error('Deal must have organization_id and person_id before Pipedrive sync')
  if (!deal.organizations?.name) throw new Error('Deal organization must have a name')
  if (!deal.people?.full_name) throw new Error('Deal person must have a name')

  const orgExternalId = await ensurePipedriveOrganization(integration.id, deal.organization_id, deal.organizations)
  const personExternalId = await ensurePipedrivePerson(integration.id, deal.person_id, deal.people, orgExternalId)
  const external = await findExternalRecord('deal', dealId)
  const customPayload = await buildPipedriveCustomPayload(dealId, 'deal')
  const body: JsonRecord = {
    title: deal.title,
    value: Number(deal.value || 0),
    expected_close_date: deal.expected_close_date || undefined,
    status: mapCrmStatusToPipedrive(deal.status),
    org_id: Number(orgExternalId),
    person_id: Number(personExternalId),
    stage_id: deal.pipeline_stages?.pipedrive_stage_id || undefined,
    user_id: ALEKSANDER_PIPEDRIVE_USER_ID || undefined,
    ...customPayload,
  }

  let response: JsonRecord
  if (external?.external_id) {
    response = await pipedrive(`/deals/${external.external_id}`, { method: 'PUT', body }) as JsonRecord
  } else {
    response = await pipedrive('/deals', { method: 'POST', body }) as JsonRecord
  }
  const pdDeal = (response.data || response) as JsonRecord
  const externalId = String(pdDeal.id || external?.external_id || '')
  if (!externalId) throw new Error('Pipedrive did not return a deal id')

  await upsertExternalRecord(integration.id, 'deal', dealId, externalId, pdDeal)
  await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Integração', title: 'Sincronizado com Pipedrive', description: `Pipedrive deal ID ${externalId}` })
  return { ok: true, deal_id: dealId, pipedrive_deal_id: externalId, pipedrive_person_id: personExternalId, pipedrive_organization_id: orgExternalId }
}

async function syncExistingDealStageToPipedrive(dealId: string, userId: string | null) {
  const { data: deal, error } = await supabase
    .from('deals')
    .select('id, owner_id, stage_id, pipeline_stages(*)')
    .eq('id', dealId)
    .single()
  if (error) throw error
  if (userId && deal.owner_id && deal.owner_id !== userId) throw new Error('User cannot sync a deal owned by another CRM user')
  if (deal.pipeline_stages?.pipeline_name !== 'Pipeline de Vendas') return { ok: true, ignored: true, reason: 'Stage is not in Pipeline de Vendas', deal_id: dealId }
  const external = await findExternalRecord('deal', dealId)
  if (!external?.external_id) return { ok: true, ignored: true, reason: 'Deal has no Pipedrive external record', deal_id: dealId }
  const pipedriveStageId = deal.pipeline_stages?.pipedrive_stage_id
  if (!pipedriveStageId) return { ok: true, ignored: true, reason: 'CRM stage has no Pipedrive stage id', deal_id: dealId }
  const response = await pipedrive(`/deals/${external.external_id}`, { method: 'PUT', body: { stage_id: pipedriveStageId } }) as JsonRecord
  const pdDeal = (response.data || response) as JsonRecord
  await upsertExternalRecord(external.integration_id, 'deal', dealId, String(external.external_id), pdDeal)
  await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Integração', title: 'Etapa enviada ao Pipedrive', description: `Pipeline de Vendas sincronizado com Pipedrive deal ID ${external.external_id}` })
  return { ok: true, deal_id: dealId, pipedrive_deal_id: external.external_id, pipedrive_stage_id: pipedriveStageId }
}

async function syncExistingDealToPipedrive(dealId: string, userId: string | null) {
  const { data: deal, error } = await supabase
    .from('deals')
    .select('id, owner_id, stage_id, pipeline_stages(*)')
    .eq('id', dealId)
    .maybeSingle()
  if (error) throw error
  if (!deal) return { ok: true, ignored: true, reason: 'Deal not found', deal_id: dealId }
  if (userId && deal.owner_id && deal.owner_id !== userId) throw new Error('User cannot sync a deal owned by another CRM user')
  if (deal.pipeline_stages?.pipeline_name !== 'Pipeline de Vendas') return { ok: true, ignored: true, reason: 'Deal is not in Pipeline de Vendas', deal_id: dealId }
  const external = await findExternalRecord('deal', dealId)
  if (!external?.external_id) return { ok: true, ignored: true, reason: 'Deal has no Pipedrive external record', deal_id: dealId }
  return syncDealToPipedrive(dealId, userId)
}

async function ensurePipedriveOrganization(integrationId: string, organizationId: string, organization: JsonRecord) {
  const external = await findExternalRecord('organization', organizationId)
  const name = String(organization.name || '').trim()
  const payload = await buildPipedriveCustomPayload(organizationId, 'organization')
  if (external?.external_id) {
    const updateBody: JsonRecord = { name, ...payload }
    const updated = await pipedrive(`/organizations/${external.external_id}`, { method: 'PUT', body: updateBody }) as JsonRecord
    const pdOrg = (updated.data || updated) as JsonRecord
    await upsertExternalRecord(integrationId, 'organization', organizationId, String(external.external_id), pdOrg)
    return String(external.external_id)
  }
  const found = await findPipedriveOrganizationBySimilarName(name)
  let pdOrg: JsonRecord
  if (found?.id) {
    pdOrg = found
    const updateBody: JsonRecord = { name, ...payload }
    if (Object.keys(updateBody).length) await pipedrive(`/organizations/${found.id}`, { method: 'PUT', body: updateBody })
  } else {
    const created = await pipedrive('/organizations', { method: 'POST', body: { name, ...payload } }) as JsonRecord
    pdOrg = (created.data || created) as JsonRecord
  }
  const externalId = String(pdOrg.id || '')
  if (!externalId) throw new Error('Pipedrive organization id not found')
  await upsertExternalRecord(integrationId, 'organization', organizationId, externalId, pdOrg)
  return externalId
}

async function ensurePipedrivePerson(integrationId: string, personId: string, person: JsonRecord, orgExternalId: string) {
  const external = await findExternalRecord('person', personId)
  const email = stringOrNull(person.email)
  const phone = stringOrNull(person.phone)
  const payload = await buildPipedriveCustomPayload(personId, 'person')
  const body: JsonRecord = {
    name: person.full_name,
    org_id: Number(orgExternalId),
    ...(email ? { email: [{ value: email, primary: true }] } : {}),
    ...(phone ? { phone: [{ value: phone, primary: true }] } : {}),
    ...payload,
  }
  if (external?.external_id) {
    const updated = await pipedrive(`/persons/${external.external_id}`, { method: 'PUT', body }) as JsonRecord
    const pdPerson = (updated.data || updated) as JsonRecord
    await upsertExternalRecord(integrationId, 'person', personId, String(external.external_id), pdPerson)
    return String(external.external_id)
  }
  const found = await findPipedrivePerson(email, phone)
  let pdPerson: JsonRecord
  if (found?.id) {
    const updated = await pipedrive(`/persons/${found.id}`, { method: 'PUT', body }) as JsonRecord
    pdPerson = (updated.data || updated) as JsonRecord
  } else {
    const created = await pipedrive('/persons', { method: 'POST', body }) as JsonRecord
    pdPerson = (created.data || created) as JsonRecord
  }
  const externalId = String(pdPerson.id || found?.id || '')
  if (!externalId) throw new Error('Pipedrive person id not found')
  await upsertExternalRecord(integrationId, 'person', personId, externalId, pdPerson)
  return externalId
}

async function upsertCrmDealFromPipedrive(integrationId: string, pdDeal: JsonRecord) {
  const externalId = String(pdDeal.id)
  const existing = await findExternalRecordByExternal('deal', externalId)
  const pdOrg = await resolvePipedriveOrg(pdDeal.org_id)
  const pdPerson = await resolvePipedrivePerson(pdDeal.person_id)
  const organization = pdOrg ? await upsertCrmOrganizationFromPipedrive(integrationId, pdOrg) : null
  const person = pdPerson ? await upsertCrmPersonFromPipedrive(integrationId, pdPerson, organization?.id || null) : null
  const stageId = await stageIdFromPipedrive(pdDeal.stage_id) || await firstStageId()
  const inheritedOwnerId = stringOrNull((person as JsonRecord | null)?.owner_id) || stringOrNull((organization as JsonRecord | null)?.owner_id)
  const inheritedBpoId = stringOrNull((person as JsonRecord | null)?.bpo_id) || stringOrNull((organization as JsonRecord | null)?.bpo_id)
  const payload: JsonRecord = {
    title: String(pdDeal.title || `Negócio Pipedrive ${externalId}`),
    value: Number(pdDeal.value || 0),
    expected_close_date: stringOrNull(pdDeal.expected_close_date),
    status: mapPipedriveStatusToCrm(stringOrNull(pdDeal.status)),
    source: 'Pipedrive API',
    stage_id: stageId,
    organization_id: organization?.id || null,
    person_id: person?.id || null,
  }
  if (!existing?.internal_id && inheritedOwnerId) payload.owner_id = inheritedOwnerId
  if (!existing?.internal_id && inheritedBpoId) payload.bpo_id = inheritedBpoId

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
  await syncCustomFieldsFromPipedrive(deal.id, 'deal', pdDeal)
  if (organization) await syncCustomFieldsFromPipedrive(organization.id, 'organization', pdOrg || {})
  if (person) await syncCustomFieldsFromPipedrive(person.id, 'person', pdPerson || {})
  await supabase.from('deal_history').insert({ deal_id: deal.id, event_type: 'Integração', title: 'Atualizado pelo Pipedrive', description: `Pipedrive deal ID ${externalId}` })
  return deal
}

async function upsertCrmOrganizationFromPipedrive(integrationId: string, pdOrg: JsonRecord) {
  const externalId = String(pdOrg.id)
  const existing = await findExternalRecordByExternal('organization', externalId)
  const payload = {
    name: String(pdOrg.name || `Organização Pipedrive ${externalId}`),
    segment: stringOrNull(pdOrg.industry) || stringOrNull(pdOrg['c8a0499b420080755cbbaaea3007a467d6f76300']),
    city: stringOrNull(pdOrg.address_locality),
    state: stringOrNull(pdOrg.address_admin_area_level_1),
  }
  let org
  if (existing?.internal_id) {
    const { data, error } = await supabase.from('organizations').update(payload).eq('id', existing.internal_id).select('*').single()
    if (error) throw error
    org = data
  } else {
    const { data, error } = await supabase.from('organizations').insert(payload).select('*').single()
    if (error) throw error
    org = data
  }
  await upsertExternalRecord(integrationId, 'organization', org.id, externalId, pdOrg)
  return org
}

async function upsertCrmPersonFromPipedrive(integrationId: string, pdPerson: JsonRecord, organizationId: string | null) {
  const externalId = String(pdPerson.id)
  const existing = await findExternalRecordByExternal('person', externalId)
  const payload = {
    full_name: String(pdPerson.name || `Pessoa Pipedrive ${externalId}`),
    role_title: stringOrNull(pdPerson['afd574ed8ff95c4ce19a8aba6fb4ce0be977801d']),
    email: firstContactValue(pdPerson.email),
    phone: firstContactValue(pdPerson.phone),
    organization_id: organizationId,
  }
  let person
  if (existing?.internal_id) {
    const { data, error } = await supabase.from('people').update(payload).eq('id', existing.internal_id).select('*').single()
    if (error) throw error
    person = data
  } else {
    const { data, error } = await supabase.from('people').insert(payload).select('*').single()
    if (error) throw error
    person = data
  }
  await upsertExternalRecord(integrationId, 'person', person.id, externalId, pdPerson)
  return person
}

async function syncPipedriveNotesToHistory(dealId: string, pipedriveDealId: string) {
  const response = await pipedrive(`/deals/${pipedriveDealId}/notes`, { query: { limit: '100' } }) as JsonRecord
  const notes = ((response.data || []) as JsonRecord[]).filter(Boolean)
  let synced = 0
  for (const note of notes) {
    const noteId = String(note.id || '')
    if (!noteId) continue
    const marker = `Pipedrive note ID ${noteId}`
    const { data: existing, error: existingError } = await supabase
      .from('deal_history')
      .select('id')
      .eq('deal_id', dealId)
      .eq('event_type', 'Nota Pipedrive')
      .ilike('description', `${marker}%`)
      .maybeSingle()
    if (existingError) throw existingError
    const payload = {
      deal_id: dealId,
      event_type: 'Nota Pipedrive',
      title: nestedString(note.user, 'name') || stringOrNull(note.user_name) || 'Nota do Pipedrive',
      description: `${marker}\n\n${stripHtml(String(note.content || ''))}`.trim(),
      created_at: stringOrNull(note.add_time) || new Date().toISOString(),
    }
    if (existing?.id) {
      const { error } = await supabase.from('deal_history').update(payload).eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('deal_history').insert(payload)
      if (error) throw error
    }
    synced += 1
  }
  return synced
}

async function syncPipedriveActivitiesToCrm(integrationId: string, deal: JsonRecord, pipedriveDealId: string) {
  const response = await pipedrive(`/deals/${pipedriveDealId}/activities`, { query: { limit: '100' } }) as JsonRecord
  const activities = ((response.data || []) as JsonRecord[]).filter(Boolean)
  let synced = 0
  for (const activity of activities) {
    const externalId = String(activity.id || '')
    if (!externalId) continue
    const existing = await findExternalRecordByExternal('activity', externalId)
    const dueAt = activity.due_date ? `${activity.due_date}T${String(activity.due_time || '09:00').slice(0, 5)}:00` : null
    const payload = {
      title: String(activity.subject || activity.type || `Atividade Pipedrive ${externalId}`),
      activity_type: String(activity.type || 'task'),
      due_at: dueAt,
      status: activity.done ? 'done' : 'open',
      note: stripHtml(String(activity.note || activity.public_description || '')) || null,
      deal_id: String(deal.id),
      organization_id: stringOrNull(deal.organization_id),
      person_id: stringOrNull(deal.person_id),
      owner_id: stringOrNull(deal.owner_id),
      bpo_id: stringOrNull(deal.bpo_id),
    }
    let internalId = existing?.internal_id
    if (internalId) {
      const { data, error } = await supabase.from('activities').update(payload).eq('id', internalId).select('id').single()
      if (error) throw error
      internalId = data.id
    } else {
      const { data, error } = await supabase.from('activities').insert(payload).select('id').single()
      if (error) throw error
      internalId = data.id
    }
    await upsertExternalRecord(integrationId, 'activity', String(internalId), externalId, activity)
    synced += 1
  }
  return synced
}

async function syncCustomFieldsFromPipedrive(entityId: string, entity: string, payload: JsonRecord) {
  const { data: fields, error } = await supabase.from('custom_fields').select('id, entity, pipedrive_key, pipedrive_field_type').eq('entity', entity).not('pipedrive_key', 'is', null)
  if (error) throw error
  const rows = ((fields || []) as CustomFieldRow[])
    .filter((field) => field.pipedrive_key && field.pipedrive_key in payload && payload[field.pipedrive_key as string] !== null && payload[field.pipedrive_key as string] !== undefined)
    .map((field) => ({ field_id: field.id, entity_id: entityId, value: payload[field.pipedrive_key as string] }))
  if (!rows.length) return
  const { error: upsertError } = await supabase.from('custom_field_values').upsert(rows, { onConflict: 'field_id,entity_id' })
  if (upsertError) throw upsertError
}

async function buildPipedriveCustomPayload(entityId: string, entity: string) {
  const { data: values, error: valuesError } = await supabase
    .from('custom_field_values')
    .select('field_id, value, custom_fields!inner(id, entity, pipedrive_key, pipedrive_field_type)')
    .eq('entity_id', entityId)
    .eq('custom_fields.entity', entity)
    .not('custom_fields.pipedrive_key', 'is', null)
  if (valuesError) throw valuesError
  const payload: JsonRecord = {}
  for (const row of ((values || []) as CustomFieldValueRow[])) {
    const field = row.custom_fields
    if (!field?.pipedrive_key) continue
    if (!isWritablePipedriveField(field.pipedrive_key, field.pipedrive_field_type)) continue
    if (row.value === null || row.value === undefined || row.value === '') continue
    payload[field.pipedrive_key] = row.value
  }
  return payload
}

async function findPipedrivePerson(email: string | null, phone: string | null) {
  const emailMatch = email ? await searchPipedrive('/persons/search', email, 'email', true) : null
  if (emailMatch) return emailMatch
  const phoneMatch = phone ? await searchPipedrive('/persons/search', phone, 'phone', true) : null
  if (phoneMatch) return phoneMatch
  return null
}

async function findPipedriveOrganizationBySimilarName(name: string) {
  if (!name) return null
  const result = await searchPipedrive('/organizations/search', name, 'name', false)
  if (!result) return null
  const resultName = String(result.name || '')
  if (similarName(name, resultName) >= 0.72) return result
  return null
}

async function searchPipedrive(path: string, term: string, fields: string, exact: boolean) {
  const response = await pipedrive(path, { query: { term, fields, exact_match: String(exact), limit: '10' } }) as JsonRecord
  const items = ((response.data as JsonRecord)?.items || []) as Array<{ item?: JsonRecord }>
  return items[0]?.item || null
}

async function resolvePipedriveOrg(value: unknown) {
  const id = typeof value === 'object' && value ? (value as JsonRecord).value || (value as JsonRecord).id : value
  if (!id) return null
  const response = await pipedrive(`/organizations/${id}`) as JsonRecord
  return (response.data || response) as JsonRecord
}

async function resolvePipedrivePerson(value: unknown) {
  const id = typeof value === 'object' && value ? (value as JsonRecord).value || (value as JsonRecord).id : value
  if (!id) return null
  const response = await pipedrive(`/persons/${id}`) as JsonRecord
  return (response.data || response) as JsonRecord
}

async function fetchPipedriveDeal(id: string) {
  const response = await pipedrive(`/deals/${id}`) as JsonRecord
  return (response.data || response) as JsonRecord
}

async function pipedrive(path: string, opts: { method?: string; body?: JsonRecord; query?: Record<string, string> } = {}) {
  const url = new URL(`${PIPEDRIVE_BASE_URL}${path}`)
  url.searchParams.set('api_token', PIPEDRIVE_API_TOKEN)
  for (const [key, value] of Object.entries(opts.query || {})) url.searchParams.set(key, value)
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

async function stageIdFromPipedrive(stageId: unknown) {
  const id = Number(typeof stageId === 'object' && stageId ? (stageId as JsonRecord).id || (stageId as JsonRecord).value : stageId)
  if (!id) return null
  const { data, error } = await supabase.from('pipeline_stages').select('id').eq('pipedrive_stage_id', id).maybeSingle()
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

async function createEvent(payload: JsonRecord) {
  const { data, error } = await supabase.from('integration_events').insert(payload).select('*').single()
  if (error) throw error
  return data
}

async function updateEvent(id: string, patch: JsonRecord) {
  const { error } = await supabase.from('integration_events').update(patch).eq('id', id)
  if (error) throw error
}

async function logEvent(payload: { event_id?: string; level?: string; message: string; details?: JsonRecord }) {
  const { error } = await supabase.from('integration_logs').insert({ level: payload.level || 'info', message: payload.message, details: payload.details || {}, event_id: payload.event_id })
  if (error) throw error
}

function stringOrNull(value: unknown) {
  return value === null || value === undefined || value === '' ? null : String(value)
}

function nestedString(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return null
  return stringOrNull((value as JsonRecord)[key])
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

function pipedriveUserId(value: unknown) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Number(value)
  if (typeof value === 'object' && value) return Number((value as JsonRecord).id || (value as JsonRecord).value)
  return 0
}

function firstContactValue(value: unknown) {
  if (Array.isArray(value)) {
    const primary = value.find((item) => item && typeof item === 'object' && (item as JsonRecord).primary)
    const row = primary || value[0]
    return row && typeof row === 'object' ? stringOrNull((row as JsonRecord).value) : stringOrNull(row)
  }
  return stringOrNull(value)
}

function normalizeName(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

function similarName(a: string, b: string) {
  const left = normalizeName(a)
  const right = normalizeName(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.9
  const aw = new Set(left.split(' ').filter(Boolean))
  const bw = new Set(right.split(' ').filter(Boolean))
  const intersection = [...aw].filter((word) => bw.has(word)).length
  const union = new Set([...aw, ...bw]).size
  return union ? intersection / union : 0
}

function isWritablePipedriveField(key: string, fieldType?: string | null) {
  const blocked = new Set([
    'id', 'creator_user_id', 'add_time', 'update_time', 'stage_change_time', 'next_activity_date', 'last_activity_date', 'won_time', 'lost_time', 'close_time',
    'activities_count', 'done_activities_count', 'undone_activities_count', 'email_messages_count', 'product_quantity', 'product_amount', 'product_name',
    'origin', 'origin_id', 'channel', 'channel_id', 'archive_time', 'is_archived', 'people_count', 'open_deals_count', 'won_deals_count', 'lost_deals_count', 'closed_deals_count',
    'picture_id', 'first_name', 'last_name', 'address_lat', 'address_long', 'address_subpremise', 'address_street_number', 'address_route', 'address_sublocality',
    'address_locality', 'address_admin_area_level_1', 'address_admin_area_level_2', 'address_country', 'address_postal_code', 'address_formatted_address',
  ])
  if (blocked.has(key)) return false
  if (fieldType === 'picture') return false
  return true
}
