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
type BpoAgentExpression = 'pensativo' | 'surpreso' | 'feliz' | 'hell-yeah' | 'triste' | 'intrigado' | 'aliviado'
type BpoAgentAction = {
  type: 'create_deal' | 'create_person' | 'create_organization' | 'create_activity' | 'create_note' | 'update_focus' | 'update_deal' | 'update_person' | 'update_organization'
  payload: JsonRecord
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const HERMES_CHAT_ENDPOINT = Deno.env.get('HERMES_CHAT_ENDPOINT') || ''
const HERMES_CHAT_TOKEN = Deno.env.get('HERMES_CHAT_TOKEN') || ''
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || ''
const OPENAI_CHAT_MODEL = Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-4o-mini'
const OPENAI_TRANSCRIBE_MODEL = Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'whisper-1'
const INTEGRATION_INTERNAL_TOKEN = Deno.env.get('INTEGRATION_INTERNAL_TOKEN') || ''

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

function pickExpression(text: string): BpoAgentExpression {
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
    const files = payload.files || []
    const system = buildSystemPrompt(profile)
    const context = buildContextText(crm)
    const knowledge = retrieveCrmBpoKnowledge(`${message} ${files.map((file) => `${file.name} ${file.type || ''}`).join(' ')}`)

    let assistant = HERMES_CHAT_ENDPOINT
      ? await askHermes({ message, files, history: payload.history || [], system, context: `${context}

BASE_DE_CONHECIMENTO_CRM_BPO:
${knowledge}` })
      : OPENAI_API_KEY
        ? await askOpenAI({ message, files, history: payload.history || [], system, context, knowledge })
        : localBpoAgent({ message, files, crm, knowledge })

    const actions = Array.isArray(assistant.actions) ? assistant.actions as BpoAgentAction[] : []
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
  const isAdmin = profile.role === 'admin_vmarket'
  return `Você é o Agente Vmarket BPO, assistente interno do CRM BPO da VMarket. Responda sempre em pt-BR, sem se apresentar, sem saudação, sem rodeios e com o mínimo de tokens possível. Use bullets curtos quando ajudar. Entenda texto, áudio transcrito e imagens. Nunca diga qual infraestrutura, modelo, endpoint ou ferramenta está usando. Nunca invente dados fora do contexto recebido. Se houver pedido de ação no CRM/Pipedrive, retorne JSON com reply, expression e actions. Respeite permissões: ${isAdmin ? 'usuário administrador, pode agir como administrador nos registros do CRM BPO.' : 'usuário parceiro, só pode agir em registros visíveis/permitidos.'} Ações permitidas: create_deal, create_person, create_organization, create_activity, create_note, update_focus, update_deal, update_person, update_organization. Expressões permitidas: pensativo, surpreso, feliz, hell-yeah, triste, intrigado, aliviado. Perfil do usuário: ${JSON.stringify(profile)}.`
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


const CRM_BPO_KNOWLEDGE = [
  { title: 'Visão geral', text: 'CRM BPO organiza funil de Negócios, Contatos, Empresas, Atividades, Avisos, Planos VMarket, Comissões VMarket, Campos, Automações, Distribuição de Leads e Log de Alterações. Admin VMarket vê áreas administrativas; parceiro vê dados próprios ou do BPO permitido.' },
  { title: 'Ficha do negócio', text: 'Na ficha do negócio há grupos Empresa, Contato, Informações do Negócio, Plataforma VMarket, Serviços Parceiro, anexos/documentos, histórico e foco. Alterações relevantes devem aparecer no histórico em formato Campo: anterior → novo, com data e autor quando disponível.' },
  { title: 'Histórico', text: 'Histórico central reúne notas, uploads, atividades e mudanças de campos do negócio, empresa e contato vinculados. Deve evitar categoria desnecessária acima do nome do campo e permitir filtro de atividades quando disponível.' },
  { title: 'Pipedrive', text: 'Integração Pipedrive importa negócios do owner Aleksander, sincroniza etapas do Pipeline de Vendas, campos nativos e campos configuráveis com pipedrive_key. Deals Pipedrive de outro owner ficam sem proprietário no CRM para aparecer em Avisos.' },
  { title: 'Campos Pipedrive e API', text: 'Tela de campos mostra Mapeamento Pipedrive → CRM BPO e Mapeamento CRM BPO → Pipedrive, incluindo ID Pipedrive, ID CRM BPO, tipos e direção de sincronização. Campos sem pipedrive_key são somente CRM BPO.' },
  { title: 'Criação e edição', text: 'Usuário pode criar negócio com empresa/contato, criar nota, criar atividade, concluir atividade, marcar ganho/perdido, atualizar foco e editar campos permitidos. Para perdido, motivo é obrigatório.' },
  { title: 'Lead distribution', text: 'Distribuição de leads usa regras por DDD, estado e fila geral. Conta as cargas de usuários ativos e exclui contas de teste como aspalamar. Registros sem proprietário aparecem em Avisos.' },
  { title: 'Permissões', text: 'Admin VMarket pode administrar usuários, campos, automações, distribuição, log e exclusões. Parceiro deve ficar limitado ao próprio owner_id/bpo_id e aos dados relacionados permitidos por RLS.' },
  { title: 'Comercial VMarket', text: 'Valor VMarket e Serviços Parceiro compõem o valor total. Planos VMarket exibem tabelas de Restaurantes e Hotéis, mensal/semestral e valor BPO. Valor por CNPJ não pode ultrapassar valor comercial VMarket.' },
]

function retrieveCrmBpoKnowledge(query: string) {
  const terms = asText(query).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((term) => term.length > 2)
  const scored = CRM_BPO_KNOWLEDGE.map((doc) => {
    const hay = `${doc.title} ${doc.text}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const score = terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0)
    return { ...doc, score }
  }).sort((a, b) => b.score - a.score)
  return scored.filter((doc) => doc.score > 0).slice(0, 5).concat(scored.filter((doc) => doc.score === 0).slice(0, 2)).map((doc) => `## ${doc.title}\n${doc.text}`).join('\n\n')
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) throw new Error('Arquivo inválido.')
  const mime = match[1] || 'application/octet-stream'
  const encoded = match[3] || ''
  const binary = match[2] ? atob(encoded) : decodeURIComponent(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function transcribeAudio(file: { name: string; type?: string; content?: string }) {
  if (!file.content) return ''
  const form = new FormData()
  form.append('model', OPENAI_TRANSCRIBE_MODEL)
  form.append('language', 'pt')
  form.append('file', dataUrlToBlob(file.content), file.name || 'audio.webm')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  })
  const data = await res.json().catch(() => ({})) as JsonRecord
  if (!res.ok) throw new Error(`Falha ao entender áudio: ${asText(data.error && (data.error as JsonRecord).message) || res.status}`)
  return asText(data.text)
}

async function askOpenAI(input: { message: string; files: ChatRequest['files']; history: ChatRequest['history']; system: string; context: string; knowledge: string }) {
  const audioTexts: string[] = []
  const images = [] as Array<{ type: 'image_url'; image_url: { url: string } }>
  const otherFiles: string[] = []
  for (const file of input.files || []) {
    const type = String(file.type || '')
    if (type.startsWith('audio/')) {
      const text = await transcribeAudio(file)
      if (text) audioTexts.push(`${file.name}: ${text}`)
    } else if (type.startsWith('image/') && file.content) {
      images.push({ type: 'image_url', image_url: { url: file.content } })
    } else {
      otherFiles.push(`${file.name} (${type || 'arquivo'})`)
    }
  }
  const textParts = [
    input.message ? `Mensagem do usuário:\n${input.message}` : '',
    audioTexts.length ? `Áudio transcrito:\n${audioTexts.join('\n')}` : '',
    otherFiles.length ? `Arquivos anexados sem leitura profunda:\n${otherFiles.join('\n')}` : '',
    `Contexto CRM:\n${input.context}`,
    `Base de conhecimento CRM BPO:\n${input.knowledge}`,
    'Responda JSON puro no formato {"reply":"texto curto","expression":"pensativo|surpreso|feliz|hell-yeah|triste|intrigado|aliviado","actions":[{"type":"...","payload":{}}]}. Se o usuário pedir para criar/editar/executar algo no CRM/Pipedrive e houver dados suficientes, inclua actions. Se faltar dado essencial, pergunte apenas o dado faltante.'
  ].filter(Boolean).join('\n\n')
  const messages = [
    { role: 'system', content: input.system },
    ...input.history.slice(-6).map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: [{ type: 'text', text: textParts }, ...images] },
  ]
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_CHAT_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages }),
  })
  const data = await res.json().catch(() => ({})) as JsonRecord
  if (!res.ok) throw new Error(asText((data.error as JsonRecord | undefined)?.message) || 'Falha ao processar solicitação.')
  const content = asText(((data.choices as JsonRecord[] | undefined)?.[0]?.message as JsonRecord | undefined)?.content)
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed.reply === 'string') return parsed
  } catch { /* ignore */ }
  return { reply: content || 'Não consegui responder agora.', expression: pickExpression(content || ''), actions: [] }
}

async function askHermes(input: { message: string; files: ChatRequest['files']; history: ChatRequest['history']; system: string; context: string }) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-hermes-session-key': 'crm-bpo-agent',
  }
  if (HERMES_CHAT_TOKEN) headers.authorization = `Bearer ${HERMES_CHAT_TOKEN}`

  const audioTexts: string[] = []
  const imageParts = [] as Array<{ type: 'image_url'; image_url: { url: string } }>
  const otherFiles: string[] = []
  for (const file of input.files || []) {
    const type = String(file.type || '')
    if (type.startsWith('audio/')) {
      if (OPENAI_API_KEY) {
        const text = await transcribeAudio(file)
        if (text) audioTexts.push(`${file.name}: ${text}`)
      } else {
        otherFiles.push(`${file.name} (${type || 'áudio'}; transcrição ao vivo do navegador usada quando disponível)`)
      }
    } else if (type.startsWith('image/') && file.content) {
      imageParts.push({ type: 'image_url', image_url: { url: file.content } })
    } else {
      otherFiles.push(`${file.name} (${type || 'arquivo'})`)
    }
  }

  const textParts = [
    input.message ? `Mensagem do usuário:\n${input.message}` : '',
    audioTexts.length ? `Áudio transcrito:\n${audioTexts.join('\n')}` : '',
    otherFiles.length ? `Arquivos anexados sem leitura profunda:\n${otherFiles.join('\n')}` : '',
    `Contexto e base CRM:\n${input.context}`,
    'Responda JSON puro no formato {"reply":"texto curto","expression":"pensativo|surpreso|feliz|hell-yeah|triste|intrigado|aliviado","actions":[{"type":"...","payload":{}}]}. Se o usuário pedir para criar/editar/executar algo no CRM/Pipedrive e houver dados suficientes, inclua actions. Se faltar dado essencial, pergunte apenas o dado faltante. Se houver Áudio transcrito, interprete o conteúdo do áudio como a mensagem principal do usuário.',
  ].filter(Boolean).join('\n\n')

  const messages = [
    { role: 'system', content: input.system },
    ...(input.history || []).slice(-6).map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: [{ type: 'text', text: textParts }, ...imageParts] },
  ]

  const res = await fetch(HERMES_CHAT_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'bpo-agent', stream: false, messages }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Hermes retornou HTTP ${res.status}: ${text.slice(0, 240)}`)
  try {
    const envelope = JSON.parse(text) as JsonRecord
    const content = asText((((envelope.choices as JsonRecord[] | undefined)?.[0]?.message as JsonRecord | undefined)?.content))
    const candidate = content || text
    try {
      const parsed = JSON.parse(candidate) as JsonRecord
      if (typeof parsed.reply === 'string') return parsed
      if (typeof parsed.message === 'string') return { reply: parsed.message, expression: pickExpression(parsed.message), actions: parsed.actions || [] }
      if (typeof parsed.response === 'string') return { reply: parsed.response, expression: pickExpression(parsed.response), actions: parsed.actions || [] }
    } catch {
      // Hermes may return a normal assistant message instead of JSON. In that case,
      // keep the assistant text and do not leak the OpenAI-compatible envelope to the CRM UI.
    }
    return { reply: content || text, expression: pickExpression(content || text), actions: [] }
  } catch {
    return { reply: text, expression: pickExpression(text), actions: [] }
  }
}

function localBpoAgent(input: { message: string; files: ChatRequest['files']; crm: JsonRecord; knowledge: string }) {
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
  if ((input.files || []).length) {
    return { expression: 'intrigado', reply: 'Não consegui entender o arquivo ainda. Se for urgente, envie o pedido em texto.' }
  }
  return { expression: 'pensativo', reply: 'Peça uma consulta ou ação objetiva no CRM.' }
}

function normalizeExpression(value: unknown, reply: string): BpoAgentExpression {
  const valid = ['pensativo', 'surpreso', 'feliz', 'hell-yeah', 'triste', 'intrigado', 'aliviado']
  return valid.includes(String(value)) ? String(value) as BpoAgentExpression : pickExpression(reply)
}

async function executeActions(actions: BpoAgentAction[], authUserId: string, profile: JsonRecord, crm: JsonRecord) {
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

async function executeAction(action: BpoAgentAction, authUserId: string, profile: JsonRecord, crm: JsonRecord) {
  const payload = action.payload || {}
  const requestedOwnerId = asText(payload.owner_id)
  const ownerId = profile.role === 'admin_vmarket' && requestedOwnerId ? requestedOwnerId : authUserId
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
  if (action.type === 'update_deal') {
    const dealId = asText(payload.deal_id || payload.id)
    if (!dealId) throw new Error('Informe o negócio.')
    ensureDealAccess(crm, dealId)
    const patch: JsonRecord = {}
    for (const key of ['title', 'status', 'expected_close_date', 'stage_id']) if (payload[key] !== undefined) patch[key] = payload[key] || null
    if (payload.value !== undefined) patch.value = Number(payload.value || 0) || null
    if (payload.monthly_purchase !== undefined) patch.monthly_purchase = Number(payload.monthly_purchase || 0) || null
    if (payload.focus_items !== undefined) patch.focus_items = Array.isArray(payload.focus_items) ? payload.focus_items.map(asText).filter(Boolean) : asText(payload.focus_items).split('\n').map((item) => item.trim()).filter(Boolean)
    if (!Object.keys(patch).length) throw new Error('Nenhum campo de negócio para atualizar.')
    const { data, error } = await supabase.from('deals').update(patch).eq('id', dealId).select('id').single()
    if (error) throw error
    await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Edição', title: 'Negócio atualizado pelo Agente', description: Object.keys(patch).join(', ') })
    await syncDealToPipedrive(dealId).catch(() => null)
    return data
  }
  if (action.type === 'update_person') {
    const personId = asText(payload.person_id || payload.id)
    if (!personId) throw new Error('Informe o contato.')
    ensurePersonAccess(crm, personId)
    const patch: JsonRecord = {}
    if (payload.full_name !== undefined || payload.name !== undefined) patch.full_name = asText(payload.full_name || payload.name)
    for (const key of ['email', 'phone', 'role_title', 'organization_id']) if (payload[key] !== undefined) patch[key] = payload[key] || null
    if (!Object.keys(patch).length) throw new Error('Nenhum campo de contato para atualizar.')
    const { data, error } = await supabase.from('people').update(patch).eq('id', personId).select('id').single()
    if (error) throw error
    await syncLinkedDealsToPipedrive('person_id', personId, crm).catch(() => null)
    return data
  }
  if (action.type === 'update_organization') {
    const organizationId = asText(payload.organization_id || payload.id)
    if (!organizationId) throw new Error('Informe a empresa.')
    ensureOrganizationAccess(crm, organizationId)
    const patch: JsonRecord = {}
    if (payload.name !== undefined) patch.name = asText(payload.name)
    for (const key of ['type', 'state', 'city', 'segment']) if (payload[key] !== undefined) patch[key] = payload[key] || null
    if (payload.monthly_purchase !== undefined) patch.monthly_purchase = Number(payload.monthly_purchase || 0) || null
    if (payload.cnpjs !== undefined) patch.cnpjs = Number(payload.cnpjs || 0) || null
    if (!Object.keys(patch).length) throw new Error('Nenhum campo de empresa para atualizar.')
    const { data, error } = await supabase.from('organizations').update(patch).eq('id', organizationId).select('id').single()
    if (error) throw error
    await syncLinkedDealsToPipedrive('organization_id', organizationId, crm).catch(() => null)
    return data
  }
  throw new Error(`Ação não suportada: ${action.type}`)
}

function ensureDealAccess(crm: JsonRecord, dealId: string) {
  if (!(crm.deals as JsonRecord[]).some((deal) => deal.id === dealId)) throw new Error('Sem permissão para este negócio.')
}
function ensurePersonAccess(crm: JsonRecord, personId: string) {
  if (!(crm.people as JsonRecord[]).some((person) => person.id === personId)) throw new Error('Sem permissão para este contato.')
}
function ensureOrganizationAccess(crm: JsonRecord, organizationId: string) {
  if (!(crm.organizations as JsonRecord[]).some((org) => org.id === organizationId)) throw new Error('Sem permissão para esta empresa.')
}
async function syncDealToPipedrive(dealId: string) {
  if (!INTEGRATION_INTERNAL_TOKEN || !SUPABASE_URL) return
  await fetch(`${SUPABASE_URL}/functions/v1/pipedrive-sync`, {
    method: 'POST',
    headers: { authorization: `Bearer ${INTEGRATION_INTERNAL_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'sync-existing-deal-to-pipedrive', deal_id: dealId }),
  })
}
async function syncLinkedDealsToPipedrive(field: 'person_id' | 'organization_id', id: string, crm: JsonRecord) {
  const deals = (crm.deals as JsonRecord[]).filter((deal) => deal[field] === id || (field === 'person_id' && deal.people && (deal.people as JsonRecord).id === id) || (field === 'organization_id' && deal.organizations && (deal.organizations as JsonRecord).id === id))
  for (const deal of deals.slice(0, 10)) if (deal.id) await syncDealToPipedrive(String(deal.id))
}
