// Secure admin endpoint for CRM user management.
// Actions:
// - list
// - create-crm-user { full_name, email, company_name }
// - send-access-email { crm_user_id }
// - set-initial-password { crm_user_id, password }
// - cleanup-data { target, confirm }
// - delete-one { target, id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://russodrl.github.io/vmarket-bpo-crm/'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanEmail(email: unknown) {
  return String(email || '').trim().toLowerCase()
}

const permissionOptions = ['Admin', 'BPO', 'Gestor', 'Vendas', 'Teste'] as const
function cleanPermission(value: unknown) {
  const permission = String(value || 'BPO').trim()
  return permissionOptions.includes(permission as typeof permissionOptions[number]) ? permission : 'BPO'
}
function profileRoleForPermission(permission: string) {
  return permission === 'Admin' ? 'admin_vmarket' : 'bpo_partner'
}

function cleanText(value: unknown) {
  const text = String(value || '').trim()
  return text || null
}

function cleanStringArray(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)
  return []
}

function cleanNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(String(value).replace(',', '.'))
  return Number.isFinite(number) ? number : null
}

function cleanBool(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['sim', 'true', '1', 'yes'].includes(text)) return true
  if (['não', 'nao', 'false', '0', 'no'].includes(text)) return false
  return null
}

function cleanAdditionalContacts(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((contact) => {
      const item = contact as Record<string, unknown>
      return {
        name: cleanText(item.name),
        role: cleanText(item.role),
        whatsapp: cleanText(item.whatsapp),
      }
    })
    .filter((contact) => contact.name || contact.role || contact.whatsapp)
}

function crmUserDetailsPayload(body: Record<string, unknown>) {
  return {
    legal_company_name: cleanText(body.legal_company_name),
    cnpj: cleanText(body.cnpj),
    headquarters_address: cleanText(body.headquarters_address),
    state_registration: cleanText(body.state_registration),
    legal_representative_name: cleanText(body.legal_representative_name),
    nationality: cleanText(body.nationality),
    marital_status: cleanText(body.marital_status),
    profession: cleanText(body.profession),
    rg_issuer: cleanText(body.rg_issuer),
    cpf: cleanText(body.cpf),
    company_role: cleanText(body.company_role),
    primary_email: body.primary_email ? cleanEmail(body.primary_email) : null,
    crm_phone: cleanText(body.crm_phone),
    additional_contacts: cleanAdditionalContacts(body.additional_contacts),
    issues_service_invoice: cleanBool(body.issues_service_invoice),
    bank_name: cleanText(body.bank_name),
    bank_agency: cleanText(body.bank_agency),
    bank_account: cleanText(body.bank_account),
    pix_key: cleanText(body.pix_key),
    service_regions: cleanText(body.service_regions),
    operation_types: cleanStringArray(body.operation_types),
    monthly_new_clients_capacity: cleanNumber(body.monthly_new_clients_capacity),
    food_service_experience: cleanText(body.food_service_experience),
    current_clients_count: cleanNumber(body.current_clients_count),
    current_purchasing_clients_count: cleanNumber(body.current_purchasing_clients_count),
    purchasing_ticket_avg: cleanNumber(body.purchasing_ticket_avg),
    offered_services: cleanStringArray(body.offered_services),
    data_authorization: cleanText(body.data_authorization),
    tally_form_id: cleanText(body.tally_form_id),
    tally_submission_id: cleanText(body.tally_submission_id),
    tally_submitted_at: cleanText(body.tally_submitted_at),
    tally_synced_at: cleanText(body.tally_synced_at),
  }
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) throw new Error('missing_authorization')
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || !userData.user) throw new Error('invalid_authorization')
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileError) throw profileError
  if (profile?.role !== 'admin_vmarket') throw new Error('admin_required')
  return userData.user
}

async function listUsers() {
  const { data, error } = await admin
    .from('crm_users')
    .select('*, crm_companies(*)')
    .order('full_name')
  if (error) throw error
  return { users: data || [] }
}

async function findExistingAuthUser(email: string) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const found = data.users.find((user: { email?: string }) => user.email?.toLowerCase() === email.toLowerCase())
    if (found) return found
    if (data.users.length < 100) return null
  }
  return null
}

async function upsertCrmUser(body: Record<string, unknown>) {
  const fullName = String(body.full_name || '').trim()
  const email = cleanEmail(body.email)
  const companyName = String(body.company_name || '').trim()
  const permission = cleanPermission(body.permission)
  if (!fullName || !email || !companyName) throw new Error('full_name_email_company_required')

  const { data: company, error: companyError } = await admin
    .from('crm_companies')
    .upsert({ name: companyName }, { onConflict: 'name' })
    .select('*')
    .single()
  if (companyError) throw companyError

  const existingAuthUser = await findExistingAuthUser(email)
  const { data: crmUser, error: userError } = await admin
    .from('crm_users')
    .upsert({
      full_name: fullName,
      email,
      company_id: company.id,
      auth_user_id: existingAuthUser?.id || null,
      status: existingAuthUser ? 'active' : 'pending',
      permission,
      ...crmUserDetailsPayload(body),
    }, { onConflict: 'email' })
    .select('*, crm_companies(*)')
    .single()
  if (userError) throw userError

  if (existingAuthUser) {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: existingAuthUser.id,
        full_name: fullName,
        role: profileRoleForPermission(permission),
        crm_user_id: crmUser.id,
        crm_company_id: company.id,
      }, { onConflict: 'id' })
    if (profileError) throw profileError
    await admin.auth.admin.updateUserById(existingAuthUser.id, {
      user_metadata: { full_name: fullName, company_name: companyName, crm_user_id: crmUser.id },
    })
  }

  return { user: crmUser }
}

async function updateCrmUserDetails(body: Record<string, unknown>) {
  const crmUserId = String(body.crm_user_id || '')
  if (!crmUserId) throw new Error('crm_user_id_required')

  const { data: currentUser, error: currentError } = await admin
    .from('crm_users')
    .select('*, crm_companies(*)')
    .eq('id', crmUserId)
    .maybeSingle()
  if (currentError) throw currentError
  if (!currentUser) throw new Error('crm_user_not_found')

  let companyId = currentUser.company_id as string | null
  const companyName = cleanText(body.company_name)
  if (companyName) {
    const { data: company, error: companyError } = await admin
      .from('crm_companies')
      .upsert({ name: companyName }, { onConflict: 'name' })
      .select('*')
      .single()
    if (companyError) throw companyError
    companyId = company.id
  }

  const detailPayload = crmUserDetailsPayload(body)
  const detailKeys = Object.keys(detailPayload)
  const payload: Record<string, unknown> = {}
  detailKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = detailPayload[key as keyof typeof detailPayload]
  })
  if (body.full_name !== undefined) payload.full_name = cleanText(body.full_name)
  if (body.email !== undefined) payload.email = cleanEmail(body.email)
  if (body.permission !== undefined) payload.permission = cleanPermission(body.permission)
  if (body.status !== undefined) {
    const status = String(body.status || '').trim()
    if (!['pending', 'invited', 'active', 'disabled', 'deleted'].includes(status)) throw new Error('invalid_status')
    payload.status = status
  }
  if (companyId) payload.company_id = companyId

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key]
  })

  const { data: crmUser, error } = await admin
    .from('crm_users')
    .update(payload)
    .eq('id', crmUserId)
    .select('*, crm_companies(*)')
    .maybeSingle()
  if (error) throw error
  if (!crmUser) throw new Error('crm_user_not_found')

  if (crmUser.auth_user_id) {
    const metadata = { full_name: crmUser.full_name, company_name: crmUser.crm_companies?.name || '', crm_user_id: crmUser.id }
    const updateAuthPayload: Record<string, unknown> = { user_metadata: metadata }
    if (body.email !== undefined) updateAuthPayload.email = cleanEmail(body.email)
    const { error: authError } = await admin.auth.admin.updateUserById(crmUser.auth_user_id, updateAuthPayload)
    if (authError) throw authError
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: crmUser.auth_user_id,
        full_name: crmUser.full_name,
        role: profileRoleForPermission(crmUser.permission),
        crm_user_id: crmUser.id,
        crm_company_id: crmUser.company_id,
      }, { onConflict: 'id' })
    if (profileError) throw profileError
  }

  return { user: crmUser }
}

async function sendAccessEmail(body: Record<string, unknown>) {
  const crmUserId = String(body.crm_user_id || '')
  if (!crmUserId) throw new Error('crm_user_id_required')

  const { data: crmUser, error: crmError } = await admin
    .from('crm_users')
    .select('*, crm_companies(*)')
    .eq('id', crmUserId)
    .maybeSingle()
  if (crmError) throw crmError
  if (!crmUser) throw new Error('crm_user_not_found')

  const email = cleanEmail(crmUser.email)
  const companyName = crmUser.crm_companies?.name || ''
  const metadata = { full_name: crmUser.full_name, company_name: companyName, crm_user_id: crmUser.id }
  const redirectTo = APP_BASE_URL

  let authUserId = crmUser.auth_user_id as string | null
  let mode = 'reset'
  if (!authUserId) {
    const existingAuthUser = await findExistingAuthUser(email)
    authUserId = existingAuthUser?.id || null
  }

  if (!authUserId) {
    mode = 'invite'
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: metadata,
      redirectTo,
    })
    if (error) throw error
    authUserId = data.user?.id || null
  } else {
    const { error: updateError } = await admin.auth.admin.updateUserById(authUserId, {
      user_metadata: metadata,
      email_confirm: true,
    })
    if (updateError) throw updateError
    const { error: resetError } = await admin.auth.resetPasswordForEmail(email, { redirectTo })
    if (resetError) throw resetError
  }

  const { error: updateCrmError } = await admin
    .from('crm_users')
    .update({ auth_user_id: authUserId, status: mode === 'invite' ? 'invited' : 'active', last_invited_at: new Date().toISOString(), password_reset_sent_at: mode === 'reset' ? new Date().toISOString() : null, password_reset_completed_at: mode === 'reset' ? null : undefined })
    .eq('id', crmUser.id)
  if (updateCrmError) throw updateCrmError

  if (authUserId) {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: authUserId,
        full_name: crmUser.full_name,
        role: profileRoleForPermission(crmUser.permission),
        crm_user_id: crmUser.id,
        crm_company_id: crmUser.company_id,
      }, { onConflict: 'id' })
    if (profileError) throw profileError
  }

  return { ok: true, mode, email, full_name: crmUser.full_name, company_name: companyName }
}

async function setInitialPassword(body: Record<string, unknown>) {
  const crmUserId = String(body.crm_user_id || '')
  const password = String(body.password || '')
  if (!crmUserId) throw new Error('crm_user_id_required')
  if (password.length < 8) throw new Error('password_min_8_chars')

  const { data: crmUser, error: crmError } = await admin
    .from('crm_users')
    .select('*, crm_companies(*)')
    .eq('id', crmUserId)
    .maybeSingle()
  if (crmError) throw crmError
  if (!crmUser) throw new Error('crm_user_not_found')

  const email = cleanEmail(crmUser.email)
  const companyName = crmUser.crm_companies?.name || ''
  const metadata = { full_name: crmUser.full_name, company_name: companyName, crm_user_id: crmUser.id }

  let authUserId = crmUser.auth_user_id as string | null
  if (!authUserId) {
    const existingAuthUser = await findExistingAuthUser(email)
    authUserId = existingAuthUser?.id || null
  }

  if (!authUserId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    })
    if (error) throw error
    authUserId = data.user?.id || null
  } else {
    const { error } = await admin.auth.admin.updateUserById(authUserId, {
      password,
      email_confirm: true,
      user_metadata: metadata,
    })
    if (error) throw error
  }

  const { error: crmUpdateError } = await admin
    .from('crm_users')
    .update({ auth_user_id: authUserId, status: 'active' })
    .eq('id', crmUser.id)
  if (crmUpdateError) throw crmUpdateError

  if (authUserId) {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: authUserId,
        full_name: crmUser.full_name,
        role: profileRoleForPermission(crmUser.permission),
        crm_user_id: crmUser.id,
        crm_company_id: crmUser.company_id,
      }, { onConflict: 'id' })
    if (profileError) throw profileError
  }

  return { ok: true, mode: 'password_set', email, full_name: crmUser.full_name, company_name: companyName }
}

async function countRows(table: string) {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true })
  if (error) throw error
  return count || 0
}

async function deleteCustomValuesForEntity(entity: 'deal' | 'organization' | 'person' | 'activity') {
  const { data: fields, error: fieldsError } = await admin.from('custom_fields').select('id').eq('entity', entity)
  if (fieldsError) throw fieldsError
  const fieldIds = (fields || []).map((field: { id: string }) => field.id)
  if (!fieldIds.length) return 0
  const { count, error } = await admin
    .from('custom_field_values')
    .delete({ count: 'exact' })
    .in('field_id', fieldIds)
  if (error) throw error
  return count || 0
}

async function deleteAllRows(table: string) {
  const { count, error } = await admin.from(table).delete({ count: 'exact' }).not('id', 'is', null)
  if (error) throw error
  return count || 0
}

async function deleteOne(body: Record<string, unknown>) {
  const target = String(body.target || '')
  const id = String(body.id || '')
  if (!id) throw new Error('id_required')

  if (target === 'activity') {
    const { count, error } = await admin.from('activities').delete({ count: 'exact' }).eq('id', id)
    if (error) throw error
    return { ok: true, target, id, deleted: count || 0 }
  }

  if (target === 'deal') {
    const { count, error } = await admin.from('deals').delete({ count: 'exact' }).eq('id', id)
    if (error) throw error
    return { ok: true, target, id, deleted: count || 0 }
  }

  if (target === 'person') {
    const { count, error } = await admin.from('people').delete({ count: 'exact' }).eq('id', id)
    if (error) throw error
    return { ok: true, target, id, deleted: count || 0 }
  }

  if (target === 'organization') {
    const { count, error } = await admin.from('organizations').delete({ count: 'exact' }).eq('id', id)
    if (error) throw error
    return { ok: true, target, id, deleted: count || 0 }
  }

  if (target === 'user') {
    const { data: crmUser, error: userError } = await admin
      .from('crm_users')
      .select('id, auth_user_id, full_name')
      .eq('id', id)
      .maybeSingle()
    if (userError) throw userError
    if (!crmUser) throw new Error('crm_user_not_found')

    const nextStatus = String(body.status || 'deleted')
    if (!['disabled', 'deleted'].includes(nextStatus)) throw new Error('invalid_user_action_status')
    const { count, error } = await admin
      .from('crm_users')
      .update({ status: nextStatus }, { count: 'exact' })
      .eq('id', id)
    if (error) throw error

    const auth_deleted = 0
    return { ok: true, target, id, deleted: count || 0, auth_deleted, mode: nextStatus === 'disabled' ? 'disabled' : 'soft_deleted', status: nextStatus }
  }

  throw new Error('unknown_delete_target')
}

async function cleanupData(body: Record<string, unknown>, adminUserId: string) {
  const target = String(body.target || '')
  const confirm = String(body.confirm || '')
  if (confirm !== 'APAGAR') throw new Error('cleanup_confirmation_required')

  if (target === 'activities') {
    const before = await countRows('activities')
    const custom_values_deleted = await deleteCustomValuesForEntity('activity')
    const deleted = await deleteAllRows('activities')
    return { ok: true, target, before, deleted, custom_values_deleted, after: await countRows('activities') }
  }

  if (target === 'deals') {
    const before = await countRows('deals')
    const custom_values_deleted = await deleteCustomValuesForEntity('deal')
    const deleted = await deleteAllRows('deals')
    return { ok: true, target, before, deleted, custom_values_deleted, after: await countRows('deals') }
  }

  if (target === 'people') {
    const before = await countRows('people')
    const custom_values_deleted = await deleteCustomValuesForEntity('person')
    const deleted = await deleteAllRows('people')
    return { ok: true, target, before, deleted, custom_values_deleted, after: await countRows('people') }
  }

  if (target === 'organizations') {
    const before = await countRows('organizations')
    const custom_values_deleted = await deleteCustomValuesForEntity('organization')
    const deleted = await deleteAllRows('organizations')
    return { ok: true, target, before, deleted, custom_values_deleted, after: await countRows('organizations') }
  }

  if (target === 'users') {
    const before = await countRows('crm_users')
    const { data: users, error: usersError } = await admin
      .from('crm_users')
      .select('id, auth_user_id')
    if (usersError) throw usersError

    const authUserIds = [...new Set((users || [])
      .map((user: { auth_user_id: string | null }) => user.auth_user_id)
      .filter((id: string | null): id is string => Boolean(id) && id !== adminUserId))]

    const { error: profileError } = await admin
      .from('profiles')
      .update({ crm_user_id: null, crm_company_id: null })
      .neq('id', adminUserId)
    if (profileError) throw profileError

    const deleted = await deleteAllRows('crm_users')
    let auth_deleted = 0
    for (const authUserId of authUserIds) {
      const { error } = await admin.auth.admin.deleteUser(authUserId)
      if (error) throw error
      auth_deleted += 1
    }
    return { ok: true, target, before, deleted, auth_deleted, after: await countRows('crm_users') }
  }

  throw new Error('unknown_cleanup_target')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'service_credentials_missing' }, 500)
  try {
    const user = await requireAdmin(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action || 'list')
    if (action === 'list') return json(await listUsers())
    if (action === 'create-crm-user') return json(await upsertCrmUser(body))
    if (action === 'update-crm-user-details') return json(await updateCrmUserDetails(body))
    if (action === 'send-access-email') return json(await sendAccessEmail(body))
    if (action === 'set-initial-password') return json(await setInitialPassword(body))
    if (action === 'cleanup-data') return json(await cleanupData(body, user.id))
    if (action === 'delete-one') return json(await deleteOne(body))
    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = ['admin_required', 'missing_authorization', 'invalid_authorization'].includes(message) ? 403 : 400
    return json({ error: message }, status)
  }
})
