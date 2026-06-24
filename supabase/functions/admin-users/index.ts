// Secure admin endpoint for CRM user management.
// Actions:
// - list
// - create-crm-user { full_name, email, company_name }
// - send-access-email { crm_user_id }
// - set-initial-password { crm_user_id, password }
// - cleanup-data { target, confirm }

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
        role: 'bpo_partner',
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
    .update({ auth_user_id: authUserId, status: mode === 'invite' ? 'invited' : 'active', last_invited_at: new Date().toISOString() })
    .eq('id', crmUser.id)
  if (updateCrmError) throw updateCrmError

  if (authUserId) {
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: authUserId,
        full_name: crmUser.full_name,
        role: 'bpo_partner',
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
        role: 'bpo_partner',
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
    if (action === 'send-access-email') return json(await sendAccessEmail(body))
    if (action === 'set-initial-password') return json(await setInitialPassword(body))
    if (action === 'cleanup-data') return json(await cleanupData(body, user.id))
    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = ['admin_required', 'missing_authorization', 'invalid_authorization'].includes(message) ? 403 : 400
    return json({ error: message }, status)
  }
})
