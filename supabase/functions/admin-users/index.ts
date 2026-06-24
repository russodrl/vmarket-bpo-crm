// Secure admin endpoint for CRM user management.
// Actions:
// - list
// - create-crm-user { full_name, email, company_name }
// - send-access-email { crm_user_id }

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'service_credentials_missing' }, 500)
  try {
    await requireAdmin(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = String(body.action || 'list')
    if (action === 'list') return json(await listUsers())
    if (action === 'create-crm-user') return json(await upsertCrmUser(body))
    if (action === 'send-access-email') return json(await sendAccessEmail(body))
    return json({ error: 'unknown_action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = ['admin_required', 'missing_authorization', 'invalid_authorization'].includes(message) ? 403 : 400
    return json({ error: message }, status)
  }
})
