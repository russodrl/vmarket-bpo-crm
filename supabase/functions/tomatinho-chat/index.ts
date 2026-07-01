/// <reference lib="deno.ns" />
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve(handler: (req: Request) => Response | Promise<Response>): void
}
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type JsonRecord = Record<string, unknown>
type ChatRequest = {
  message?: string
  files?: Array<{ name: string; type?: string; content?: string }>
  contextDealId?: string | null
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}
type TomatinhoExpression = 'pensativo' | 'surpreso' | 'feliz' | 'hell-yeah' | 'triste' | 'intrigado' | 'aliviado'
type TomatinhoAction = {
  type: 'create_deal' | 'create_person' | 'create_organization' | 'create_activity' | 'create_note' | 'update_focus'
  payload: JsonRecord
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const HERMES_CHAT_ENDPOINT = Deno.env.get('HERMES_CHAT_ENDPOINT') || ''
const HERMES_CHAT_TOKEN = Deno.env.get('HERMES_CHAT_TOKEN') || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'content-type': 'application/json' },
})

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

function asText(value: unknown) {
  return String(value || '').trim()
}

function pickExpression(text: string): TomatinhoExpression {
  const lower = text.toLowerCase()
  if (/erro|não consegui|falhou|problema|bloqueio/.test(lower)) return 'triste'
  if (/criado|salvo|feito|concluído|atualizado/.test(lower)) return 'hell-yeah'
  if (/encontrei|achei|resultado|resumo/.test(lower)) return 'feliz'
  if (/talvez|parece|pode ser|não tenho certeza/.test(lower)) return 'intrigado'
  return 'pensativo'
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Supabase service credentials are not configured' }, 500)

    const user = await requireUser(req)
    const payload = await req.json().catch(() => ({})) as ChatRequest
    const message = asText(payload.message)
    if (!message && !payload.files?.length) return json({ error: 'Mensagem vazia.' }, 400)

    const profile = await getProfile(user.id)
    const crm = await loadCrmSnapshot(profile, payload.contextDealId || null)
    const system = buildSystemPrompt(profile)
    const context = buildContextText(crm)

    let assistant = HERMES_CHAT_ENDPOINT
      ? await askHermes({ message, files: payload.files || [], history: payload.history || [], system, context })
      : localTomatinho({ message, files: payload.files || [], crm })

    const actions = Array.isArray(assistant.actions) ? assistant.actions as TomatinhoAction[] : []
    const actionResults = actions.length ? await executeActions(actions, user.id, profile, crm) : []
    if (actionResults.length) {
      const ok = actionResults.filter((item) => item.ok).length
      const failed = actionResults.filter((item) => !item.ok)
      const suffix = failed.length
        ? `\n\nAções: ${ok} concluída(s), ${failed.length} com erro: ${failed.map((item) => item.error).join('; ')}`
        : `\n\nAções concluídas: ${ok}.`
      assistant = { ...assistant, reply: `${assistant.reply || 'Feito.'}${suffix}`, expression: failed.length ? 'triste' : (assistant.expression || 'hell-yeah') }
    }

    return json({
      reply: assistant.reply || 'Não consegui montar uma resposta agora.',
      expression: normalizeExpression(assistant.expression, assistant.reply || ''),
      actions: actionResults,
      poweredBy: HERMES_CHAT_ENDPOINT ? 'hermes' : 'tomatinho-local',
    })
  } catch (error) {
    return json({ error: errorMessage(error), reply: 'Erro ao processar. Tente novamente.', expression: 'triste' }, 500)
  }
})

async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') || ''
  if (!auth.startsWith('Bearer ')) throw new Error('Missing authorization bearer token')
  const token = auth.slice('Bearer '.length)
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) throw new Error('Invalid Supabase user token')
  return data.user
}

async function getProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  return data || { id: userId, role: 'bpo_partner', full_name: null, bpo_id: null }
}

function readableOwner(row: JsonRecord) {
  const user = row.crm_users as JsonRecord | undefined
  return asText(user?.full_name) || asText(row.owner_id) || 'sem proprietário'
}

async function loadCrmSnapshot(profile: JsonRecord, contextDealId: string | null) {
  const isAdmin = profile.role === 'admin_vmarket'
  const ownUserId = asText(profile.id)
  const bpoId = asText(profile.bpo_id)
  const ownerFilter = (query: unknown) => {
    if (isAdmin) return query as { limit: (n: number) => unknown }
    const q = query as { or: (expr: string) => unknown }
    const parts = [`owner_id.eq.${ownUserId}`]
    if (bpoId) parts.push(`bpo_id.eq.${bpoId}`)
    return q.or(parts.join(','))
  }

  const [dealsRes, peopleRes, orgsRes, actsRes, histRes, stagesRes, usersRes] = await Promise.all([
    ownerFilter(supabase.from('deals').select('id,title,status,value,partner_value,total_value,stage_id,owner_id,bpo_id,focus_items,created_at,updated_at,expected_close_date,organizations(name,type,state,monthly_purchase),people(full_name,email,phone)').order('updated_at', { ascending: false })).limit(120),
    ownerFilter(supabase.from('people').select('id,full_name,email,phone,organization_id,owner_id,bpo_id,created_at').order('created_at', { ascending: false })).limit(80),
    ownerFilter(supabase.from('organizations').select('id,name,type,state,monthly_purchase,owner_id,bpo_id,created_at').order('created_at', { ascending: false })).limit(80),
    ownerFilter(supabase.from('activities').select('id,title,activity_type,due_at,status,note,deal_id,organization_id,person_id,owner_id,bpo_id,created_at,completed_at').order('due_at', { ascending: true })).limit(120),
    contextDealId ? supabase.from('deal_history').select('id,deal_id,event_type,title,description,created_at').eq('deal_id', contextDealId).order('created_at', { ascending: false }).limit(60) : supabase.from('deal_history').select('id,deal_id,event_type,title,description,created_at').order('created_at', { ascending: false }).limit(80),
    supabase.from('pipeline_stages').select('id,name,pipeline_name,sort_order').order('sort_order'),
    supabase.from('crm_users').select('id,full_name,email,auth_user_id,status,crm_companies(name)').order('full_name'),
  ])
  const firstError = [dealsRes, peopleRes, orgsRes, actsRes, histRes, stagesRes, usersRes].find((r) => r.error)?.error
  if (firstError) throw firstError
  const users = usersRes.data || []
  return {
    profile,
    deals: dealsRes.data || [],
    people: peopleRes.data || [],
    organizations: orgsRes.data || [],
    activities: actsRes.data || [],
    history: histRes.data || [],
    stages: stagesRes.data || [],
    users,
    userByAuthId: Object.fromEntries(users.map((user: JsonRecord) => [user.auth_user_id, user])),
  }
}

function buildSystemPrompt(profile: JsonRecord) {
  return `Você é o Agente Vmarket BPO, assistente interno do CRM BPO da VMarket. Responda sempre em pt-BR, sem se apresentar, sem saudação, sem rodeios e com o mínimo de tokens possível. Use bullets curtos quando ajudar. Dê apenas a informação objetiva ou execute a ação pedida. Nunca invente dados fora do contexto recebido. Se for criar ou alterar registros, retorne JSON com reply, expression e actions. Expressões permitidas apenas para escolher imagem quando fizer sentido: pensativo, surpreso, feliz, hell-yeah, triste, intrigado, aliviado. Perfil do usuário: ${JSON.stringify(profile)}.`
}

function buildContextText(crm: JsonRecord) {
  const deals = crm.deals as JsonRecord[]
  const activities = crm.activities as JsonRecord[]
  const people = crm.people as JsonRecord[]
  const organizations = crm.organizations as JsonRecord[]
  const openDeals = deals.filter((deal) => asText(deal.status) === 'aberto' || !deal.status)
  const wonDeals = deals.filter((deal) => asText(deal.status) === 'ganho')
  const overdue = activities.filter((activity) => asText(activity.status) === 'open' && activity.due_at && new Date(asText(activity.due_at)).getTime() < Date.now())
  return JSON.stringify({
    resumo: {
      negocios: deals.length,
      negocios_abertos: openDeals.length,
      negocios_ganhos: wonDeals.length,
      contatos: people.length,
      empresas: organizations.length,
      atividades: activities.length,
      atividades_atrasadas: overdue.length,
    },
    negocios: deals.slice(0, 60),
    atividades: activities.slice(0, 60),
    contatos: people.slice(0, 40),
    empresas: organizations.slice(0, 40),
    notas_historico: (crm.history as JsonRecord[]).slice(0, 40),
    etapas: crm.stages,
  })
}

async function askHermes(input: { message: string; files: ChatRequest['files']; history: ChatRequest['history']; system: string; context: string }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (HERMES_CHAT_TOKEN) headers.authorization = `Bearer ${HERMES_CHAT_TOKEN}`
  const res = await fetch(HERMES_CHAT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      source: 'crm-bpo-agente-vmarket',
      message: input.message,
      files: input.files,
      history: input.history,
      system: input.system,
      context: input.context,
      response_format: {
        type: 'json_object',
        schema_hint: '{"reply":"texto","expression":"pensativo|surpreso|feliz|hell-yeah|triste|intrigado|aliviado","actions":[{"type":"create_deal|create_person|create_organization|create_activity|create_note|update_focus","payload":{}}]}'
      }
    }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Hermes retornou HTTP ${res.status}: ${text.slice(0, 240)}`)
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed.reply === 'string') return parsed
    if (typeof parsed.message === 'string') return { reply: parsed.message, expression: pickExpression(parsed.message), actions: parsed.actions || [] }
    if (typeof parsed.response === 'string') return { reply: parsed.response, expression: pickExpression(parsed.response), actions: parsed.actions || [] }
    return { reply: text, expression: pickExpression(text), actions: [] }
  } catch {
    return { reply: text, expression: pickExpression(text), actions: [] }
  }
}

function localTomatinho(input: { message: string; files: ChatRequest['files']; crm: JsonRecord }) {
  const message = input.message.toLowerCase()
  const deals = input.crm.deals as JsonRecord[]
  const activities = input.crm.activities as JsonRecord[]
  const people = input.crm.people as JsonRecord[]
  const organizations = input.crm.organizations as JsonRecord[]
  const openDeals = deals.filter((deal) => asText(deal.status) === 'aberto' || !deal.status)
  const wonDeals = deals.filter((deal) => asText(deal.status) === 'ganho')
  const overdueActivities = activities.filter((activity) => asText(activity.status) === 'open' && activity.due_at && new Date(asText(activity.due_at)).getTime() < Date.now())

  if (/como|usar|funciona|atividade|anota/.test(message)) {
    return { expression: 'feliz', reply: 'Posso consultar negócios, empresas, contatos, atividades, notas e foco. Também crio registros: “crie atividade no negócio X amanhã 10h”, “adicione nota no negócio X”, “crie negócio Y”.' }
  }
  if (/quantos|resumo|status|pipeline|negócios|negocios/.test(message)) {
    const top = openDeals.slice(0, 5).map((deal) => `• ${asText(deal.title)}: ${asText(deal.status) || 'aberto'}, valor ${Number(deal.total_value || deal.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`).join('\n')
    return { expression: 'pensativo', reply: `Resumo rápido:\n• Negócios: ${deals.length}\n• Abertos: ${openDeals.length}\n• Ganhos: ${wonDeals.length}\n• Contatos: ${people.length}\n• Empresas: ${organizations.length}\n• Atividades abertas/atrasadas: ${activities.filter((a) => asText(a.status) === 'open').length}/${overdueActivities.length}\n\nPrincipais negócios abertos:\n${top || 'Nenhum negócio aberto encontrado.'}` }
  }
  if (input.files.length) {
    return { expression: 'intrigado', reply: `Recebi ${input.files.length} arquivo(s). A análise profunda de arquivo fica ativa quando o endpoint Hermes estiver configurado. Por enquanto consigo responder com base nos dados carregados do CRM.` }
  }
  return { expression: 'pensativo', reply: 'Peça uma consulta ou ação objetiva no CRM.' }
}

function normalizeExpression(value: unknown, reply: string): TomatinhoExpression {
  const valid = ['pensativo', 'surpreso', 'feliz', 'hell-yeah', 'triste', 'intrigado', 'aliviado']
  return valid.includes(String(value)) ? String(value) as TomatinhoExpression : pickExpression(reply)
}

async function executeActions(actions: TomatinhoAction[], authUserId: string, profile: JsonRecord, crm: JsonRecord) {
  const results: Array<{ ok: boolean; type: string; id?: string; error?: string }> = []
  for (const action of actions.slice(0, 5)) {
    try {
      const result = await executeAction(action, authUserId, profile, crm)
      results.push({ ok: true, type: action.type, id: result.id })
    } catch (error) {
      results.push({ ok: false, type: action.type, error: errorMessage(error) })
    }
  }
  return results
}

async function executeAction(action: TomatinhoAction, authUserId: string, profile: JsonRecord, crm: JsonRecord) {
  const payload = action.payload || {}
  const ownerId = asText(payload.owner_id) || authUserId
  const bpoId = asText(profile.bpo_id) || null
  if (action.type === 'create_organization') {
    const name = asText(payload.name)
    if (!name) throw new Error('Nome da empresa obrigatório.')
    const { data, error } = await supabase.from('organizations').insert({ name, type: payload.type || null, state: payload.state || null, monthly_purchase: Number(payload.monthly_purchase || 0) || null, owner_id: ownerId, bpo_id: bpoId }).select('id').single()
    if (error) throw error
    return data
  }
  if (action.type === 'create_person') {
    const fullName = asText(payload.full_name || payload.name)
    if (!fullName) throw new Error('Nome do contato obrigatório.')
    const { data, error } = await supabase.from('people').insert({ full_name: fullName, email: payload.email || null, phone: payload.phone || null, organization_id: payload.organization_id || null, labels: [], owner_id: ownerId, bpo_id: bpoId }).select('id').single()
    if (error) throw error
    return data
  }
  if (action.type === 'create_deal') {
    const title = asText(payload.title)
    if (!title) throw new Error('Título do negócio obrigatório.')
    const stageId = asText(payload.stage_id) || asText((crm.stages as JsonRecord[]).find((stage) => asText(stage.pipeline_name) === 'Pipeline de Vendas')?.id) || null
    const { data, error } = await supabase.from('deals').insert({ title, organization_id: payload.organization_id || null, person_id: payload.person_id || null, stage_id: stageId, owner_id: ownerId, bpo_id: bpoId, value: Number(payload.value || 0) || null, monthly_purchase: Number(payload.monthly_purchase || 0) || null, status: 'aberto', lead_source: profile.role === 'bpo_partner' ? 'parceiro' : 'vmarket', source: 'Agente Vmarket BPO', focus_items: [] }).select('id').single()
    if (error) throw error
    await supabase.from('deal_history').insert({ deal_id: data.id, event_type: 'Sistema', title: 'Negócio criado pelo Agente', description: 'Criado pelo Agente Vmarket BPO.' })
    return data
  }
  if (action.type === 'create_activity') {
    const title = asText(payload.title)
    if (!title) throw new Error('Título da atividade obrigatório.')
    const dealId = asText(payload.deal_id)
    const deal = dealId ? (crm.deals as JsonRecord[]).find((item) => item.id === dealId) : undefined
    const { data, error } = await supabase.from('activities').insert({ title, activity_type: payload.activity_type || 'task', due_at: payload.due_at || null, status: 'open', note: payload.note || null, deal_id: dealId || null, organization_id: payload.organization_id || deal?.organization_id || null, person_id: payload.person_id || deal?.person_id || null, owner_id: ownerId, bpo_id: bpoId }).select('id').single()
    if (error) throw error
    if (dealId) await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Atividade', title: 'Atividade criada pelo Agente', description: title })
    return data
  }
  if (action.type === 'create_note') {
    const dealId = asText(payload.deal_id)
    const text = asText(payload.description || payload.note || payload.text)
    if (!dealId || !text) throw new Error('Nota precisa de deal_id e texto.')
    const { data, error } = await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Anotação', title: 'Anotação adicionada pelo Agente', description: text }).select('id').single()
    if (error) throw error
    return data
  }
  if (action.type === 'update_focus') {
    const dealId = asText(payload.deal_id)
    const focusItems = Array.isArray(payload.focus_items) ? payload.focus_items.map(asText).filter(Boolean) : asText(payload.focus_items).split('\n').map((item) => item.trim()).filter(Boolean)
    if (!dealId) throw new Error('Foco precisa de deal_id.')
    const { data, error } = await supabase.from('deals').update({ focus_items: focusItems }).eq('id', dealId).select('id').single()
    if (error) throw error
    await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Edição', title: 'Foco atualizado pelo Agente', description: focusItems.join('\n') })
    return data
  }
  throw new Error(`Ação não suportada: ${action.type}`)
}
