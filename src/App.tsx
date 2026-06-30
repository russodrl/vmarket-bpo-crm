import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  Building2,
  CalendarClock,
  Contact,
  GripVertical,
  LayoutDashboard,
  List,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquare,
  PhoneCall,
  FileText,
  Filter,
  Star,
  User,
  ClipboardList,
  CheckSquare,
  Users,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Tags,
} from 'lucide-react'
import { supabase, supabaseConfigured, type ActivityRow, type AuditLog, type AutomationRule, type AutomationRuleChange, type AutomationRuleExecution, type CrmCompany, type CrmUser, type CustomField, type CustomFieldValue, type Deal, type DealLabel, type DealLabelAssignment, type HistoryRow, type Organization, type Person, type Profile, type Stage } from './supabase'
import './App.css'

type View = 'pipeline' | 'contacts' | 'companies' | 'activities' | 'automations' | 'audit' | 'fields' | 'admin'
type NewDeal = {
  title: string
  organization_name: string
  contact_name: string
  contact_email: string
  contact_phone: string
  value: string
  monthly_purchase: string
  stage_id: string
  owner_id: string
}

type NewActivity = {
  title: string
  activity_type: string
  due_date: string
  due_time: string
  note: string
}

type ActivityEditDraft = NewActivity & {
  status: ActivityRow['status']
}

type DeleteTarget = 'deal' | 'activity' | 'person' | 'organization' | 'user'


type FilterEntity = 'deal' | 'person' | 'organization' | 'activity'
type FilterGroup = 'all' | 'any'
type FilterOperator = 'contains' | 'equals' | 'is_empty' | 'is_not_empty'
type FilterField = {
  id: string
  entity: FilterEntity
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'option' | 'custom'
  customFieldId?: string
}
type FilterRule = {
  id: string
  group: FilterGroup
  entity: FilterEntity
  fieldId: string
  operator: FilterOperator
  value: string
}
type SavedDealFilter = {
  id: string
  name: string
  favorite: boolean
  visibility: 'private'
  rules: FilterRule[]
  createdAt: string
}
type FilterDraft = {
  id?: string
  name: string
  favorite: boolean
  rules: FilterRule[]
}

type FilterContext = {
  stages: Stage[]
  activities: ActivityRow[]
  customFields: CustomField[]
  customFieldValues: CustomFieldValue[]
}

const filterEntityLabel: Record<FilterEntity, string> = {
  deal: 'Negócio',
  person: 'Pessoa',
  organization: 'Empresa',
  activity: 'Atividade',
}
const filterOperatorLabel: Record<FilterOperator, string> = {
  contains: 'contém',
  equals: 'é igual a',
  is_empty: 'está vazio',
  is_not_empty: 'não está vazio',
}
const dealFilterStorageKey = 'vmarket-crm-deal-filters'
const emptyFilterDraft = (): FilterDraft => ({ name: '', favorite: false, rules: [newFilterRule('all')] })
function newFilterRule(group: FilterGroup): FilterRule {
  return { id: `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`, group, entity: 'deal', fieldId: '', operator: 'contains', value: '' }
}
function normalizeFilterValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(normalizeFilterValue).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
function normalizeForCompare(value: unknown) {
  return normalizeFilterValue(value).toLocaleLowerCase('pt-BR').trim()
}
function formatFilterValue(value: unknown) {
  const text = normalizeFilterValue(value)
  return text || 'Vazio'
}
function uniqueValues(values: unknown[]) {
  const seen = new Map<string, string>()
  values.map(formatFilterValue).forEach((value) => {
    const key = value.toLocaleLowerCase('pt-BR')
    if (value && !seen.has(key)) seen.set(key, value)
  })
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 80)
}
function getCustomFieldValue(customFieldValues: CustomFieldValue[], fieldId: string, entityId?: string | null) {
  if (!entityId) return ''
  return customFieldValues.find((value) => value.field_id === fieldId && value.entity_id === entityId)?.value ?? ''
}
function getFilterRawValue(deal: Deal, rule: FilterRule, fields: FilterField[], context: FilterContext): unknown {
  const field = fields.find((item) => item.id === rule.fieldId)
  if (!field) return ''
  if (field.customFieldId) {
    if (field.entity === 'deal') return getCustomFieldValue(context.customFieldValues, field.customFieldId, deal.id)
    if (field.entity === 'person') return getCustomFieldValue(context.customFieldValues, field.customFieldId, deal.person_id)
    if (field.entity === 'organization') return getCustomFieldValue(context.customFieldValues, field.customFieldId, deal.organization_id)
    const activityValues = context.activities
      .filter((activity) => activity.deal_id === deal.id)
      .map((activity) => getCustomFieldValue(context.customFieldValues, field.customFieldId!, activity.id))
    return activityValues.filter(Boolean).join(', ')
  }
  if (field.entity === 'deal') {
    if (field.key === 'stage') return context.stages.find((stage) => stage.id === deal.stage_id)?.name || deal.pipeline_stages?.name || ''
    if (field.key === 'pipeline') return context.stages.find((stage) => stage.id === deal.stage_id)?.pipeline_name || deal.pipeline_stages?.pipeline_name || ''
    if (field.key === 'owner') return deal.pipedrive_owner_name || deal.bpo_partners?.name || deal.owner_id || ''
    return (deal as unknown as Record<string, unknown>)[field.key]
  }
  if (field.entity === 'person') return (deal.people as unknown as Record<string, unknown> | undefined)?.[field.key]
  if (field.entity === 'organization') return (deal.organizations as unknown as Record<string, unknown> | undefined)?.[field.key]
  const values = context.activities.filter((activity) => activity.deal_id === deal.id).map((activity) => {
    if (field.key === 'display_status') return activityDisplayStatus(activity)
    return (activity as unknown as Record<string, unknown>)[field.key]
  })
  return values.filter((value) => normalizeFilterValue(value)).join(', ')
}
function matchesFilterRule(deal: Deal, rule: FilterRule, fields: FilterField[], context: FilterContext) {
  if (!rule.fieldId) return true
  const raw = getFilterRawValue(deal, rule, fields, context)
  const value = normalizeForCompare(raw)
  const expected = normalizeForCompare(rule.value)
  if (rule.operator === 'is_empty') return !value
  if (rule.operator === 'is_not_empty') return Boolean(value)
  if (!expected) return true
  if (rule.operator === 'equals') return value === expected
  return value.includes(expected)
}

function filterIncludesDealStatus(savedFilter?: SavedDealFilter) {
  return Boolean(savedFilter?.rules.some((rule) => rule.fieldId === 'deal:status'))
}
function filterDealsBySavedFilter(deals: Deal[], savedFilter: SavedDealFilter | undefined, fields: FilterField[], context: FilterContext) {
  if (!savedFilter || !savedFilter.rules.length) return deals
  const allRules = savedFilter.rules.filter((rule) => rule.group === 'all' && rule.fieldId)
  const anyRules = savedFilter.rules.filter((rule) => rule.group === 'any' && rule.fieldId)
  return deals.filter((deal) => {
    const allOk = allRules.every((rule) => matchesFilterRule(deal, rule, fields, context))
    const anyOk = anyRules.length === 0 || anyRules.some((rule) => matchesFilterRule(deal, rule, fields, context))
    return allOk && anyOk
  })
}
function loadSavedDealFilters(): SavedDealFilter[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(dealFilterStorageKey) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function saveDealFilters(filters: SavedDealFilter[]) {
  window.localStorage.setItem(dealFilterStorageKey, JSON.stringify(filters))
}
function buildFilterFields(customFields: CustomField[]): FilterField[] {
  const base: FilterField[] = [
    { id: 'deal:title', entity: 'deal', key: 'title', label: 'Título', type: 'text' },
    { id: 'deal:value', entity: 'deal', key: 'value', label: 'Valor', type: 'number' },
    { id: 'deal:monthly_purchase', entity: 'deal', key: 'monthly_purchase', label: 'GMV mensal', type: 'number' },
    { id: 'deal:estimated_savings', entity: 'deal', key: 'estimated_savings', label: 'Economia estimada', type: 'number' },
    { id: 'deal:probability', entity: 'deal', key: 'probability', label: 'Probabilidade', type: 'number' },
    { id: 'deal:status', entity: 'deal', key: 'status', label: 'Status', type: 'option' },
    { id: 'deal:lead_source', entity: 'deal', key: 'lead_source', label: 'Fonte do Lead', type: 'option' },
    { id: 'deal:source', entity: 'deal', key: 'source', label: 'Origem', type: 'text' },
    { id: 'deal:stage', entity: 'deal', key: 'stage', label: 'Etapa', type: 'option' },
    { id: 'deal:pipeline', entity: 'deal', key: 'pipeline', label: 'Funil', type: 'option' },
    { id: 'deal:owner', entity: 'deal', key: 'owner', label: 'Proprietário do negócio', type: 'text' },
    { id: 'deal:pipedrive_owner_name', entity: 'deal', key: 'pipedrive_owner_name', label: 'Proprietário no Pipedrive', type: 'text' },
    { id: 'deal:expected_close_date', entity: 'deal', key: 'expected_close_date', label: 'Data esperada de fechamento', type: 'date' },
    { id: 'deal:pipedrive_deal_created_at', entity: 'deal', key: 'pipedrive_deal_created_at', label: 'Criação do Negócio', type: 'date' },
    { id: 'deal:created_at', entity: 'deal', key: 'created_at', label: 'Criado em', type: 'date' },
    { id: 'deal:updated_at', entity: 'deal', key: 'updated_at', label: 'Atualizado em', type: 'date' },
    { id: 'person:full_name', entity: 'person', key: 'full_name', label: 'Nome da pessoa', type: 'text' },
    { id: 'person:role_title', entity: 'person', key: 'role_title', label: 'Cargo da pessoa', type: 'text' },
    { id: 'person:email', entity: 'person', key: 'email', label: 'Email da pessoa', type: 'text' },
    { id: 'person:phone', entity: 'person', key: 'phone', label: 'Telefone da pessoa', type: 'text' },
    { id: 'organization:name', entity: 'organization', key: 'name', label: 'Nome da empresa', type: 'text' },
    { id: 'organization:segment', entity: 'organization', key: 'segment', label: 'Segmento da empresa', type: 'text' },
    { id: 'organization:city', entity: 'organization', key: 'city', label: 'Cidade da empresa', type: 'text' },
    { id: 'organization:state', entity: 'organization', key: 'state', label: 'Estado da empresa', type: 'text' },
    { id: 'organization:cnpjs', entity: 'organization', key: 'cnpjs', label: 'CNPJs', type: 'number' },
    { id: 'organization:monthly_purchase', entity: 'organization', key: 'monthly_purchase', label: 'Compra mensal', type: 'number' },
    { id: 'activity:title', entity: 'activity', key: 'title', label: 'Título da atividade', type: 'text' },
    { id: 'activity:activity_type', entity: 'activity', key: 'activity_type', label: 'Tipo de atividade', type: 'option' },
    { id: 'activity:display_status', entity: 'activity', key: 'display_status', label: 'Status da atividade', type: 'option' },
    { id: 'activity:due_at', entity: 'activity', key: 'due_at', label: 'Vencimento da atividade', type: 'date' },
    { id: 'activity:note', entity: 'activity', key: 'note', label: 'Nota da atividade', type: 'text' },
    { id: 'activity:completed_at', entity: 'activity', key: 'completed_at', label: 'Conclusão da atividade', type: 'date' },
  ]
  const custom = customFields.map((field): FilterField => ({
    id: `${field.entity}:custom:${field.id}`,
    entity: field.entity,
    key: field.name,
    label: field.name,
    type: 'custom',
    customFieldId: field.id,
  }))
  return [...base, ...custom]
}

const blankNewDeal = (): NewDeal => ({
  title: '',
  organization_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  value: '',
  monthly_purchase: '',
  stage_id: '',
  owner_id: '',
})

const blankNewActivity = (): NewActivity => ({
  title: '',
  activity_type: 'task',
  due_date: '',
  due_time: '',
  note: '',
})

type DealForm = {
  title: string
  stage_id: string
  owner_id: string
  status: string
  value: string
  monthly_purchase: string
  source: string
  expected_close_date: string
  focus_items: string
  organization_name: string
  organization_segment: string
  organization_city: string
  organization_state: string
  organization_cnpjs: string
  lost_reason: string
  lead_source: string
  vm_sale: boolean
  contract_with: string
  vm_product_type: string
  vm_cnpj_count: string
  vm_plan: string
  vm_value_per_cnpj: string
  contract_legal_name: string
  contract_tax_id: string
  contract_address: string
  contract_representative: string
  contract_email: string
  contract_phone: string
  partner_service_implantacao: boolean
  partner_service_implantacao_value: string
  partner_service_bpo_compras: boolean
  partner_service_bpo_compras_value: string
  partner_service_consultoria: boolean
  partner_service_consultoria_value: string
  partner_service_bpo_financeiro: boolean
  partner_service_bpo_financeiro_value: string
  partner_service_other: boolean
  partner_service_other_name: string
  partner_service_other_value: string
  person_name: string
  person_role: string
  person_email: string
  person_phone: string
}

const money = (value?: number | null) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value || 0))

const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)

const formatDateTime = (value?: string | null) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '-'
const toLocalDate = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : ''
const toLocalTime = (value?: string | null) => value ? new Date(value).toTimeString().slice(0, 5) : ''
function activityDisplayStatus(activity: ActivityRow) {
  if (activity.status === 'done') return 'concluida'
  if (activity.status === 'cancelled') return 'cancelada'
  if (activity.due_at && new Date(activity.due_at).getTime() < Date.now()) return 'atrasada'
  return 'aberta'
}
function daysSince(value?: string | null) {
  if (!value) return 0
  const start = new Date(value).getTime()
  if (!Number.isFinite(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000))
}
function dayLabel(days: number) {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`
}

const statusLabel: Record<string, string> = { aberto: 'Aberto', ganho: 'Ganho', perdido: 'Perdido' }

function cn(...classes: Array<string | false | undefined | null>) { return classes.filter(Boolean).join(' ') }
function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message?: unknown }).message)
  return 'Erro inesperado. Tente novamente.'
}
function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tone || 'bg-slate-100 text-slate-600')}>{children}</span>
}
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded border border-slate-200 bg-white', className)}>{children}</section>
}

function Login() {
  const [email, setEmail] = useState(() => window.localStorage.getItem('vmarket-crm-email') || '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [rememberEmail, setRememberEmail] = useState(true)
  const [resetMode, setResetMode] = useState(false)
  const registrationUrl = 'https://bpo.vmarket.com.br/'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    if (rememberEmail) window.localStorage.setItem('vmarket-crm-email', email)
    else window.localStorage.removeItem('vmarket-crm-email')
    const res = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (res.error) setMessage(res.error.message)
    else setMessage('Login efetuado.')
  }

  async function sendPasswordReset(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    const res = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    setBusy(false)
    if (res.error) setMessage(res.error.message)
    else setMessage('Enviamos um e-mail com as instruções para alterar sua senha.')
  }

  if (resetMode) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <header className="fixed inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 md:px-8">
          <button type="button" onClick={() => setResetMode(false)} className="cursor-pointer border-0 bg-transparent p-0" aria-label="Voltar ao login">
            <img src="./brand/vmarket-logo-colorida.png" alt="VMarket" className="h-16 w-auto object-contain md:h-20" />
          </button>
        </header>

        <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-5 pb-10 pt-28 md:px-8">
          <section className="w-full border border-slate-200 bg-white px-8 py-12 shadow-sm md:px-16 md:py-14">
            <div className="mx-auto max-w-xl text-center">
              <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 md:text-4xl">Precisa de uma nova senha?</h1>
              <p className="mt-6 text-base leading-7 text-slate-500">Informe seu endereço de e-mail e enviaremos instruções sobre como alterar sua senha.</p>
            </div>

            {!supabaseConfigured && <p className="mx-auto mt-8 max-w-xl rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Supabase não configurado no ambiente.</p>}

            <form onSubmit={sendPasswordReset} className="mx-auto mt-10 max-w-xl space-y-8">
              <label className="relative block">
                <Mail size={20} className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  className="h-16 w-full border border-slate-200 bg-white pl-16 pr-12 text-xl outline-none transition placeholder:text-slate-400 focus:border-[#6b5cf6] focus:ring-1 focus:ring-[#6b5cf6]"
                  placeholder="Seu e-mail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
                <span className="absolute right-5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-[#159585] shadow-[6px_0_0_#159585,12px_0_0_#159585]" aria-hidden="true" />
              </label>
              <button disabled={busy} className="h-16 w-full rounded bg-[#685cf6] px-4 text-xl font-bold text-white transition hover:bg-[#5b50e8] disabled:opacity-60">{busy ? 'Enviando...' : 'Receber nova senha'}</button>
            </form>

            {message && <p className="mx-auto mt-8 max-w-xl rounded bg-slate-50 p-3 text-center text-sm text-slate-700 ring-1 ring-slate-100">{message}</p>}
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="fixed inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 md:px-8">
        <img src="./brand/vmarket-logo-colorida.png" alt="VMarket" className="h-16 w-auto object-contain md:h-20" />
        <div className="flex items-center gap-3 text-xs font-semibold text-slate-700 sm:gap-4 sm:text-sm">
          <span>Ainda não é um parceiro BPO da VMarket?</span>
          <a href={registrationUrl} className="rounded bg-[#ece8ff] px-4 py-2.5 font-bold text-[#30246f] transition hover:bg-[#ded7ff] sm:px-5 sm:py-3">Faça o seu cadastro</a>
        </div>
      </header>

      <div className="mx-auto flex min-h-screen max-w-7xl items-center justify-center px-5 pb-8 pt-28 md:px-8">
        <div className="grid w-full items-stretch gap-6 lg:grid-cols-2">
          <section className="flex min-h-[560px] items-center justify-center border border-slate-200 bg-white px-8 py-8 md:px-12">
            <div className="w-full max-w-md">
              <div className="text-center">
                <h1 className="text-2xl font-bold tracking-[-0.03em] text-slate-900">Login</h1>
                <p className="mt-3 text-sm text-slate-600">Faça login para continuar</p>
              </div>

              {!supabaseConfigured && <p className="mt-8 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Supabase não configurado no ambiente.</p>}

              <form onSubmit={submit} className="mt-8 space-y-6">
                <label className="relative block">
                  <Mail size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="h-12 w-full border border-slate-200 bg-white pl-12 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#6b5cf6] focus:ring-1 focus:ring-[#6b5cf6]" placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
                </label>
                <label className="relative block">
                  <LockKeyhole size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input className="h-12 w-full border border-slate-200 bg-white pl-12 pr-4 text-base outline-none transition placeholder:text-slate-400 focus:border-[#6b5cf6] focus:ring-1 focus:ring-[#6b5cf6]" placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
                <button disabled={busy} className="h-12 w-full rounded bg-[#685cf6] px-4 text-lg font-bold text-white transition hover:bg-[#5b50e8] disabled:opacity-60">{busy ? 'Aguarde...' : 'Login'}</button>
              </form>

              <label className="mt-8 flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-600">
                <input type="checkbox" checked={rememberEmail} onChange={(e) => setRememberEmail(e.target.checked)} className="h-5 w-5 accent-[#685cf6]" />
                <span>Lembrar-me neste navegador</span>
              </label>
              <button type="button" onClick={() => { setMessage(''); setResetMode(true) }} className="mx-auto mt-6 block w-max border-0 bg-transparent p-0 text-sm font-semibold text-slate-500 hover:text-[#685cf6]">Esqueceu sua senha?</button>

              {message && <p className="mt-6 rounded bg-slate-50 p-3 text-center text-sm text-slate-700 ring-1 ring-slate-100">{message}</p>}
            </div>
          </section>

          <section className="relative hidden min-h-[560px] overflow-hidden bg-[#211746] p-8 text-white lg:block">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#6f5cf6]/50 blur-2xl" />
            <div className="absolute -bottom-28 left-16 h-80 w-80 rounded-full bg-[#2cbf6d]/35 blur-2xl" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <h3 className="max-w-lg text-5xl font-black leading-[0.95] tracking-[-0.05em]">CRM gratuito pra você acelerar no programa de parceria BPO da VMarket</h3>
                <p className="mt-5 max-w-md text-base leading-7 text-white/70">Faça a gestão das suas vendas, receba leads gratuitos da VMarket e acompanhe o valor das suas comissões.</p>
              </div>

              <div className="relative mt-8 rounded-2xl bg-white/95 p-4 text-slate-900 shadow-2xl ring-1 ring-white/20">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Pipeline BPO</p>
                    <h4 className="text-lg font-black">Negócios ativos</h4>
                  </div>
                  <img src="./brand/vmarket-logo-colorida.png" alt="VMarket" className="h-8 w-auto object-contain" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {['Kanban', 'Lista Excel', 'Previsão'].map((item, index) => <div key={item} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className={cn('mb-3 h-1.5 rounded-full', index === 0 ? 'bg-[#6f5cf6]' : index === 1 ? 'bg-[#2cbf6d]' : 'bg-[#ff695f]')} />
                    <p className="text-xs font-bold text-slate-700">{item}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{index === 0 ? 'Funil' : index === 1 ? 'Tabela' : 'Datas'}</p>
                  </div>)}
                </div>
                <div className="mt-4 space-y-2">
                  {[
                    { label: 'Plataforma VMarket', value: '419' },
                    { label: 'Implantação', value: '845' },
                    { label: 'Compras BPO', value: '1820' },
                  ].map((item, index) => <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm">
                    <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span><span className="text-sm font-semibold">{item.label}</span></div>
                    <span className="text-xs font-bold text-slate-500">R$ {item.value}</span>
                  </div>)}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([])
  const [automationExecutions, setAutomationExecutions] = useState<AutomationRuleExecution[]>([])
  const [automationChanges, setAutomationChanges] = useState<AutomationRuleChange[]>([])
  const [dealLabels, setDealLabels] = useState<DealLabel[]>([])
  const [dealLabelAssignments, setDealLabelAssignments] = useState<DealLabelAssignment[]>([])
  const [customFields, setCustomFields] = useState<CustomField[]>([])
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValue[]>([])
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [crmUsers, setCrmUsers] = useState<CrmUser[]>([])
  const [crmCompanies, setCrmCompanies] = useState<CrmCompany[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [activeView, setActiveView] = useState<View>('pipeline')
  const [activePipeline, setActivePipeline] = useState('Pipeline de Vendas')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [pipelineView, setPipelineView] = useState<'kanban' | 'list' | 'forecast'>('kanban')
  const [savedDealFilters, setSavedDealFilters] = useState<SavedDealFilter[]>(() => loadSavedDealFilters())
  const [activeDealFilterId, setActiveDealFilterId] = useState('')
  const [activeOwnerFilterId, setActiveOwnerFilterId] = useState('')
  const [detailDealId, setDetailDealId] = useState(() => new URLSearchParams(window.location.search).get('deal') || '')
  const [newDeal, setNewDeal] = useState<NewDeal>(() => blankNewDeal())
  const pipelineNames = useMemo(() => {
    const names = stages.map((stage) => stage.pipeline_name).filter((name): name is string => Boolean(name))
    return [...new Set(names)]
  }, [stages])
  const visibleStages = useMemo(() => {
    const source = pipelineNames.length ? stages.filter((stage) => stage.pipeline_name === activePipeline) : stages
    return source.length ? source : stages
  }, [stages, pipelineNames, activePipeline])
  const salesStages = useMemo(() => stages.filter((stage) => stage.pipeline_name === 'Pipeline de Vendas'), [stages])
  const filterFields = useMemo(() => buildFilterFields(customFields), [customFields])
  const filterContext = useMemo(() => ({ stages, activities, customFields, customFieldValues }), [stages, activities, customFields, customFieldValues])
  const visibleDeals = useMemo(() => {
    const visibleStageIds = new Set(visibleStages.map((stage) => stage.id))
    const activeSavedFilter = savedDealFilters.find((filter) => filter.id === activeDealFilterId)
    const canShowLostDeals = filterIncludesDealStatus(activeSavedFilter)
    const pipelineDeals = visibleStageIds.size ? deals.filter((deal) => deal.stage_id && visibleStageIds.has(deal.stage_id)) : deals
    const openPipelineDeals = canShowLostDeals ? pipelineDeals : pipelineDeals.filter((deal) => deal.status !== 'perdido')
    const ownerDeals = activeOwnerFilterId ? openPipelineDeals.filter((deal) => deal.owner_id === activeOwnerFilterId) : openPipelineDeals
    return filterDealsBySavedFilter(ownerDeals, activeSavedFilter, filterFields, filterContext)
  }, [deals, visibleStages, activeOwnerFilterId, savedDealFilters, activeDealFilterId, filterFields, filterContext])

  const detailDeal = useMemo(() => deals.find((d) => d.id === detailDealId), [deals, detailDealId])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) setLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) void loadAll()
  }, [session])

  useEffect(() => {
    const syncDealFromUrl = () => setDetailDealId(new URLSearchParams(window.location.search).get('deal') || '')
    window.addEventListener('popstate', syncDealFromUrl)
    return () => window.removeEventListener('popstate', syncDealFromUrl)
  }, [])

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [profileRes, stagesRes, crmUsersRes, crmCompaniesRes, orgRes, peopleRes, dealsRes, actsRes, histRes, auditRes, automationRulesRes, automationExecutionsRes, automationChangesRes, labelRes, labelAssignRes, fieldsRes, valuesRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session!.user.id).maybeSingle(),
        supabase.from('pipeline_stages').select('*').order('sort_order'),
        supabase.from('crm_users').select('*, crm_companies(*)').order('full_name'),
        supabase.from('crm_companies').select('*').order('name'),
        supabase.from('organizations').select('*').order('created_at', { ascending: false }),
        supabase.from('people').select('*').order('created_at', { ascending: false }),
        supabase.from('deals').select('*, organizations(*), people(*), bpo_partners(*), pipeline_stages(*)').order('created_at', { ascending: false }),
        supabase.from('activities').select('*').order('due_at', { ascending: true }),
        supabase.from('deal_history').select('*').order('created_at', { ascending: false }),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('automation_rules').select('*').order('name'),
        supabase.from('automation_rule_executions').select('*').order('started_at', { ascending: false }).limit(1000),
        supabase.from('automation_rule_changes').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('deal_labels').select('*').order('name'),
        supabase.from('deal_label_assignments').select('*, deal_labels(*)'),
        supabase.from('custom_fields').select('*').order('sort_order'),
        supabase.from('custom_field_values').select('*'),
      ])
      const firstError = [profileRes, stagesRes, crmUsersRes, crmCompaniesRes, orgRes, peopleRes, dealsRes, actsRes, histRes, auditRes, automationRulesRes, automationExecutionsRes, automationChangesRes, labelRes, labelAssignRes, fieldsRes, valuesRes].find((r) => r.error)?.error
      if (firstError) throw firstError
      setProfile(profileRes.data as Profile | null)
      setStages((stagesRes.data || []) as Stage[])
      const loadedStages = (stagesRes.data || []) as Stage[]
      const loadedPipelineNames = [...new Set(loadedStages.map((stage) => stage.pipeline_name).filter((name): name is string => Boolean(name)))]
      if (loadedPipelineNames.length && !loadedPipelineNames.includes(activePipeline)) setActivePipeline(loadedPipelineNames[0])
      setCrmUsers((crmUsersRes.data || []) as CrmUser[])
      setCrmCompanies((crmCompaniesRes.data || []) as CrmCompany[])
      setOrganizations((orgRes.data || []) as Organization[])
      setPeople((peopleRes.data || []) as Person[])
      setDeals((dealsRes.data || []) as Deal[])
      setActivities((actsRes.data || []) as ActivityRow[])
      setHistory((histRes.data || []) as HistoryRow[])
      setAuditLogs((auditRes.data || []) as AuditLog[])
      setAutomationRules((automationRulesRes.data || []) as AutomationRule[])
      setAutomationExecutions((automationExecutionsRes.data || []) as AutomationRuleExecution[])
      setAutomationChanges((automationChangesRes.data || []) as AutomationRuleChange[])
      setDealLabels((labelRes.data || []) as DealLabel[])
      setDealLabelAssignments((labelAssignRes.data || []) as DealLabelAssignment[])
      setCustomFields((fieldsRes.data || []) as CustomField[])
      setCustomFieldValues((valuesRes.data || []) as CustomFieldValue[])
      if (!selectedId && dealsRes.data?.[0]) setSelectedId(dealsRes.data[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function createDeal(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError('')
    const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)
    try {
      const ownerId = newDeal.owner_id || session?.user.id || null
      let orgId: string | null = null
      let personId: string | null = null

      if (newDeal.organization_name.trim()) {
        const { data: org, error: orgErr } = await supabase.from('organizations').insert({
          name: newDeal.organization_name.trim(),
          monthly_purchase: numberOrNull(newDeal.monthly_purchase),
          bpo_id: null,
          owner_id: ownerId,
        }).select('*').single()
        if (orgErr) throw orgErr
        orgId = org.id
      }

      if (newDeal.contact_name.trim()) {
        const { data: person, error: personErr } = await supabase.from('people').insert({
          full_name: newDeal.contact_name.trim(),
          email: newDeal.contact_email || null,
          phone: newDeal.contact_phone || null,
          organization_id: orgId,
          labels: [],
          bpo_id: null,
          owner_id: ownerId,
        }).select('*').single()
        if (personErr) throw personErr
        personId = person.id
      }

      const { data: deal, error: dealErr } = await supabase.from('deals').insert({
        title: newDeal.title.trim(),
        organization_id: orgId,
        person_id: personId,
        stage_id: newDeal.stage_id || null,
        bpo_id: null,
        owner_id: ownerId,
        value: numberOrNull(newDeal.value),
        monthly_purchase: numberOrNull(newDeal.monthly_purchase),
        estimated_savings: null,
        probability: null,
        status: 'aberto',
        lead_source: 'parceiro',
        source: 'Parceiro',
        expected_close_date: null,
        score: null,
        focus_items: [],
      }).select('*').single()
      if (dealErr) throw dealErr

      await supabase.from('deal_history').insert({ deal_id: deal.id, event_type: 'Sistema', title: 'Negócio criado', description: 'Criado manualmente no CRM BPO sem preenchimentos automáticos.' })
      setNewDeal(blankNewDeal())
      await loadAll()
      setSelectedId(deal.id)
      openDealPage(deal.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setCreating(false)
    }
  }

  function isSalesPipelineStage(stageId: string) {
    return stages.find((stage) => stage.id === stageId)?.pipeline_name === 'Pipeline de Vendas'
  }

  async function syncExistingDealToPipedriveIfSalesPipeline(dealId: string, stageId: string, mode: 'deal' | 'stage' = 'deal') {
    if (!isSalesPipelineStage(stageId)) return { ok: true, ignored: true }
    const action = mode === 'stage' ? 'sync-existing-deal-stage-to-pipedrive' : 'sync-existing-deal-to-pipedrive'
    const syncRes = await supabase.functions.invoke('pipedrive-sync', { body: { action, deal_id: dealId } })
    if (syncRes.error) {
      console.warn('Pipedrive sync unavailable', syncRes.error)
      return { ok: false, ignored: true, reason: errorMessage(syncRes.error) }
    }
    if (syncRes.data?.error) {
      console.warn('Pipedrive sync returned error', syncRes.data.error)
      return { ok: false, ignored: true, reason: String(syncRes.data.error) }
    }
    if (syncRes.data?.ignored) return syncRes.data
    await supabase.from('deal_history').insert({
      deal_id: dealId,
      event_type: 'Integração',
      title: mode === 'stage' ? 'Etapa sincronizada com Pipedrive' : 'Campos sincronizados com Pipedrive',
      description: `Pipeline de Vendas sincronizado. Pipedrive deal ID ${syncRes.data?.pipedrive_deal_id || 'existente'}`,
    })
    return syncRes.data || { ok: true }
  }

  async function moveDeal(stageId: string, dealId = selectedId) {
    if (!dealId) return
    const deal = deals.find((d) => d.id === dealId)
    if (deal?.stage_id === stageId) return
    const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', dealId)
    if (error) setError(error.message)
    else {
      try {
        await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Campo', title: 'Etapa do pipeline alterada', description: `Nova etapa: ${stages.find((s) => s.id === stageId)?.name || ''}` })
        void syncExistingDealToPipedriveIfSalesPipeline(dealId, stageId, 'stage')
        await loadAll()
        setSelectedId(dealId)
      } catch (e) {
        setError(errorMessage(e))
      }
    }
  }

  async function completeActivity(id: string) {
    const { error } = await supabase.from('activities').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id)
    if (error) setError(error.message)
    else await loadAll()
  }

  async function updateActivity(activityId: string, draft: ActivityEditDraft) {
    const title = draft.title.trim()
    if (!title) throw new Error('Informe o título da atividade.')
    const dueAt = draft.due_date ? new Date(`${draft.due_date}T${draft.due_time || '09:00'}`).toISOString() : null
    const activity = activities.find((item) => item.id === activityId)
    const becameDone = draft.status === 'done' && activity?.status !== 'done'
    const { error: activityErr } = await supabase.from('activities').update({
      title,
      activity_type: draft.activity_type,
      due_at: dueAt,
      status: draft.status,
      note: draft.note.trim() || null,
      completed_at: draft.status === 'done' ? (activity?.completed_at || new Date().toISOString()) : null,
    }).eq('id', activityId)
    if (activityErr) {
      setError(errorMessage(activityErr))
      throw activityErr
    }
    if (activity?.deal_id) {
      await supabase.from('deal_history').insert({
        deal_id: activity.deal_id,
        event_type: 'Atividade',
        title: becameDone ? 'Atividade concluída' : 'Atividade editada',
        description: title,
      })
    }
    await loadAll()
  }

  async function createActivityForDeal(activity: NewActivity) {
    if (!detailDeal) return
    setError('')
    const dueAt = activity.due_date ? new Date(`${activity.due_date}T${activity.due_time || '09:00'}`).toISOString() : null
    const title = activity.title.trim()
    if (!title) throw new Error('Informe o título da atividade.')
    try {
      const { error: activityErr } = await supabase.from('activities').insert({
        title,
        activity_type: activity.activity_type,
        due_at: dueAt,
        status: 'open',
        note: activity.note.trim() || null,
        deal_id: detailDeal.id,
        organization_id: detailDeal.organization_id,
        person_id: detailDeal.person_id,
        owner_id: detailDeal.owner_id || session?.user.id || null,
        bpo_id: detailDeal.bpo_id,
      })
      if (activityErr) throw activityErr
      await supabase.from('deal_history').insert({
        deal_id: detailDeal.id,
        event_type: 'Atividade',
        title: 'Atividade criada',
        description: title,
      })
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  async function createNoteForDeal(note: string) {
    if (!detailDeal) return
    const text = note.trim()
    if (!text) throw new Error('Escreva uma anotação.')
    setError('')
    try {
      const { error: noteErr } = await supabase.from('deal_history').insert({
        deal_id: detailDeal.id,
        event_type: 'Anotação',
        title: 'Anotação adicionada',
        description: text,
      })
      if (noteErr) throw noteErr
      await loadAll()
    } catch (e) {
      setError(errorMessage(e))
      throw e
    }
  }

  async function createDealLabel(name: string, color: string) {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Informe o nome da etiqueta.')
    setError('')
    const { data, error } = await supabase.from('deal_labels').insert({ name: cleanName, color, created_by: session?.user.id || null }).select('*').single()
    if (error) {
      setError(errorMessage(error))
      throw error
    }
    await loadAll()
    return data as DealLabel
  }

  async function deleteDealLabel(label: DealLabel) {
    const confirmed = window.confirm(`Apagar etiqueta ${label.name}? Ela será removida de todos os negócios.`)
    if (!confirmed) return
    setError('')
    const { error } = await supabase.from('deal_labels').delete().eq('id', label.id)
    if (error) {
      setError(errorMessage(error))
      throw error
    }
    await loadAll()
  }

  async function updateDealLabels(dealId: string, labelIds: string[]) {
    setError('')
    try {
      const { error: deleteErr } = await supabase.from('deal_label_assignments').delete().eq('deal_id', dealId)
      if (deleteErr) throw deleteErr
      const rows = [...new Set(labelIds)].map((labelId) => ({ deal_id: dealId, label_id: labelId, created_by: session?.user.id || null }))
      if (rows.length) {
        const { error: insertErr } = await supabase.from('deal_label_assignments').insert(rows)
        if (insertErr) throw insertErr
      }
      await loadAll()
    } catch (e) {
      setError(errorMessage(e))
      throw e
    }
  }

  async function deleteOneRecord(target: DeleteTarget, id: string, label: string) {
    if (profile?.role !== 'admin_vmarket') return
    const confirmed = window.confirm(`Apagar ${label}? Essa ação não pode ser desfeita.`)
    if (!confirmed) return
    setError('')
    try {
      const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'delete-one', target, id } })
      if (error) throw error
      if (data?.error) throw new Error(String(data.error))
      if (target === 'deal' && detailDealId === id) closeDealPage()
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handleDrop(e: DragEvent, stageId: string) {
    e.preventDefault()
    const droppedDealId = e.dataTransfer.getData('text/plain') || draggingId
    if (droppedDealId) void moveDeal(stageId, droppedDealId)
    setDraggingId(null)
  }

  function openDealPage(id: string) {
    setSelectedId(id)
    setDetailDealId(id)
    const nextUrl = `${window.location.pathname}?deal=${encodeURIComponent(id)}`
    window.history.pushState({}, '', nextUrl)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function closeDealPage() {
    setDetailDealId('')
    window.history.pushState({}, '', window.location.pathname)
  }

  function persistDealFilters(next: SavedDealFilter[]) {
    setSavedDealFilters(next)
    saveDealFilters(next)
  }

  function saveDealFilter(draft: FilterDraft) {
    const rules = draft.rules.filter((rule) => rule.fieldId || rule.operator === 'is_empty' || rule.operator === 'is_not_empty')
    const saved: SavedDealFilter = {
      id: draft.id || `filter-${Date.now()}`,
      name: draft.name.trim() || 'Filtro sem nome',
      favorite: draft.favorite,
      visibility: 'private',
      rules,
      createdAt: new Date().toISOString(),
    }
    const next = savedDealFilters.some((filter) => filter.id === saved.id)
      ? savedDealFilters.map((filter) => filter.id === saved.id ? saved : filter)
      : [...savedDealFilters, saved]
    persistDealFilters(next)
    setActiveDealFilterId(saved.id)
    setActiveOwnerFilterId('')
  }

  function deleteDealFilter(id: string) {
    const next = savedDealFilters.filter((filter) => filter.id !== id)
    persistDealFilters(next)
    if (activeDealFilterId === id) setActiveDealFilterId('')
  }

  async function saveDeal(form: DealForm, customValues: Record<string, string>) {
    if (!detailDeal) return
    setError('')
    const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)
    const canManageCustomFields = profile?.role === 'admin_vmarket'
    const contractPartner = crmUsers.find((user) => user.auth_user_id && user.auth_user_id === form.owner_id) || crmUsers.find((user) => user.auth_user_id && user.auth_user_id === detailDeal.owner_id)
    const partnerContract = form.contract_with === 'parceiro' ? partnerContractValues(contractPartner) : null
    const contractSource = partnerContract ? {
      legal: partnerContract.legal,
      tax: partnerContract.tax,
      address: partnerContract.address,
      representative: partnerContract.representative,
      email: partnerContract.email,
      phone: partnerContract.phone,
    } : {
      legal: form.contract_legal_name,
      tax: form.contract_tax_id,
      address: form.contract_address,
      representative: form.contract_representative,
      email: form.contract_email,
      phone: form.contract_phone,
    }
    if (form.partner_service_other && !form.partner_service_other_name.trim()) {
      const message = 'Informe qual é o outro serviço parceiro.'
      setError(message)
      throw new Error(message)
    }
    const dealFields = canManageCustomFields ? customFields.filter((field) => field.entity === 'deal') : []
    const parseCustomValue = (field: CustomField, raw: string) => {
      if (field.field_type === 'numeric' || field.field_type === 'monetary' || field.field_type === 'formula') return raw.trim() === '' ? null : Number(raw)
      if (field.field_type === 'multi_option') return raw.split(',').map((item) => item.trim()).filter(Boolean)
      return raw
    }
    try {
      const { error: dealErr } = await supabase.from('deals').update({
        title: form.title,
        stage_id: form.stage_id || null,
        owner_id: form.owner_id || session?.user.id || null,
        status: form.status as Deal['status'],
        lost_reason: form.status === 'perdido' ? (form.lost_reason.trim() || null) : null,
        vm_sale: form.vm_sale,
        contract_with: form.vm_sale ? (form.contract_with || 'cliente') : null,
        vm_product_type: form.vm_sale ? (form.vm_product_type || null) : null,
        vm_cnpj_count: form.vm_sale ? numberOrNull(form.vm_cnpj_count) : null,
        vm_plan: form.vm_sale ? (form.vm_plan || null) : null,
        vm_value_per_cnpj: form.vm_sale ? numberOrNull(form.vm_value_per_cnpj) : null,
        contract_legal_name: form.vm_sale ? (contractSource.legal || null) : null,
        contract_tax_id: form.vm_sale ? (contractSource.tax || null) : null,
        contract_address: form.vm_sale ? (contractSource.address || null) : null,
        contract_representative: form.vm_sale ? (contractSource.representative || null) : null,
        contract_email: form.vm_sale ? (contractSource.email || null) : null,
        contract_phone: form.vm_sale ? (contractSource.phone || null) : null,
        partner_services: partnerServicesFromForm(form),
        value: numberOrNull(form.value),
        monthly_purchase: numberOrNull(form.monthly_purchase),
        source: form.source || null,
        expected_close_date: form.expected_close_date || null,
        focus_items: form.focus_items.split('\n').map((item) => item.trim()).filter(Boolean),
      }).eq('id', detailDeal.id)
      if (dealErr) throw dealErr

      if (detailDeal.organization_id) {
        const { error: orgErr } = await supabase.from('organizations').update({
          name: form.organization_name,
          segment: form.organization_segment || null,
          city: form.organization_city || null,
          state: form.organization_state || null,
          cnpjs: numberOrNull(form.organization_cnpjs),
          monthly_purchase: numberOrNull(form.monthly_purchase),
          owner_id: form.owner_id || session?.user.id || null,
        }).eq('id', detailDeal.organization_id)
        if (orgErr) throw orgErr
      }

      if (detailDeal.person_id) {
        const { error: personErr } = await supabase.from('people').update({
          full_name: form.person_name,
          role_title: form.person_role || null,
          email: form.person_email || null,
          phone: form.person_phone || null,
          owner_id: form.owner_id || session?.user.id || null,
        }).eq('id', detailDeal.person_id)
        if (personErr) throw personErr
      }

      if (dealFields.length) {
        const rows = dealFields.map((field) => ({
          field_id: field.id,
          entity_id: detailDeal.id,
          value: parseCustomValue(field, customValues[field.id] || ''),
        }))
        const { error: customErr } = await supabase.from('custom_field_values').upsert(rows, { onConflict: 'field_id,entity_id' })
        if (customErr) throw customErr
      }

      if (form.stage_id) void syncExistingDealToPipedriveIfSalesPipeline(detailDeal.id, form.stage_id)

      await supabase.from('deal_history').insert({ deal_id: detailDeal.id, event_type: 'Edição', title: 'Ficha do negócio atualizada', description: 'Campos editados na URL da ficha completa.' })
      await loadAll()
    } catch (e) {
      setError(errorMessage(e))
      throw e
    }
  }

  if (!session) return <Login />

  if (detailDealId) {
    const isAdmin = profile?.role === 'admin_vmarket'
    return <DealPage key={detailDealId} deal={detailDeal} loading={loading} error={error} stages={stages} crmUsers={crmUsers} canEditOwner={isAdmin} canViewCustomFields={isAdmin} activities={activities.filter((a) => a.deal_id === detailDealId)} history={history.filter((h) => h.deal_id === detailDealId)} dealLabels={dealLabels} assignedLabels={dealLabelAssignments.filter((assignment) => assignment.deal_id === detailDealId)} closeDealPage={closeDealPage} saveDeal={saveDeal} createActivity={createActivityForDeal} createNote={createNoteForDeal} deleteDeal={(id, label) => deleteOneRecord('deal', id, label)} deleteActivity={(id, label) => deleteOneRecord('activity', id, label)} customFields={isAdmin ? customFields.filter((field) => field.entity === 'deal') : []} customFieldValues={isAdmin ? customFieldValues.filter((value) => value.entity_id === detailDealId) : []} completeActivity={completeActivity} updateActivity={updateActivity} createLabel={createDealLabel} deleteLabel={deleteDealLabel} updateDealLabels={updateDealLabels} />
  }

  const navItems: Array<[View, ReactNode, string]> = [
    ['pipeline', <LayoutDashboard size={19}/>, 'Negócios'],
    ['contacts', <Contact size={19}/>, 'Contatos'],
    ['companies', <Building2 size={19}/>, 'Empresas'],
    ['activities', <Activity size={19}/>, 'Atividades'],
  ]
  if (profile?.role === 'admin_vmarket') navItems.push(['automations', <Settings size={19}/>, 'Automações'])
  if (profile?.role === 'admin_vmarket') navItems.push(['audit', <ClipboardList size={19}/>, 'Log de Alterações'])
  if (profile?.role === 'admin_vmarket') {
    navItems.push(['fields', <Tags size={19}/>, 'Campos'])
    navItems.push(['admin', <Settings size={19}/>, 'Admin'])
  }

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-slate-900">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="fixed inset-x-0 bottom-0 z-40 flex h-16 shrink-0 flex-row items-center justify-around gap-1 bg-[#211746] px-2 py-2 text-white shadow-[0_-10px_30px_rgba(15,23,42,0.25)] md:relative md:inset-auto md:h-auto md:w-14 md:flex-col md:justify-start md:gap-2 md:px-0 md:py-3 md:shadow-none">
          <div className="hidden h-10 w-10 place-items-center rounded-xl bg-white text-[13px] font-black tracking-[-0.08em] text-[#211746] shadow-sm md:mb-3 md:grid">VM</div>
          {navItems.map(([key, icon, label]) => <button key={key} onClick={() => setActiveView(key)} title={label} aria-label={label} className={cn('grid h-12 min-w-12 place-items-center rounded-xl transition md:h-10 md:w-10 md:min-w-0', activeView === key ? 'bg-[#6f5cf6] text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')}>{icon}<span className="sr-only">{label}</span></button>)}
          <button onClick={() => supabase.auth.signOut()} title="Sair" aria-label="Sair" className="grid h-12 min-w-12 place-items-center rounded-xl text-white/70 hover:bg-white/10 hover:text-white md:mt-auto md:h-10 md:w-10 md:min-w-0"><LogOut size={18}/></button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
          <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 md:h-14 md:flex-nowrap md:px-5 md:py-0">
            <h1 className="min-w-[155px] text-base font-semibold">{navItems.find(([key]) => key === activeView)?.[2]}</h1>
            <div className="mx-auto hidden w-full max-w-xl items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-400 shadow-inner md:flex"><Search size={17}/>Search VMarket</div>
            <button onClick={loadAll} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><RefreshCw size={17}/></button>
            <div className="hidden items-center gap-2 sm:flex"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{profile?.full_name?.slice(0,1) || 'V'}</span><span className="text-xs font-semibold leading-tight text-slate-700">VMarket<br/><span className="font-normal text-slate-500">BPO CRM</span></span></div>
            <button onClick={() => supabase.auth.signOut()} className="hidden rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:block">Sair</button>
          </header>

          <section className="min-h-0 flex-1 overflow-auto md:overflow-hidden">
            {error && <div className="m-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><b>Erro:</b> {error}</div>}
            {loading ? <LoadingBpo /> : (
              <>
                {activeView === 'pipeline' && <PipelineView stages={visibleStages} salesStages={salesStages} deals={visibleDeals} allDeals={deals} activities={activities} crmUsers={crmUsers} dealLabelAssignments={dealLabelAssignments} selectedId={selectedId} setSelectedId={setSelectedId} openDealPage={openDealPage} setDraggingId={setDraggingId} handleDrop={handleDrop} newDeal={newDeal} setNewDeal={setNewDeal} createDeal={createDeal} creating={creating} canAssignOwner={profile?.role === 'admin_vmarket'} activePipeline={activePipeline} setActivePipeline={setActivePipeline} pipelineNames={pipelineNames} pipelineView={pipelineView} setPipelineView={setPipelineView} savedDealFilters={savedDealFilters} activeDealFilterId={activeDealFilterId} setActiveDealFilterId={setActiveDealFilterId} activeOwnerFilterId={activeOwnerFilterId} setActiveOwnerFilterId={setActiveOwnerFilterId} filterFields={filterFields} filterContext={filterContext} saveDealFilter={saveDealFilter} deleteDealFilter={deleteDealFilter} />}
                {activeView === 'contacts' && <ListView title="Contatos" icon={<Contact size={18}/>} rows={people.map((p) => ({ id: p.id, title: p.full_name, sub: `${p.role_title || 'Contato'} · ${p.email || 'sem email'}`, meta: p.phone || 'sem telefone' }))} canDelete={profile?.role === 'admin_vmarket'} onDelete={(id, label) => deleteOneRecord('person', id, label)} />}
                {activeView === 'companies' && <ListView title="Empresas" icon={<Building2 size={18}/>} rows={organizations.map((o) => ({ id: o.id, title: o.name, sub: `${o.segment || 'Segmento não informado'} · ${o.city || ''} ${o.state || ''}`, meta: money(o.monthly_purchase) }))} canDelete={profile?.role === 'admin_vmarket'} onDelete={(id, label) => deleteOneRecord('organization', id, label)} />}
                {activeView === 'activities' && <ActivitiesView activities={activities} deals={deals} completeActivity={completeActivity} updateActivity={updateActivity} canDelete={profile?.role === 'admin_vmarket'} deleteActivity={(id, label) => deleteOneRecord('activity', id, label)} />}
                {activeView === 'automations' && profile?.role === 'admin_vmarket' && <AutomationsView rules={automationRules} executions={automationExecutions} changes={automationChanges} />}
                {activeView === 'audit' && profile?.role === 'admin_vmarket' && <AuditLogView logs={auditLogs} />}
                {activeView === 'fields' && profile?.role === 'admin_vmarket' && <FieldsConfigView fields={customFields} setError={setError} reload={loadAll} />}
                {activeView === 'admin' && profile?.role === 'admin_vmarket' && <AdminUsersView users={crmUsers} companies={crmCompanies} dealsCount={deals.length} activitiesCount={activities.length} peopleCount={people.length} organizationsCount={organizations.length} reload={loadAll} setError={setError} />}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function PipelineView({ stages, salesStages, deals, allDeals, activities, crmUsers, dealLabelAssignments, selectedId, setSelectedId, openDealPage, setDraggingId, handleDrop, newDeal, setNewDeal, createDeal, creating, canAssignOwner, activePipeline, setActivePipeline, pipelineNames, pipelineView, setPipelineView, savedDealFilters, activeDealFilterId, setActiveDealFilterId, activeOwnerFilterId, setActiveOwnerFilterId, filterFields, filterContext, saveDealFilter, deleteDealFilter }: {
  stages: Stage[]
  salesStages: Stage[]
  deals: Deal[]
  allDeals: Deal[]
  activities: ActivityRow[]
  crmUsers: CrmUser[]
  dealLabelAssignments: DealLabelAssignment[]
  selectedId?: string
  setSelectedId: (id: string) => void
  openDealPage: (id: string) => void
  setDraggingId: (id: string | null) => void
  handleDrop: (e: DragEvent, stageId: string) => void
  newDeal: NewDeal
  setNewDeal: (deal: NewDeal) => void
  createDeal: (e: FormEvent) => Promise<void>
  creating: boolean
  canAssignOwner: boolean
  activePipeline: string
  setActivePipeline: (pipeline: string) => void
  pipelineNames: string[]
  pipelineView: 'kanban' | 'list' | 'forecast'
  setPipelineView: (view: 'kanban' | 'list' | 'forecast') => void
  savedDealFilters: SavedDealFilter[]
  activeDealFilterId: string
  setActiveDealFilterId: (id: string) => void
  activeOwnerFilterId: string
  setActiveOwnerFilterId: (id: string) => void
  filterFields: FilterField[]
  filterContext: FilterContext
  saveDealFilter: (draft: FilterDraft) => void
  deleteDealFilter: (id: string) => void
}) {
  const [showCreateDeal, setShowCreateDeal] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [editingFilter, setEditingFilter] = useState<FilterDraft | null>(null)
  const activeFilter = savedDealFilters.find((filter) => filter.id === activeDealFilterId)
  const activeOwner = crmUsers.find((user) => user.auth_user_id === activeOwnerFilterId)
  const filterButtonLabel = activeFilter?.name || activeOwner?.full_name || 'Filtro'
  const submitCreateDeal = async (e: FormEvent) => {
    await createDeal(e)
    setShowCreateDeal(false)
  }

  const dealOwnerInitial = (deal: Deal) => {
    const owner = crmUsers.find((user) => user.auth_user_id && user.auth_user_id === deal.owner_id)
    return (owner?.full_name || deal.people?.full_name || '•').trim().slice(0, 1).toUpperCase()
  }

  const dealOwnerName = (deal: Deal) => {
    const owner = crmUsers.find((user) => user.auth_user_id && user.auth_user_id === deal.owner_id)
    return owner?.full_name || deal.people?.full_name || 'Sem proprietário'
  }

  const activityIndicator = (deal: Deal) => {
    const openActivities = activities
      .filter((activity) => activity.deal_id === deal.id && activity.status === 'open')
      .sort((a, b) => new Date(a.due_at || '9999-12-31').getTime() - new Date(b.due_at || '9999-12-31').getTime())
    if (!openActivities.length) return { label: '⚠', className: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300', title: 'Sem atividade planejada' }
    const next = openActivities[0]
    if (!next.due_at) return { label: '', className: 'bg-white ring-1 ring-slate-300', title: 'Atividade planejada sem data' }
    const due = new Date(next.due_at)
    const today = new Date()
    const dueDay = due.toISOString().slice(0, 10)
    const todayDay = today.toISOString().slice(0, 10)
    if (dueDay === todayDay) return { label: '', className: 'bg-emerald-500 ring-1 ring-emerald-600', title: 'Atividade para hoje' }
    if (due.getTime() < new Date(`${todayDay}T00:00:00`).getTime()) return { label: '', className: 'bg-rose-500 ring-1 ring-rose-600', title: 'Atividade atrasada' }
    return { label: '', className: 'bg-white ring-1 ring-slate-300', title: 'Atividade planejada' }
  }

  const labelsForDeal = (dealId: string) => dealLabelAssignments
    .filter((assignment) => assignment.deal_id === dealId && assignment.deal_labels)
    .map((assignment) => assignment.deal_labels as DealLabel)

  return <div className="flex min-h-[calc(100vh-7.5rem)] flex-col md:h-full md:min-h-0">
    <div className="border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 md:h-12 md:flex-nowrap md:px-4 md:py-0">
        <div className="flex overflow-hidden rounded border border-slate-300">
          <button onClick={() => setPipelineView('kanban')} className={cn('grid h-11 w-12 place-items-center md:h-8 md:w-9', pipelineView === 'kanban' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Kanban" aria-label="Kanban"><GripVertical size={15}/></button>
          <button onClick={() => setPipelineView('list')} className={cn('grid h-11 w-12 place-items-center border-l border-slate-300 md:h-8 md:w-9', pipelineView === 'list' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Lista" aria-label="Lista"><List size={15}/></button>
          <button onClick={() => setPipelineView('forecast')} className={cn('grid h-11 w-12 place-items-center border-l border-slate-300 md:h-8 md:w-9', pipelineView === 'forecast' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Previsão" aria-label="Previsão"><CalendarClock size={15}/></button>
        </div>
        <button onClick={() => setShowCreateDeal(true)} className="h-11 rounded border border-[#087d3e] bg-[#238847] px-4 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] md:h-auto md:py-1.5">+ Negócio</button>
        <div className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-600 md:ml-auto md:w-auto md:flex-nowrap">
          <span><b>{deals.length}</b> negócios</span>
          <span className="hidden text-slate-300 md:inline">|</span>
          <select value={activePipeline} onChange={(e) => setActivePipeline(e.target.value)} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 outline-none">
            {(pipelineNames.length ? pipelineNames : ['Pipeline de Vendas']).map((name) => <option key={name}>{name}</option>)}
          </select>
          <div className="relative">
            <button type="button" onClick={() => setShowFilters((current) => !current)} className={cn('inline-flex items-center gap-2 rounded border px-3 py-1.5 text-sm font-semibold shadow-sm', activeDealFilterId || activeOwnerFilterId ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              <Filter size={15}/>
              {filterButtonLabel}
            </button>
            {showFilters && <DealFilterDropdown
              filters={savedDealFilters}
              activeFilterId={activeDealFilterId}
              activeOwnerId={activeOwnerFilterId}
              users={crmUsers}
              onSelectFilter={(id) => { setActiveDealFilterId(id); setActiveOwnerFilterId(''); setShowFilters(false) }}
              onSelectOwner={(id) => { setActiveOwnerFilterId(id); setActiveDealFilterId(''); setShowFilters(false) }}
              onClear={() => { setActiveDealFilterId(''); setActiveOwnerFilterId(''); setShowFilters(false) }}
              onCreate={() => { setEditingFilter(emptyFilterDraft()); setShowFilters(false) }}
              onEdit={(filter) => { setEditingFilter({ id: filter.id, name: filter.name, favorite: filter.favorite, rules: filter.rules.length ? filter.rules : [newFilterRule('all')] }); setShowFilters(false) }}
              onDelete={deleteDealFilter}
            />}
          </div>
        </div>
      </div>
    </div>

    {pipelineView === 'kanban' ? <div className="min-h-0 flex-1 overflow-x-auto overflow-y-visible p-3 md:overflow-y-hidden md:p-4">
      <div className="flex min-h-[420px] gap-3 md:h-full md:min-w-max">
        {stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage_id === stage.id)
          const stageValue = stageDeals.reduce((acc, d) => acc + Number(d.value || 0), 0)
          return <div key={stage.id} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }} onDrop={(e) => handleDrop(e, stage.id)} className="flex max-h-[65vh] min-w-[78vw] flex-col bg-[#f0f2f4] ring-1 ring-slate-200 sm:min-w-[320px] md:h-full md:w-[160px] md:min-w-0 xl:w-[180px]">
            <div className="border-b border-slate-200 bg-white/60 p-2">
              <div className="flex items-center justify-between gap-1">
                <p className="truncate text-sm font-bold text-slate-800">{stage.name}</p>
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-500">{money(stageValue)} · {stageDeals.length} negócios</p>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
              {stageDeals.map((deal) => {
                const indicator = activityIndicator(deal)
                const labels = labelsForDeal(deal.id)
                return <div key={deal.id} draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', deal.id); setDraggingId(deal.id) }} onDragEnd={() => setDraggingId(null)} onClick={() => openDealPage(deal.id)} role="button" tabIndex={0} className={cn('group relative w-full cursor-grab rounded border p-2 text-left shadow-sm transition hover:border-blue-200 hover:shadow-md active:cursor-grabbing', deal.status === 'ganho' ? 'bg-emerald-50 border-emerald-200' : deal.status === 'perdido' ? 'bg-slate-100' : 'bg-white', selectedId === deal.id ? 'border-blue-300 ring-2 ring-blue-200/70' : 'border-slate-200')}>
                  {deal.status === 'ganho' && <span className="absolute right-2 top-2 rounded-full bg-emerald-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-800">Ganho</span>}
                  {deal.status === 'perdido' && <span className="absolute right-2 top-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-600">Perdido</span>}
                  <DealLabelPills labels={labels} compact />
                  <p className="line-clamp-2 text-sm font-bold leading-snug text-slate-900">{deal.title}</p>
                  <p className="mt-1 truncate text-xs text-slate-600">{deal.organizations?.name || 'Sem empresa'}</p>
                  <p className="truncate text-xs text-slate-500">{deal.people?.full_name || 'Sem contato'}</p>
                  <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-700">{money(deal.value)}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span title={dealOwnerName(deal)} aria-label={`Proprietário: ${dealOwnerName(deal)}`} className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600">{dealOwnerInitial(deal)}</span>
                    <span title={indicator.title} className={cn('grid h-5 w-5 place-items-center rounded-full text-[11px] font-black', indicator.className)}>{indicator.label}</span>
                  </div>
                </div>
              })}
              {stageDeals.length === 0 && <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">Solte cards aqui</div>}
            </div>
          </div>
        })}
      </div>
    </div> : pipelineView === 'list' ? <ListViewDeals deals={deals} stages={stages} dealLabelAssignments={dealLabelAssignments} selectedId={selectedId} setSelectedId={setSelectedId} openDealPage={openDealPage} /> : <ForecastView deals={deals} stages={stages} selectedId={selectedId} setSelectedId={setSelectedId} openDealPage={openDealPage} />}

    {showCreateDeal && <CreateDealModal salesStages={salesStages} crmUsers={crmUsers} canAssignOwner={canAssignOwner} newDeal={newDeal} setNewDeal={setNewDeal} createDeal={submitCreateDeal} creating={creating} close={() => { setShowCreateDeal(false); setNewDeal(blankNewDeal()) }} />}
    {editingFilter && <DealFilterBuilderModal
      draft={editingFilter}
      setDraft={setEditingFilter}
      fields={filterFields}
      deals={allDeals}
      context={filterContext}
      onClose={() => setEditingFilter(null)}
      onSave={(draft) => { saveDealFilter(draft); setEditingFilter(null) }}
    />}
  </div>
}

function DealFilterDropdown({ filters, activeFilterId, activeOwnerId, users, onSelectFilter, onSelectOwner, onClear, onCreate, onEdit, onDelete }: {
  filters: SavedDealFilter[]
  activeFilterId: string
  activeOwnerId: string
  users: CrmUser[]
  onSelectFilter: (id: string) => void
  onSelectOwner: (id: string) => void
  onClear: () => void
  onCreate: () => void
  onEdit: (filter: SavedDealFilter) => void
  onDelete: (id: string) => void
}) {
  const [tab, setTab] = useState<'favorites' | 'owners' | 'filters'>('owners')
  const [query, setQuery] = useState('')
  const normalizedQuery = query.toLocaleLowerCase('pt-BR').trim()
  const visibleUsers = users.filter((user) => user.full_name.toLocaleLowerCase('pt-BR').includes(normalizedQuery) || (user.email || '').toLocaleLowerCase('pt-BR').includes(normalizedQuery))
  const favoriteFilters = filters.filter((filter) => filter.favorite)
  const visibleFilters = (tab === 'favorites' ? favoriteFilters : filters).filter((filter) => filter.name.toLocaleLowerCase('pt-BR').includes(normalizedQuery))

  return <div className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,370px)] overflow-hidden rounded border border-slate-200 bg-white text-slate-800 shadow-2xl">
    <div className="border-b border-slate-200 p-2">
      <div className="flex items-center gap-2 rounded border border-slate-300 px-2 py-1.5 text-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <Search size={16} className="text-slate-500"/>
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Pesquisar proprietário ou filtro" />
      </div>
      <div className="mt-2 grid grid-cols-3 text-xs font-semibold text-slate-500">
        <button type="button" onClick={() => setTab('favorites')} className={cn('grid gap-1 border-b-2 px-2 py-2', tab === 'favorites' ? 'border-blue-500 text-blue-600' : 'border-transparent hover:text-slate-800')}><Star size={17} className="mx-auto"/>Favoritos</button>
        <button type="button" onClick={() => setTab('owners')} className={cn('grid gap-1 border-b-2 px-2 py-2', tab === 'owners' ? 'border-blue-500 text-blue-600' : 'border-transparent hover:text-slate-800')}><User size={17} className="mx-auto"/>Proprietários</button>
        <button type="button" onClick={() => setTab('filters')} className={cn('grid gap-1 border-b-2 px-2 py-2', tab === 'filters' ? 'border-blue-500 text-blue-600' : 'border-transparent hover:text-slate-800')}><Filter size={17} className="mx-auto"/>Filtros</button>
      </div>
    </div>
    <div className="max-h-[430px] overflow-y-auto py-1">
      {tab === 'owners' && <>
        <button type="button" onClick={onClear} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-bold hover:bg-blue-50"><span>Todos</span>{!activeFilterId && !activeOwnerId && <span>✓</span>}</button>
        {visibleUsers.map((user) => <button type="button" key={user.id} onClick={() => user.auth_user_id ? onSelectOwner(user.auth_user_id) : undefined} disabled={!user.auth_user_id} className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-blue-50 disabled:opacity-45">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{user.full_name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1 truncate">{user.full_name}</span>
          {activeOwnerId === user.auth_user_id && <span>✓</span>}
        </button>)}
      </>}
      {(tab === 'favorites' || tab === 'filters') && <>
        {visibleFilters.map((filter) => <div key={filter.id} className="group flex items-center gap-2 px-3 py-2 hover:bg-blue-50">
          <button type="button" onClick={() => onSelectFilter(filter.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm">
            <span className={cn('text-lg', filter.favorite ? 'text-amber-400' : 'text-slate-300')}>★</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{filter.name}</span>
            {activeFilterId === filter.id && <span>✓</span>}
          </button>
          <button type="button" onClick={() => onEdit(filter)} className="rounded px-2 py-1 text-[11px] font-bold text-blue-600 opacity-0 hover:bg-blue-100 group-hover:opacity-100">Editar</button>
          <button type="button" onClick={() => onDelete(filter.id)} className="rounded px-2 py-1 text-[11px] font-bold text-rose-600 opacity-0 hover:bg-rose-100 group-hover:opacity-100">Apagar</button>
        </div>)}
        {!visibleFilters.length && <div className="px-4 py-8 text-center text-sm text-slate-400">Nenhum filtro salvo.</div>}
      </>}
    </div>
    <button type="button" onClick={onCreate} className="flex w-full items-center gap-3 border-t border-slate-200 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><span className="text-blue-600">+</span>Adicionar novo filtro</button>
  </div>
}

function DealFilterBuilderModal({ draft, setDraft, fields, deals, context, onClose, onSave }: {
  draft: FilterDraft
  setDraft: (draft: FilterDraft | null) => void
  fields: FilterField[]
  deals: Deal[]
  context: FilterContext
  onClose: () => void
  onSave: (draft: FilterDraft) => void
}) {
  const [fieldSearch, setFieldSearch] = useState('')
  const filteredFields = fields.filter((field) => {
    const query = fieldSearch.toLocaleLowerCase('pt-BR').trim()
    return !query || `${filterEntityLabel[field.entity]} ${field.label}`.toLocaleLowerCase('pt-BR').includes(query)
  })
  const updateRule = (id: string, patch: Partial<FilterRule>) => setDraft({ ...draft, rules: draft.rules.map((rule) => rule.id === id ? { ...rule, ...patch, fieldId: patch.entity && patch.entity !== rule.entity ? '' : (patch.fieldId ?? rule.fieldId) } : rule) })
  const removeRule = (id: string) => setDraft({ ...draft, rules: draft.rules.filter((rule) => rule.id !== id) })
  const addRule = (group: FilterGroup) => setDraft({ ...draft, rules: [...draft.rules, newFilterRule(group)] })
  const fieldsForEntity = (entity: FilterEntity) => filteredFields.filter((field) => field.entity === entity)
  const valuesForRule = (rule: FilterRule) => uniqueValues(deals.map((deal) => getFilterRawValue(deal, rule, fields, context)))
  const previewCount = filterDealsBySavedFilter(deals, { id: draft.id || 'preview', name: draft.name, favorite: draft.favorite, visibility: 'private', rules: draft.rules, createdAt: new Date().toISOString() }, fields, context).length
  const renderRules = (group: FilterGroup) => {
    const rules = draft.rules.filter((rule) => rule.group === group)
    return <div className="space-y-2">
      {rules.map((rule, index) => {
        const values = valuesForRule(rule)
        return <div key={rule.id} className="rounded-lg border border-slate-200 bg-white p-3">
          {index > 0 && <div className="mb-2 text-center text-[11px] font-black uppercase text-slate-400">{group === 'all' ? 'E' : 'OU'}</div>}
          <div className="grid gap-2 md:grid-cols-[140px_1fr_130px_1fr_38px]">
            <select value={rule.entity} onChange={(e) => updateRule(rule.id, { entity: e.target.value as FilterEntity })} className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none">
              {(Object.keys(filterEntityLabel) as FilterEntity[]).map((entity) => <option key={entity} value={entity}>{filterEntityLabel[entity]}</option>)}
            </select>
            <select value={rule.fieldId} onChange={(e) => updateRule(rule.id, { fieldId: e.target.value })} className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none">
              <option value="">Selecione o campo</option>
              {fieldsForEntity(rule.entity).map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
            </select>
            <select value={rule.operator} onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterOperator })} className="rounded border border-slate-300 bg-white px-2 py-2 text-sm outline-none">
              {(Object.keys(filterOperatorLabel) as FilterOperator[]).map((operator) => <option key={operator} value={operator}>{filterOperatorLabel[operator]}</option>)}
            </select>
            <input list={`values-${rule.id}`} value={rule.value} onChange={(e) => updateRule(rule.id, { value: e.target.value })} disabled={rule.operator === 'is_empty' || rule.operator === 'is_not_empty'} placeholder="Digite ou selecione o valor" className="rounded border border-slate-300 px-2 py-2 text-sm outline-none disabled:bg-slate-100" />
            <datalist id={`values-${rule.id}`}>{values.map((value) => <option key={value} value={value}/>)}</datalist>
            <button type="button" onClick={() => removeRule(rule.id)} className="rounded border border-slate-200 text-slate-400 hover:bg-rose-50 hover:text-rose-600">×</button>
          </div>
        </div>
      })}
      <button type="button" onClick={() => addRule(group)} className="text-sm font-semibold text-blue-600 hover:text-blue-700">+ Adicionar condição</button>
    </div>
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
    <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-xl font-bold text-slate-950">Criar novo filtro</h2>
          <p className="mt-1 text-sm text-slate-500">Filtre negócios usando campos de negócios, pessoas, empresas e atividades.</p>
        </div>
        <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50" type="button">×</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-4 flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
          <Search size={16} className="text-slate-500"/>
          <input value={fieldSearch} onChange={(e) => setFieldSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Digite o nome do campo para filtrar" />
        </div>
        <div className="rounded-xl bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">Atender a TODAS estas condições</h3>
          {renderRules('all')}
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-bold text-slate-800">E atender a QUALQUER destas condições</h3>
          {renderRules('any')}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_180px_220px]">
          <EditInput label="Nome do filtro" value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <label className="block text-sm">
            <span className="mb-1.5 block font-semibold text-slate-700">Visibilidade</span>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600"><LockKeyhole size={15}/>Privado</div>
          </label>
          <label className="mt-7 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={draft.favorite} onChange={(e) => setDraft({ ...draft, favorite: e.target.checked })} />
            Salvar em favoritos
          </label>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
        <span className="text-sm text-slate-500">Pré-visualização: <b className="text-slate-800">{previewCount}</b> negócios encontrados</span>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button type="button" onClick={() => onSave(draft)} className="rounded bg-[#238847] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40]">Salvar</button>
        </div>
      </div>
    </div>
  </div>
}

function CreateDealModal({ salesStages, crmUsers, canAssignOwner, newDeal, setNewDeal, createDeal, creating, close }: {
  salesStages: Stage[]
  crmUsers: CrmUser[]
  canAssignOwner: boolean
  newDeal: NewDeal
  setNewDeal: (deal: NewDeal) => void
  createDeal: (e: FormEvent) => Promise<void>
  creating: boolean
  close: () => void
}) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
    <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-xl font-bold text-slate-950">Adicionar novo negócio</h2>
          <p className="mt-1 text-sm text-slate-500">Os campos começam vazios. Só será salvo o que você preencher.</p>
        </div>
        <button onClick={close} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50" type="button">×</button>
      </div>
      <form onSubmit={createDeal} className="grid gap-4 p-5 md:grid-cols-2">
        <EditInput label="Título do negócio" value={newDeal.title} onChange={(v) => setNewDeal({ ...newDeal, title: v })} className="md:col-span-2" />
        <EditInput label="Empresa" value={newDeal.organization_name} onChange={(v) => setNewDeal({ ...newDeal, organization_name: v })} />
        <EditInput label="Contato" value={newDeal.contact_name} onChange={(v) => setNewDeal({ ...newDeal, contact_name: v })} />
        <EditInput label="Email" value={newDeal.contact_email} onChange={(v) => setNewDeal({ ...newDeal, contact_email: v })} type="email" />
        <EditInput label="Telefone" value={newDeal.contact_phone} onChange={(v) => setNewDeal({ ...newDeal, contact_phone: v })} />
        <EditInput label="Valor do negócio" value={newDeal.value} onChange={(v) => setNewDeal({ ...newDeal, value: v })} type="number" />
        <EditInput label="GMV mensal" value={newDeal.monthly_purchase} onChange={(v) => setNewDeal({ ...newDeal, monthly_purchase: v })} type="number" />
        <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Etapa</span>
          <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" value={newDeal.stage_id} onChange={(e) => setNewDeal({ ...newDeal, stage_id: e.target.value })}>
            <option value="">Sem etapa</option>
            {salesStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {canAssignOwner && <label className="block text-sm">
          <span className="mb-1.5 block font-semibold text-slate-700">Proprietário do negócio</span>
          <select className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" value={newDeal.owner_id} onChange={(e) => setNewDeal({ ...newDeal, owner_id: e.target.value })}>
            <option value="">Eu/Admin</option>
            {crmUsers.map((user) => <option key={user.id} value={user.auth_user_id || ''} disabled={!user.auth_user_id}>{user.full_name} · {user.crm_companies?.name || 'sem empresa'}{!user.auth_user_id ? ' · envie acesso primeiro' : ''}</option>)}
          </select>
        </label>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4 md:col-span-2">
          <button type="button" onClick={close} className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button disabled={creating || !newDeal.title.trim()} className="rounded bg-[#238847] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60">{creating ? 'Criando...' : 'Criar negócio'}</button>
        </div>
      </form>
    </div>
  </div>
}

function LoadingBpo() {
  return <div className="m-4 flex items-center gap-3 rounded bg-white p-4 text-sm font-semibold text-slate-700 shadow-sm">
    <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#211746] p-1.5"><img src="/brand/vmarket-logo-branca.png" alt="VMarket" className="max-h-full max-w-full object-contain" /></div>
    <div>
      <p>Carregando dados do BPO</p>
      <p className="text-xs font-normal text-slate-500">VMarket CRM</p>
    </div>
  </div>
}

function CollapsibleSection({ title, children, defaultOpen = true, className }: { title: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return <Panel className={cn('overflow-hidden', className)}>
    <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between border-b border-slate-200 bg-white p-4 text-left">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <span className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-600">{open ? '-' : '+'}</span>
    </button>
    {open && children}
  </Panel>
}

function LostReasonModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    const clean = reason.trim()
    if (!clean) {
      setError('Informe o motivo da perda para marcar como perdido.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onConfirm(clean)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={onCancel}>
    <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <div className="border-b border-slate-200 p-5">
        <h2 className="text-lg font-black text-slate-950">Motivo da perda</h2>
        <p className="mt-1 text-sm text-slate-500">Esse campo é obrigatório para marcar o negócio como perdido.</p>
      </div>
      <div className="p-5">
        {error && <p className="mb-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Explique por que o negócio foi perdido" />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
        <button type="button" onClick={onCancel} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancelar</button>
        <button disabled={saving || !reason.trim()} className="rounded bg-rose-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Salvando...' : 'Marcar perdido'}</button>
      </div>
    </form>
  </div>
}

function DealPage({ deal, loading, error, stages, crmUsers, canEditOwner, canViewCustomFields, activities, history, customFields, customFieldValues, dealLabels, assignedLabels, closeDealPage, saveDeal, createActivity, createNote, deleteDeal, deleteActivity, completeActivity, updateActivity, createLabel, deleteLabel, updateDealLabels }: {
  deal?: Deal
  loading: boolean
  error: string
  stages: Stage[]
  crmUsers: CrmUser[]
  canEditOwner: boolean
  canViewCustomFields: boolean
  activities: ActivityRow[]
  history: HistoryRow[]
  customFields: CustomField[]
  customFieldValues: CustomFieldValue[]
  dealLabels: DealLabel[]
  assignedLabels: DealLabelAssignment[]
  closeDealPage: () => void
  saveDeal: (form: DealForm, customValues: Record<string, string>) => Promise<void>
  createActivity: (activity: NewActivity) => Promise<void>
  createNote: (note: string) => Promise<void>
  deleteDeal: (id: string, label: string) => void
  deleteActivity: (id: string, label: string) => void
  completeActivity: (id: string) => Promise<void>
  updateActivity: (activityId: string, draft: ActivityEditDraft) => Promise<void>
  createLabel: (name: string, color: string) => Promise<DealLabel>
  deleteLabel: (label: DealLabel) => Promise<void>
  updateDealLabels: (dealId: string, labelIds: string[]) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [creatingActivity, setCreatingActivity] = useState(false)
  const [creatingNote, setCreatingNote] = useState(false)
  const [activityDraft, setActivityDraft] = useState<NewActivity>(() => blankNewActivity())
  const [noteDraft, setNoteDraft] = useState('')
  const [composerMode, setComposerMode] = useState<'note' | 'activity'>('note')
  const [showLabelPicker, setShowLabelPicker] = useState(false)
  const [editingActivity, setEditingActivity] = useState<ActivityRow | null>(null)
  const [showCustomFields, setShowCustomFields] = useState(false)
  const [showLostReason, setShowLostReason] = useState(false)
  const [form, setForm] = useState<DealForm>(() => dealToForm(deal))
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>(() => customValuesToDrafts(customFields, customFieldValues))

  async function submit(e: FormEvent) {
    e.preventDefault()
    await saveCurrent()
  }

  async function saveCurrent(nextForm = form) {
    setSaving(true)
    setSaved(false)
    try {
      await saveDeal(nextForm, customDrafts)
      setForm(nextForm)
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  async function markWon() {
    const next = { ...form, status: 'ganho', lost_reason: '' }
    await saveCurrent(next)
  }

  async function markLost(reason: string) {
    const next = { ...form, status: 'perdido', lost_reason: reason }
    await saveCurrent(next)
    setShowLostReason(false)
  }

  async function submitActivity() {
    setCreatingActivity(true)
    try {
      await createActivity(activityDraft)
      setActivityDraft(blankNewActivity())
    } catch {
      // O erro já é exibido pelo estado global da página.
    } finally {
      setCreatingActivity(false)
    }
  }

  async function submitNote() {
    setCreatingNote(true)
    try {
      await createNote(noteDraft)
      setNoteDraft('')
    } catch {
      // O erro já é exibido pelo estado global da página.
    } finally {
      setCreatingNote(false)
    }
  }

  if (loading) return <main className="min-h-screen bg-[#f4f5f7] p-5 text-slate-900"><LoadingBpo /></main>
  if (!deal) return <main className="min-h-screen bg-[#f4f5f7] p-5 text-slate-900"><div className="rounded bg-white p-6 shadow-sm"><h1 className="text-xl font-bold">Negócio não encontrado</h1><button onClick={closeDealPage} className="mt-4 rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white">Voltar ao funil</button></div></main>

  const update = (key: keyof DealForm, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }))
  const currentStage = stages.find((s) => s.id === form.stage_id) || stages.find((s) => s.id === deal.stage_id)
  const currentPipeline = currentStage?.pipeline_name || deal.pipeline_stages?.pipeline_name || 'Sem funil'
  const pipelineStages = stages.filter((stage) => (stage.pipeline_name || 'Sem funil') === currentPipeline)
  const currentPipelineStages = pipelineStages.length ? pipelineStages : [currentStage].filter(Boolean) as Stage[]
  const currentStageDays = daysSince(deal.pipedrive_stage_entered_at || deal.updated_at || deal.pipedrive_deal_created_at || deal.created_at)
  const ownerName = crmUsers.find((user) => user.auth_user_id && user.auth_user_id === form.owner_id)?.full_name || 'Sem proprietário CRM'
  const contractPartner = crmUsers.find((user) => user.auth_user_id && user.auth_user_id === form.owner_id) || crmUsers.find((user) => user.auth_user_id && user.auth_user_id === deal.owner_id)
  const partnerContract = partnerContractValues(contractPartner)
  const contractLocked = form.vm_sale && form.contract_with === 'parceiro' && Boolean(partnerContract)
  const selectedLabels = assignedLabels.map((assignment) => assignment.deal_labels).filter((label): label is DealLabel => Boolean(label))
  const openActivities = activities.filter((activity) => activity.status === 'open')
  const notes = history.filter((row) => row.event_type.toLowerCase().includes('nota') || row.event_type.toLowerCase().includes('anot'))
  const timeline = ([
    ...activities.map((activity) => ({ id: `activity-${activity.id}`, kind: 'Atividade', title: activity.title, description: activity.note, date: activity.due_at, status: activity.status, activity })),
    ...history.map((row) => ({ id: `history-${row.id}`, kind: row.event_type, title: row.title, description: row.description, date: row.created_at, status: '' })),
  ] as Array<{ id: string; kind: string; title: string; description: string | null; date: string | null; status: string; activity?: ActivityRow }>).sort((a, b) => new Date(b.date || '1900-01-01').getTime() - new Date(a.date || '1900-01-01').getTime())

  return <main className="min-h-screen w-full overflow-x-hidden bg-[#f4f5f7] text-slate-900">
    <header className="sticky top-0 z-30 w-full overflow-x-hidden border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-3 py-3 sm:px-4 md:flex-row md:flex-wrap md:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={closeDealPage} className="shrink-0 rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">← Voltar</button>
          <div className="min-w-0 flex-1 md:hidden">
            <h1 className="truncate text-lg font-semibold tracking-[-0.03em] text-slate-950">{deal.title}</h1>
            <p className="mt-1 truncate text-xs font-semibold text-blue-600">{currentPipeline} › {currentStage?.name || 'Sem etapa'}</p>
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-slate-950">{deal.title}</h1>
          <p className="mt-1 text-xs font-semibold text-blue-600">{currentPipeline} › {currentStage?.name || 'Sem etapa'}</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-[10px] font-black">{ownerName.slice(0,1).toUpperCase()}</span>
            <span className="truncate">{ownerName}</span>
          </div>
          <Badge tone={form.status === 'perdido' ? 'bg-slate-200 text-slate-700' : form.status === 'ganho' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}>{statusLabel[form.status] || 'Aberto'}</Badge>
          {saved && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Salvo</span>}
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <button type="button" disabled={saving || form.status === 'ganho'} onClick={() => void markWon()} className="flex-1 rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60 md:flex-none">Ganho</button>
          <button type="button" disabled={saving || form.status === 'perdido'} onClick={() => setShowLostReason(true)} className="flex-1 rounded bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 md:flex-none">Perdido</button>
          {canEditOwner && <button type="button" onClick={() => deleteDeal(deal.id, deal.title)} className="flex-1 rounded border border-rose-200 px-4 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 md:flex-none">Apagar</button>}
        </div>
      </div>
      <div className="w-full overflow-x-hidden border-t border-slate-100 px-3 pb-3 sm:px-4">
        <div className="mx-auto max-w-[1600px] overflow-x-auto">
          <div className="flex h-9 min-w-max overflow-hidden rounded-sm border border-slate-200 bg-[#eef1f5] md:min-w-0">
            {currentPipelineStages.map((stage, index) => {
              const isCurrent = stage.id === (form.stage_id || deal.stage_id)
              const totalStages = currentPipelineStages.length || 1
              const isFirst = index === 0
              const isLast = index === totalStages - 1
              const clipPath = `polygon(${isFirst ? '0' : '14px'} 0, ${isLast ? '100%' : 'calc(100% - 12px)'} 0, 100% 50%, ${isLast ? '100%' : 'calc(100% - 12px)'} 100%, ${isFirst ? '0' : '14px'} 100%, 0 50%)`
              return <button key={stage.id} type="button" onClick={() => update('stage_id', stage.id)} title={stage.name} style={{ clipPath }} className={cn('relative flex min-w-[105px] flex-1 items-center justify-center px-4 text-center text-xs font-semibold transition first:ml-0 -ml-3 md:min-w-[118px] md:px-5', isCurrent ? 'z-20 bg-[#0abf75] text-white' : 'bg-[#edf1f7] text-slate-500 hover:bg-slate-200')}>{dayLabel(isCurrent ? currentStageDays : 0)}</button>
            })}
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">{currentPipeline} · {currentStage?.name || 'Sem etapa'}</p>
        </div>
      </div>
    </header>

    <form id="deal-edit-form" onSubmit={submit} className="mx-auto grid w-full max-w-[1600px] min-w-0 gap-4 p-3 sm:p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      {error && <div className="xl:col-span-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><b>Erro:</b> {error}</div>}

      <aside className="min-w-0 space-y-4 xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4">
            <h2 className="text-base font-bold">Campos do negócio</h2>
            <p className="mt-1 text-xs text-slate-500">Clique no lápis para editar o valor.</p>
          </div>
          <div className="divide-y divide-slate-100">
            <ReadOnlyField label="Fonte do Lead" value={form.lead_source === 'vmarket' ? 'VMarket' : 'Parceiro'} />
            <InlineField label="Título do negócio" value={form.title} onChange={(v) => update('title', v)} />
            <InlineSelect label="Etapa" value={form.stage_id} onChange={(v) => update('stage_id', v)} options={currentPipelineStages.map((s) => [s.id, s.name])} />
            <InlineSelect label="Status" value={form.status} onChange={(v) => v === 'perdido' ? setShowLostReason(true) : update('status', v)} options={Object.entries(statusLabel)} />
            {form.status === 'perdido' && <ReadOnlyField label="Motivo da perda" value={form.lost_reason || deal.lost_reason || 'Sem motivo informado'} />}
            <InlineField label="Valor do negócio" value={form.value} onChange={(v) => update('value', v)} type="number" displayValue={money(Number(form.value || 0))} />
            <InlineField label="GMV mensal" value={form.monthly_purchase} onChange={(v) => update('monthly_purchase', v)} type="number" displayValue={money(Number(form.monthly_purchase || 0))} />
            <InlineField label="Fonte" value={form.source} onChange={(v) => update('source', v)} />
            <InlineField label="Data esperada de Fechamento" value={form.expected_close_date} onChange={(v) => update('expected_close_date', v)} type="date" />
            <ReadOnlyField label="Criação do Negócio" value={formatDateTime(deal.pipedrive_deal_created_at)} />
            <ReadOnlyField label="Proprietário do negócio no Pipedrive" value={deal.pipedrive_owner_name || 'Não sincronizado'} />
            <ReadOnlyField label="Etiquetas" value={selectedLabels.length ? selectedLabels.map((label) => label.name).join(', ') : 'Sem etiqueta'} action={<button type="button" onClick={() => setShowLabelPicker(true)} className="text-xs font-bold text-blue-600 hover:text-blue-700">Adicionar etiqueta</button>} />
            {canEditOwner && <InlineSelect label="Proprietário CRM" value={form.owner_id} onChange={(v) => update('owner_id', v)} options={[[deal.owner_id || '', deal.owner_id ? 'Proprietário atual' : 'Sem proprietário'], ...crmUsers.filter((u) => u.auth_user_id).map((u) => [u.auth_user_id || '', `${u.full_name} · ${u.crm_companies?.name || 'sem empresa'}`] as [string, string])]} />}
          </div>
        </Panel>

        <CollapsibleSection title="Plataforma VMarket" defaultOpen>
          <div className="divide-y divide-slate-100">
            <label className="flex items-center gap-3 p-3 text-sm font-semibold text-slate-800">
              <input type="checkbox" checked={form.vm_sale} onChange={(e) => update('vm_sale', e.target.checked)} className="h-4 w-4 accent-[#238847]" />
              Venda VMarket?
            </label>
            {form.vm_sale && <>
              <InlineSelect label="Contrato com" value={form.contract_with} onChange={(v) => update('contract_with', v)} options={[['cliente', 'Cliente'], ['parceiro', 'Parceiro']]} />
              <InlineSelect label="Tipo" value={form.vm_product_type} onChange={(v) => update('vm_product_type', v)} options={[['', 'Selecione'], ['restaurante', 'Restaurante'], ['hotel', 'Hotel'], ['fornecedor', 'Fornecedor']]} />
              <InlineField label="Quantidade de CNPJs" value={form.vm_cnpj_count} onChange={(v) => update('vm_cnpj_count', v)} type="number" />
              <InlineField label="Plano" value={form.vm_plan} onChange={(v) => update('vm_plan', v)} />
              <InlineField label="Valor por CNPJ" value={form.vm_value_per_cnpj} onChange={(v) => update('vm_value_per_cnpj', v)} type="number" displayValue={money(Number(form.vm_value_per_cnpj || 0))} />
              <div className="p-3">
                <CollapsibleSection title="Campos do Contrato" defaultOpen={false} className="border border-slate-200 shadow-none">
                  <div className="divide-y divide-slate-100">
                    {contractLocked ? <>
                      <ReadOnlyField label="Razão social" value={partnerContract?.legal || '-'} />
                      <ReadOnlyField label="CNPJ" value={partnerContract?.tax || '-'} />
                      <ReadOnlyField label="Endereço" value={partnerContract?.address || '-'} />
                      <ReadOnlyField label="Representante legal" value={partnerContract?.representative || '-'} />
                      <ReadOnlyField label="Email" value={partnerContract?.email || '-'} />
                      <ReadOnlyField label="Telefone" value={partnerContract?.phone || '-'} />
                    </> : <>
                      <InlineField label="Razão social" value={form.contract_legal_name} onChange={(v) => update('contract_legal_name', v)} />
                      <InlineField label="CNPJ" value={form.contract_tax_id} onChange={(v) => update('contract_tax_id', v)} />
                      <InlineField label="Endereço" value={form.contract_address} onChange={(v) => update('contract_address', v)} />
                      <InlineField label="Representante legal" value={form.contract_representative} onChange={(v) => update('contract_representative', v)} />
                      <InlineField label="Email" value={form.contract_email} onChange={(v) => update('contract_email', v)} type="email" />
                      <InlineField label="Telefone" value={form.contract_phone} onChange={(v) => update('contract_phone', v)} />
                    </>}
                  </div>
                </CollapsibleSection>
              </div>
            </>}
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Serviços Parceiro" defaultOpen>
          <div className="divide-y divide-slate-100">
            {partnerServiceDefinitions.map(([, label, flagKey, valueKey]) => <div key={flagKey} className="grid grid-cols-[1fr_120px] items-center gap-3 p-3 text-sm">
              <label className="flex min-w-0 items-center gap-2 font-semibold text-slate-800"><input type="checkbox" checked={Boolean(form[flagKey])} onChange={(e) => update(flagKey, e.target.checked)} className="h-4 w-4 accent-[#238847]" /> <span className="truncate">{label}</span></label>
              <input type="number" value={String(form[valueKey] || '')} onChange={(e) => update(valueKey, e.target.value)} disabled={!form[flagKey]} className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#238847] focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100" placeholder="Valor" />
            </div>)}
            <div className="grid gap-3 p-3 text-sm">
              <div className="grid grid-cols-[1fr_120px] items-center gap-3">
                <label className="flex min-w-0 items-center gap-2 font-semibold text-slate-800"><input type="checkbox" checked={form.partner_service_other} onChange={(e) => update('partner_service_other', e.target.checked)} className="h-4 w-4 accent-[#238847]" /> Outro</label>
                <input type="number" value={form.partner_service_other_value} onChange={(e) => update('partner_service_other_value', e.target.value)} disabled={!form.partner_service_other} className="w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#238847] focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100" placeholder="Valor" />
              </div>
              {form.partner_service_other && <input value={form.partner_service_other_name} onChange={(e) => update('partner_service_other_name', e.target.value)} required className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Qual outro serviço?" />}
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Empresa" defaultOpen>
          <div className="divide-y divide-slate-100">
            <InlineField label="Empresa" value={form.organization_name} onChange={(v) => update('organization_name', v)} />
            <InlineField label="Segmento" value={form.organization_segment} onChange={(v) => update('organization_segment', v)} />
            <InlineField label="Cidade" value={form.organization_city} onChange={(v) => update('organization_city', v)} />
            <InlineField label="Estado" value={form.organization_state} onChange={(v) => update('organization_state', v)} />
            <InlineField label="Quantidade de CNPJs" value={form.organization_cnpjs} onChange={(v) => update('organization_cnpjs', v)} type="number" />
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Contato" defaultOpen>
          <div className="divide-y divide-slate-100">
            <InlineField label="Pessoa" value={form.person_name} onChange={(v) => update('person_name', v)} />
            <InlineField label="Cargo" value={form.person_role} onChange={(v) => update('person_role', v)} />
            <InlineField label="Email" value={form.person_email} onChange={(v) => update('person_email', v)} type="email" />
            <InlineField label="Telefone" value={form.person_phone} onChange={(v) => update('person_phone', v)} />
          </div>
        </CollapsibleSection>

        {canViewCustomFields && <Panel className="overflow-hidden">
          <button type="button" onClick={() => setShowCustomFields((current) => !current)} className="flex w-full items-center justify-between border-b border-slate-200 bg-white p-4 text-left">
            <h2 className="text-base font-bold text-slate-900">Campos configuráveis</h2>
            <span className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 text-lg font-bold text-slate-600">{showCustomFields ? '-' : '+'}</span>
          </button>
          {showCustomFields && <div className="grid gap-4 p-4">
            {customFields.length ? customFields.map((field) => <CustomFieldInput key={field.id} field={field} value={customDrafts[field.id] || ''} onChange={(value) => setCustomDrafts((current) => ({ ...current, [field.id]: value }))} />) : <p className="text-sm text-slate-500">Nenhum campo customizado de negócio configurado.</p>}
          </div>}
        </Panel>}
      </aside>
      <section className="space-y-4">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white">
            <div className="flex flex-wrap items-center gap-1 px-4 pt-3 text-sm font-semibold text-slate-600">
              <button type="button" onClick={() => setComposerMode('note')} className={cn('flex items-center gap-2 rounded-t border border-b-0 px-3 py-2', composerMode === 'note' ? 'border-slate-200 bg-blue-50 text-blue-700' : 'border-transparent hover:bg-slate-50')}><MessageSquare size={15}/>Anotações</button>
              <button type="button" onClick={() => setComposerMode('activity')} className={cn('flex items-center gap-2 rounded-t border border-b-0 px-3 py-2', composerMode === 'activity' ? 'border-slate-200 bg-blue-50 text-blue-700' : 'border-transparent hover:bg-slate-50')}><CalendarClock size={15}/>Atividade</button>
            </div>
          </div>
          <div className="p-4">
            {composerMode === 'note' ? <div className="grid gap-3">
              <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={4} className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Escreva uma anotação. Ela aparecerá no histórico central." />
              <div className="flex justify-end"><button type="button" disabled={creatingNote || !noteDraft.trim()} onClick={() => void submitNote()} className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60">{creatingNote ? 'Salvando...' : 'Adicionar anotação'}</button></div>
            </div> : <div className="grid gap-3">
              <input value={activityDraft.title} onChange={(e) => setActivityDraft((current) => ({ ...current, title: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Título da atividade" />
              <div className="grid gap-2 md:grid-cols-[1fr_150px_130px]">
                <select value={activityDraft.activity_type} onChange={(e) => setActivityDraft((current) => ({ ...current, activity_type: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100">
                  <option value="task">Tarefa</option><option value="call">Ligação</option><option value="meeting">Reunião</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option>
                </select>
                <input type="date" value={activityDraft.due_date} onChange={(e) => setActivityDraft((current) => ({ ...current, due_date: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" />
                <input type="time" value={activityDraft.due_time} onChange={(e) => setActivityDraft((current) => ({ ...current, due_time: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" />
              </div>
              <textarea value={activityDraft.note} onChange={(e) => setActivityDraft((current) => ({ ...current, note: e.target.value }))} rows={3} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Observação, próximo passo ou combinado" />
              <div className="flex justify-end"><button type="button" disabled={creatingActivity || !activityDraft.title.trim()} onClick={() => void submitActivity()} className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60">{creatingActivity ? 'Criando...' : 'Agendar atividade'}</button></div>
            </div>}
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white p-4">
              <div><h2 className="text-lg font-bold">Histórico</h2><p className="mt-1 text-xs text-slate-500">Notas, atividades agendadas e eventos sincronizados do Pipedrive ficam aqui no centro.</p></div>
              <div className="flex flex-wrap gap-2"><Badge tone="bg-blue-100 text-blue-700">{notes.length} anotações</Badge><Badge tone="bg-amber-100 text-amber-700">{openActivities.length} atividades abertas</Badge><Badge tone="bg-slate-100 text-slate-700">{history.length} eventos</Badge></div>
            </div>
            <div className="min-h-[420px] space-y-0 p-4">
              {timeline.length ? timeline.map((item) => <div key={item.id} className="grid grid-cols-[40px_1fr] gap-3 pb-5 text-sm last:pb-0">
                <div className="relative flex justify-center"><TimelineIcon item={item} /><span className="absolute top-10 h-full w-px bg-slate-200" /></div>
                <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{item.kind}</p>{item.activity ? <button type="button" onClick={() => item.activity && setEditingActivity(item.activity)} className="text-left font-bold text-slate-900 hover:text-blue-700 hover:underline">{item.title}</button> : <b className="text-slate-900">{item.title}</b>}</div>
                    <div className="flex items-center gap-2">{item.activity?.status === 'done' && <span className="text-xs font-bold text-emerald-700">Concluído</span>}{item.date && <span className="text-xs text-slate-500">{formatDateTime(item.date)}</span>}{item.activity?.status === 'open' && <button type="button" onClick={() => item.activity && void completeActivity(item.activity.id)} className="rounded border border-emerald-200 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50">Concluir</button>}{item.activity && canEditOwner && <button type="button" onClick={() => item.activity && deleteActivity(item.activity.id, item.activity.title)} className="rounded border border-rose-200 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50">Apagar</button>}</div>
                  </div>
                  {item.description && <p className="mt-2 whitespace-pre-wrap text-slate-600">{item.description}</p>}
                </div>
              </div>) : <p className="rounded border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Sem histórico ainda.</p>}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="border-b border-slate-200 bg-white p-4"><h2 className="font-bold">Foco</h2></div>
            <div className="p-4">
              <textarea value={form.focus_items} onChange={(e) => update('focus_items', e.target.value)} rows={10} className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Um item de foco por linha" />
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">Os itens de foco continuam salvos no negócio.</p>
                <button type="button" disabled={saving} onClick={() => void saveCurrent()} className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar'}</button>
              </div>
            </div>
          </Panel>
        </div>
      </section>
    </form>

    {editingActivity && <ActivityEditorModal activity={editingActivity} onClose={() => setEditingActivity(null)} onSave={async (draft) => { await updateActivity(editingActivity.id, draft); setEditingActivity(null) }} />}
    {showLostReason && <LostReasonModal onCancel={() => setShowLostReason(false)} onConfirm={markLost} />}
    {showLabelPicker && <LabelPickerModal deal={deal} labels={dealLabels} assignedLabelIds={assignedLabels.map((assignment) => assignment.label_id)} onClose={() => setShowLabelPicker(false)} onCreateLabel={createLabel} onDeleteLabel={deleteLabel} onSave={async (labelIds) => { await updateDealLabels(deal.id, labelIds); setShowLabelPicker(false) }} />}
  </main>
}


const partnerServiceDefinitions = [
  ['implantacao', 'Implantação VMarket', 'partner_service_implantacao', 'partner_service_implantacao_value'],
  ['bpo_compras', 'BPO de Compras', 'partner_service_bpo_compras', 'partner_service_bpo_compras_value'],
  ['consultoria', 'Consultoria de Compras', 'partner_service_consultoria', 'partner_service_consultoria_value'],
  ['bpo_financeiro', 'BPO Financeiro', 'partner_service_bpo_financeiro', 'partner_service_bpo_financeiro_value'],
] as const

function partnerServicesToForm(value: Record<string, unknown> | null | undefined) {
  const services = (value || {}) as Record<string, { selected?: boolean; value?: string | number; name?: string }>
  return {
    partner_service_implantacao: Boolean(services.implantacao?.selected),
    partner_service_implantacao_value: String(services.implantacao?.value ?? ''),
    partner_service_bpo_compras: Boolean(services.bpo_compras?.selected),
    partner_service_bpo_compras_value: String(services.bpo_compras?.value ?? ''),
    partner_service_consultoria: Boolean(services.consultoria?.selected),
    partner_service_consultoria_value: String(services.consultoria?.value ?? ''),
    partner_service_bpo_financeiro: Boolean(services.bpo_financeiro?.selected),
    partner_service_bpo_financeiro_value: String(services.bpo_financeiro?.value ?? ''),
    partner_service_other: Boolean(services.other?.selected),
    partner_service_other_name: String(services.other?.name ?? ''),
    partner_service_other_value: String(services.other?.value ?? ''),
  }
}

function partnerServicesFromForm(form: DealForm) {
  return {
    implantacao: { selected: form.partner_service_implantacao, value: numberOrNull(form.partner_service_implantacao_value) },
    bpo_compras: { selected: form.partner_service_bpo_compras, value: numberOrNull(form.partner_service_bpo_compras_value) },
    consultoria: { selected: form.partner_service_consultoria, value: numberOrNull(form.partner_service_consultoria_value) },
    bpo_financeiro: { selected: form.partner_service_bpo_financeiro, value: numberOrNull(form.partner_service_bpo_financeiro_value) },
    other: { selected: form.partner_service_other, name: form.partner_service_other_name.trim(), value: numberOrNull(form.partner_service_other_value) },
  }
}

function partnerContractValues(user?: CrmUser) {
  if (!user) return null
  return {
    legal: user.legal_company_name || user.crm_companies?.name || user.full_name || '',
    tax: user.cnpj || '',
    address: user.headquarters_address || '',
    representative: user.legal_representative_name || user.full_name || '',
    email: user.primary_email || user.email || '',
    phone: user.crm_phone || '',
  }
}

function dealToForm(deal?: Deal): DealForm {
  return {
    title: deal?.title || '',
    stage_id: deal?.stage_id || '',
    owner_id: deal?.owner_id || '',
    status: deal?.status && statusLabel[deal.status] ? deal.status : 'aberto',
    value: String(deal?.value ?? ''),
    monthly_purchase: String(deal?.monthly_purchase ?? ''),
    source: deal?.source || '',
    expected_close_date: deal?.expected_close_date || '',
    lost_reason: deal?.lost_reason || '',
    lead_source: deal?.lead_source || (deal?.source === 'Pipedrive API' ? 'vmarket' : 'parceiro'),
    vm_sale: Boolean(deal?.vm_sale),
    contract_with: deal?.contract_with || 'cliente',
    vm_product_type: deal?.vm_product_type || '',
    vm_cnpj_count: String(deal?.vm_cnpj_count ?? ''),
    vm_plan: deal?.vm_plan || deal?.plan || '',
    vm_value_per_cnpj: String(deal?.vm_value_per_cnpj ?? ''),
    contract_legal_name: deal?.contract_legal_name || '',
    contract_tax_id: deal?.contract_tax_id || '',
    contract_address: deal?.contract_address || '',
    contract_representative: deal?.contract_representative || '',
    contract_email: deal?.contract_email || '',
    contract_phone: deal?.contract_phone || '',
    ...partnerServicesToForm(deal?.partner_services),
    focus_items: (deal?.focus_items || []).join('\n'),
    organization_name: deal?.organizations?.name || '',
    organization_segment: deal?.organizations?.segment || '',
    organization_city: deal?.organizations?.city || '',
    organization_state: deal?.organizations?.state || '',
    organization_cnpjs: String(deal?.organizations?.cnpjs ?? ''),
    person_name: deal?.people?.full_name || '',
    person_role: deal?.people?.role_title || '',
    person_email: deal?.people?.email || '',
    person_phone: deal?.people?.phone || '',
  }
}


function activityToEditDraft(activity: ActivityRow): ActivityEditDraft {
  return {
    title: activity.title || '',
    activity_type: activity.activity_type || 'task',
    due_date: toLocalDate(activity.due_at),
    due_time: toLocalTime(activity.due_at),
    note: activity.note || '',
    status: activity.status || 'open',
  }
}

function ActivityStatusDot({ status }: { status: ActivityRow['status'] }) {
  if (status === 'done') return <span className="mt-0.5 grid h-5 w-5 place-items-center rounded-full bg-emerald-500 text-[12px] font-black leading-none text-white ring-4 ring-emerald-100">✓</span>
  return <span className="mt-1 h-4 w-4 rounded-full border-2 border-slate-300 bg-white ring-4 ring-slate-100" />
}

function TimelineIcon({ item }: { item: { kind: string; activity?: ActivityRow } }) {
  const type = item.activity?.activity_type || ''
  const lowerKind = item.kind.toLowerCase()
  let icon: ReactNode = <FileText size={16} />
  let tone = 'bg-white text-slate-500 ring-slate-200'
  if (item.activity) {
    if (type === 'call') icon = <PhoneCall size={15} />
    else if (type === 'email') icon = <Mail size={15} />
    else if (type === 'meeting') icon = <Users size={15} />
    else if (type === 'whatsapp') icon = <MessageSquare size={15} />
    else icon = <CheckSquare size={15} />
    tone = item.activity.status === 'done' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-white text-slate-600 ring-slate-200'
  } else if (lowerKind.includes('nota') || lowerKind.includes('anot')) {
    icon = <MessageSquare size={15} />
    tone = 'bg-amber-50 text-amber-700 ring-amber-200'
  }
  return <span className={cn('mt-0 grid h-9 w-9 place-items-center rounded-full ring-1 shadow-sm', tone)}>{icon}</span>
}

function ActivityEditorModal({ activity, onClose, onSave }: { activity: ActivityRow; onClose: () => void; onSave: (draft: ActivityEditDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<ActivityEditDraft>(() => activityToEditDraft(activity))
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setLocalError('')
    try {
      await onSave(draft)
    } catch (e) {
      setLocalError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
    <form onSubmit={submit} className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div><h2 className="text-lg font-bold text-slate-950">Editar atividade</h2><p className="mt-1 text-xs text-slate-500">Clique em salvar para atualizar o título, data, observação e status.</p></div>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">×</button>
      </div>
      <div className="grid gap-4 p-5">
        {localError && <p className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{localError}</p>}
        <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Nome da atividade</span><input value={draft.title} onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" /></label>
        <div className="grid gap-3 md:grid-cols-[1fr_150px_130px]">
          <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Tipo</span><select value={draft.activity_type} onChange={(e) => setDraft((current) => ({ ...current, activity_type: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100"><option value="task">Tarefa</option><option value="call">Ligação</option><option value="meeting">Reunião</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label>
          <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Data</span><input type="date" value={draft.due_date} onChange={(e) => setDraft((current) => ({ ...current, due_date: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" /></label>
          <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Hora</span><input type="time" value={draft.due_time} onChange={(e) => setDraft((current) => ({ ...current, due_time: e.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" /></label>
        </div>
        <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Status</span><select value={draft.status} onChange={(e) => setDraft((current) => ({ ...current, status: e.target.value as ActivityRow['status'] }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100"><option value="open">Aberta</option><option value="done">Concluída</option><option value="cancelled">Cancelada</option></select></label>
        <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Observação</span><textarea value={draft.note} onChange={(e) => setDraft((current) => ({ ...current, note: e.target.value }))} rows={4} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" /></label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button type="button" onClick={onClose} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancelar</button><button disabled={saving || !draft.title.trim()} className="rounded bg-[#238847] px-5 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar'}</button></div>
    </form>
  </div>
}

function customValuesToDrafts(fields: CustomField[], values: CustomFieldValue[]) {
  const drafts: Record<string, string> = {}
  for (const field of fields) {
    const row = values.find((value) => value.field_id === field.id)
    const value = row?.value
    drafts[field.id] = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value)
  }
  return drafts
}

function apiSlug(field: CustomField) {
  return field.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || field.id
}


function DealLabelPills({ labels, compact = false }: { labels: DealLabel[]; compact?: boolean }) {
  if (!labels.length) return null
  return <div className={cn('mb-1.5 flex flex-wrap gap-1', compact && 'min-h-[10px]')}>{labels.slice(0, compact ? 4 : 8).map((label) => compact ? <span key={label.id} className="block h-2.5 w-9 rounded-sm shadow-sm" style={{ backgroundColor: label.color }} title={label.name} aria-label={label.name} /> : <span key={label.id} className="inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-[10px] font-black uppercase leading-none text-white shadow-sm" style={{ backgroundColor: label.color }} title={label.name}>{label.name}</span>)}</div>
}

function InlineField({ label, value, onChange, type = 'text', displayValue }: { label: string; value: string; onChange: (value: string) => void; type?: string; displayValue?: string }) {
  const [editing, setEditing] = useState(false)
  return <div className="grid grid-cols-[1fr_28px] gap-2 p-3 text-sm">
    <label className="min-w-0"><span className="block text-[11px] font-semibold text-slate-500">{label}</span>{editing ? <input autoFocus type={type} value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => { if (e.key === 'Enter') setEditing(false) }} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#238847] focus:ring-2 focus:ring-emerald-100" /> : <span className="mt-0.5 block break-words font-semibold text-slate-800">{displayValue || value || '-'}</span>}</label>
    <button type="button" onClick={() => setEditing((current) => !current)} className="mt-2 grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Editar ${label}`}><Pencil size={14}/></button>
  </div>
}

function InlineSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  const [editing, setEditing] = useState(false)
  const selected = options.find(([id]) => id === value)?.[1] || '-'
  return <div className="grid grid-cols-[1fr_28px] gap-2 p-3 text-sm">
    <label className="min-w-0"><span className="block text-[11px] font-semibold text-slate-500">{label}</span>{editing ? <select autoFocus value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => setEditing(false)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#238847] focus:ring-2 focus:ring-emerald-100">{options.map(([id, optionLabel]) => <option key={id || 'empty'} value={id}>{optionLabel}</option>)}</select> : <span className="mt-0.5 block break-words font-semibold text-slate-800">{selected}</span>}</label>
    <button type="button" onClick={() => setEditing((current) => !current)} className="mt-2 grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={`Editar ${label}`}><Pencil size={14}/></button>
  </div>
}

function ReadOnlyField({ label, value, action }: { label: string; value: string; action?: ReactNode }) {
  return <div className="p-3 text-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="block text-[11px] font-semibold text-slate-500">{label}</span><span className="mt-0.5 block break-words font-semibold text-slate-800">{value || '-'}</span></div>{action}</div></div>
}

function LabelPickerModal({ deal, labels, assignedLabelIds, onClose, onCreateLabel, onDeleteLabel, onSave }: { deal: Deal; labels: DealLabel[]; assignedLabelIds: string[]; onClose: () => void; onCreateLabel: (name: string, color: string) => Promise<DealLabel>; onDeleteLabel: (label: DealLabel) => Promise<void>; onSave: (labelIds: string[]) => Promise<void> }) {
  const colors = ['#3b82f6', '#5eead4', '#fde047', '#dc2626', '#a855f7', '#e5e7eb', '#92400e', '#fb923c', '#4b5563', '#f472b6']
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>(assignedLabelIds)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(colors[0])
  const filtered = labels.filter((label) => label.name.toLowerCase().includes(query.toLowerCase()))
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  async function addNewLabel() {
    const created = await onCreateLabel(newName, newColor)
    setSelected((current) => [...current, created.id])
    setNewName('')
    setNewColor(colors[0])
    setCreating(false)
  }
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="w-full max-w-md overflow-hidden rounded border border-slate-300 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      {creating ? <>
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="font-bold">Nova etiqueta</h2></div>
        <div className="space-y-4 p-4">
          <label className="block text-sm"><span className="mb-1.5 block font-semibold text-slate-700">Nome da etiqueta</span><input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded border border-slate-400 px-3 py-2 outline-none focus:border-blue-500" placeholder="Nome da etiqueta" /></label>
          <div><p className="mb-2 text-sm font-semibold text-slate-700">Cor da etiqueta</p><div className="flex flex-wrap gap-2">{colors.map((color) => <button key={color} type="button" onClick={() => setNewColor(color)} className={cn('grid h-7 w-7 place-items-center rounded-full ring-2', newColor === color ? 'ring-blue-500' : 'ring-transparent')} style={{ backgroundColor: color }}>{newColor === color ? <span className="text-sm font-black text-white">✓</span> : null}</button>)}</div></div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3"><button type="button" onClick={() => setCreating(false)} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">Cancelar</button><button type="button" onClick={() => void addNewLabel()} disabled={!newName.trim()} className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">Salvar</button></div>
      </> : <>
        <div className="p-3"><input value={query} onChange={(e) => setQuery(e.target.value)} className="w-full rounded border border-slate-400 px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="Buscar etiquetas" /></div>
        <div className="max-h-64 space-y-2 overflow-y-auto border-y border-slate-200 p-3">{filtered.map((label) => <div key={label.id} className="flex items-center justify-between gap-2"><button type="button" onClick={() => toggle(label.id)} className="min-w-0 flex-1 text-left"><span className={cn('inline-flex max-w-full rounded px-2 py-1 text-[11px] font-black uppercase text-white ring-offset-2', selected.includes(label.id) && 'ring-2 ring-blue-500')} style={{ backgroundColor: label.color }}>{label.name}</span></button><button type="button" onClick={async () => { await onDeleteLabel(label); setSelected((current) => current.filter((id) => id !== label.id)) }} className="rounded border border-rose-200 px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50">Deletar</button></div>)}{!filtered.length && <p className="text-sm text-slate-400">Nenhuma etiqueta encontrada.</p>}</div>
        <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-2 border-b border-slate-200 px-4 py-3 text-left text-sm font-semibold text-blue-600 hover:bg-blue-50">+ Adicionar etiqueta</button>
        <div className="flex justify-end gap-2 bg-slate-50 px-4 py-3"><button type="button" onClick={onClose} className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">Cancelar</button><button type="button" disabled={saving} onClick={() => { setSaving(true); void onSave(selected).finally(() => setSaving(false)) }} className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar'}</button></div>
      </>}
      <p className="sr-only">Editando etiquetas do negócio {deal.title}</p>
    </div>
  </div>
}

function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: string; onChange: (value: string) => void }) {
  const options = field.options || []
  const common = "mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#238847] focus:ring-4 focus:ring-emerald-100"
  return <label className="block">
    <span className="block text-sm font-semibold text-slate-700">{field.name}</span>
    <span className="mt-0.5 block text-[11px] text-slate-400">{field.pipedrive_key ? `Pipedrive: ${field.pipedrive_key}` : `field_id: ${field.id}`} · CRM: {apiSlug(field)}</span>
    {field.field_type === 'large_text' ? <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className={common} /> : field.field_type === 'single_option' ? <select value={value} onChange={(e) => onChange(e.target.value)} className={common}><option value="">Selecione</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : field.field_type === 'date' ? <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={common} /> : <input type={field.field_type === 'numeric' || field.field_type === 'monetary' || field.field_type === 'formula' ? 'number' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} className={common} placeholder={field.field_type === 'multi_option' ? 'Valores separados por vírgula' : undefined} />}
  </label>
}

function FieldsConfigView({ fields, setError, reload }: { fields: CustomField[]; setError: (error: string) => void; reload: () => Promise<void> }) {
  const [creating, setCreating] = useState(false)
  const [newField, setNewField] = useState<{ entity: CustomField['entity']; name: string; field_type: CustomField['field_type']; options: string }>({ entity: 'deal', name: '', field_type: 'text', options: '' })
  const fieldTypes: CustomField['field_type'][] = ['text', 'large_text', 'single_option', 'multi_option', 'numeric', 'monetary', 'phone', 'date', 'address', 'formula', 'user_ref', 'organization_ref', 'person_ref']
  const entityLabels: Record<CustomField['entity'], string> = { deal: 'Negócios', person: 'Pessoas', organization: 'Organizações', activity: 'Atividades' }
  const entities: CustomField['entity'][] = ['deal', 'person', 'organization', 'activity']
  const pipedriveFields = fields.filter((field) => field.pipedrive_key)

  async function createField(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError('')
    try {
      const { error } = await supabase.from('custom_fields').insert({
        entity: newField.entity,
        name: newField.name,
        field_type: newField.field_type,
        options: newField.options.split(',').map((item) => item.trim()).filter(Boolean),
        sort_order: fields.length + 1,
      })
      if (error) throw error
      setNewField({ entity: 'deal', name: '', field_type: 'text', options: '' })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  return <div className="h-full overflow-y-auto p-5">
    <Panel className="overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Tags size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Campos Pipedrive e API</h2></div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <Badge tone="bg-emerald-100 text-emerald-700">{pipedriveFields.length} campos importados</Badge>
            <Badge tone="bg-blue-100 text-blue-700">{fields.length} campos no CRM</Badge>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-500">O catálogo abaixo foi lido diretamente da API do Pipedrive. O CRM guarda a key original, tipo original, opções e tipo interno para manter a ficha próxima do Pipedrive sem escrever nada no Pipedrive.</p>
      </div>
      <form onSubmit={createField} className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-[140px_1fr_180px_1fr_120px]">
        <select value={newField.entity} onChange={(e) => setNewField({ ...newField, entity: e.target.value as CustomField['entity'] })} className="rounded border border-slate-300 px-3 py-2 text-sm"><option value="deal">Negócio</option><option value="organization">Empresa</option><option value="person">Pessoa</option><option value="activity">Atividade</option></select>
        <input value={newField.name} onChange={(e) => setNewField({ ...newField, name: e.target.value })} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Nome do campo" required />
        <select value={newField.field_type} onChange={(e) => setNewField({ ...newField, field_type: e.target.value as CustomField['field_type'] })} className="rounded border border-slate-300 px-3 py-2 text-sm">{fieldTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <input value={newField.options} onChange={(e) => setNewField({ ...newField, options: e.target.value })} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Opções separadas por vírgula" />
        <button disabled={creating} className="rounded bg-[#238847] px-3 py-2 text-sm font-bold text-white disabled:opacity-60">{creating ? 'Criando...' : 'Criar campo'}</button>
      </form>

      <div className="grid gap-3 border-b border-slate-200 bg-white p-4 md:grid-cols-4">
        {entities.map((entity) => {
          const total = fields.filter((field) => field.entity === entity).length
          const imported = fields.filter((field) => field.entity === entity && field.pipedrive_key).length
          return <div key={entity} className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{entityLabels[entity]}</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{imported}</p>
            <p className="text-xs text-slate-500">de {total} campos no CRM</p>
          </div>
        })}
      </div>

      <div className="divide-y divide-slate-100">
        {entities.map((entity) => {
          const entityFields = fields.filter((field) => field.entity === entity).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || a.name.localeCompare(b.name))
          if (!entityFields.length) return null
          return <section key={entity}>
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">{entityLabels[entity]}</div>
            {entityFields.map((field) => <div key={field.id} className="grid gap-3 p-4 text-sm hover:bg-slate-50 md:grid-cols-[1fr_110px_120px_1.4fr]">
              <div>
                <b>{field.name}</b>
                <p className="mt-1 text-xs text-slate-500">CRM: <code>{apiSlug(field)}</code></p>
                {field.options?.length ? <p className="mt-1 line-clamp-2 text-xs text-slate-400">Opções: {field.options.slice(0, 8).join(', ')}{field.options.length > 8 ? ` +${field.options.length - 8}` : ''}</p> : null}
              </div>
              <span className="text-slate-600">{field.entity}</span>
              <span className="text-slate-600">{field.field_type}</span>
              <div className="min-w-0 text-xs text-slate-500">
                {field.pipedrive_key ? <><p>Pipedrive key:</p><code className="break-all text-blue-700">{field.pipedrive_key}</code><p className="mt-1">Tipo Pipedrive: <b>{field.pipedrive_field_type || 'n/a'}</b></p></> : <><p>Campo local:</p><code className="break-all">{field.id}</code></>}
              </div>
            </div>)}
          </section>
        })}
      </div>
      <div className="border-t border-slate-200 bg-emerald-50 p-4 text-sm text-slate-700">
        <b>API direta Pipedrive:</b> a função <code>pipedrive-sync</code> continua responsável por webhooks e mapeamentos. Esta versão adiciona o catálogo fiel de campos para orientar ficha, importação e sincronização.
      </div>
    </Panel>
  </div>
}

function EditInput({ label, value, onChange, type = 'text', className }: { label: string; value: string; onChange: (value: string) => void; type?: string; className?: string }) {
  return <label className={cn('block', className)}><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" /></label>
}


function ListView({ title, icon, rows, canDelete = false, onDelete }: { title: string; icon: ReactNode; rows: Array<{ id: string; title: string; sub: string; meta: string }>; canDelete?: boolean; onDelete?: (id: string, label: string) => void }) {
  return <div className="h-full overflow-y-auto p-5"><Panel><div className="flex items-center gap-2 border-b border-slate-200 p-4"><span className="text-[#6f5cf6]">{icon}</span><h2 className="text-lg font-bold">{title}</h2></div><div className="divide-y divide-slate-100">{rows.map((row) => <div key={row.id} className="grid gap-2 p-4 text-sm hover:bg-slate-50 md:grid-cols-[1fr_1fr_160px_100px]"><b>{row.title}</b><span className="text-slate-500">{row.sub}</span><span className="font-semibold text-slate-700">{row.meta}</span>{canDelete && <button type="button" onClick={() => onDelete?.(row.id, row.title)} className="rounded border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50">Apagar</button>}</div>)}</div></Panel></div>
}

function ActivitiesView({ activities, deals, completeActivity, updateActivity, canDelete = false, deleteActivity }: { activities: ActivityRow[]; deals: Deal[]; completeActivity: (id: string) => Promise<void>; updateActivity: (activityId: string, draft: ActivityEditDraft) => Promise<void>; canDelete?: boolean; deleteActivity?: (id: string, label: string) => void }) {
  const [editingActivity, setEditingActivity] = useState<ActivityRow | null>(null)
  const statusTone = (status: string) => status === 'concluida' ? 'bg-emerald-100 text-emerald-700' : status === 'atrasada' ? 'bg-rose-100 text-rose-700' : 'bg-blue-100 text-blue-700'
  return <div className="h-full overflow-y-auto p-5">
    <Panel>
      <div className="flex items-center gap-2 border-b border-slate-200 p-4"><CalendarClock size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Atividades</h2></div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Atividade</th><th className="px-4 py-3">Criada em</th><th className="px-4 py-3">Concluída em</th><th className="px-4 py-3">Negócio</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Vencimento</th><th className="px-4 py-3">Ações</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {activities.map((a) => {
              const deal = deals.find((d) => d.id === a.deal_id)
              const displayStatus = activityDisplayStatus(a)
              return <tr key={a.id} className="hover:bg-slate-50">
                <td className="min-w-[220px] px-4 py-3"><div className="flex items-center gap-3"><ActivityStatusDot status={a.status}/><button type="button" onClick={() => setEditingActivity(a)} className="text-left font-bold text-slate-900 hover:text-blue-700 hover:underline">{a.title}</button></div></td>
                <td className="px-4 py-3 text-slate-600">{formatDateTime(a.created_at)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDateTime(a.completed_at)}</td>
                <td className="px-4 py-3 text-slate-700">{deal?.title || 'Sem negócio'}</td>
                <td className="px-4 py-3 text-slate-600">{deal?.people?.full_name || 'Sem contato'}</td>
                <td className="px-4 py-3 text-slate-600">{deal?.organizations?.name || 'Sem empresa'}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(displayStatus)}>{displayStatus}</Badge></td>
                <td className="px-4 py-3 text-slate-600">{formatDateTime(a.due_at)}</td>
                <td className="px-4 py-3"><div className="flex gap-2">{a.status === 'open' && <button type="button" onClick={() => void completeActivity(a.id)} className="rounded border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50">Concluir</button>}{canDelete && <button type="button" onClick={() => deleteActivity?.(a.id, a.title)} className="rounded border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50">Apagar</button>}</div></td>
              </tr>
            })}
          </tbody>
        </table>
        {activities.length === 0 && <div className="p-8 text-center text-slate-400">Nenhuma atividade encontrada.</div>}
      </div>
    </Panel>
    {editingActivity && <ActivityEditorModal activity={editingActivity} onClose={() => setEditingActivity(null)} onSave={async (draft) => { await updateActivity(editingActivity.id, draft); setEditingActivity(null) }} />}
  </div>
}

const tableLabels: Record<string, string> = {
  deals: 'Negócio',
  organizations: 'Empresa',
  people: 'Contato',
  activities: 'Atividade',
  deal_labels: 'Etiqueta',
  deal_label_assignments: 'Etiqueta do negócio',
  custom_field_values: 'Campo customizado',
  crm_users: 'Usuário CRM',
  crm_companies: 'Empresa CRM',
  deal_history: 'Histórico legado',
}

const fieldLabels: Record<string, string> = {
  title: 'Título',
  name: 'Nome',
  full_name: 'Nome completo',
  email: 'Email',
  phone: 'Telefone',
  stage_id: 'Etapa',
  owner_id: 'Proprietário',
  value: 'Valor',
  monthly_purchase: 'GMV mensal',
  expected_close_date: 'Data esperada de Fechamento',
  pipedrive_deal_created_at: 'Criação do Negócio',
  pipedrive_owner_name: 'Proprietário Pipedrive',
  status: 'Status',
  note: 'Observação',
  due_at: 'Vencimento',
  completed_at: 'Concluída em',
  activity_type: 'Tipo de atividade',
  color: 'Cor',
  value_json: 'Valor',
}

function operationLabel(operation: AuditLog['operation']) {
  if (operation === 'insert') return 'Criação'
  if (operation === 'delete') return 'Exclusão'
  return 'Alteração'
}

function actorTypeLabel(type: AuditLog['actor_type']) {
  if (type === 'api') return 'API'
  if (type === 'admin') return 'Administrador'
  return 'Usuário'
}

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value || '-'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.length ? value.map(formatAuditValue).join(', ') : '-'
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.title === 'string') return record.title
    if (typeof record.name === 'string') return record.name
    if (typeof record.full_name === 'string') return record.full_name
    if (typeof record.description === 'string' && record.description) return record.description
    return JSON.stringify(value)
  }
  return String(value)
}

function automationStatusTone(status: AutomationRuleExecution['status'] | AutomationRule['status']) {
  if (status === 'success' || status === 'active') return 'bg-emerald-100 text-emerald-700'
  if (status === 'error') return 'bg-rose-100 text-rose-700'
  if (status === 'ignored' || status === 'paused') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-700'
}

function jsonList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function AutomationJsonList({ items }: { items: unknown[] }) {
  if (!items.length) return <p className="text-sm text-slate-400">Nenhum item registrado.</p>
  return <div className="space-y-2">
    {items.map((item, index) => {
      if (typeof item === 'string') return <div key={index} className="rounded border border-slate-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700">{item}</div>
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : { valor: item }
      return <div key={index} className="rounded border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
        {Object.entries(record).map(([key, value]) => <p key={key} className="break-words"><b className="text-slate-900">{key}:</b> {formatAuditValue(value)}</p>)}
      </div>
    })}
  </div>
}

function AutomationsView({ rules, executions, changes }: { rules: AutomationRule[]; executions: AutomationRuleExecution[]; changes: AutomationRuleChange[] }) {
  const [selectedRuleId, setSelectedRuleId] = useState(() => rules[0]?.id || '')
  const [statusFilter, setStatusFilter] = useState('all')
  const selectedRule = rules.find((rule) => rule.id === selectedRuleId) || rules[0]
  const executionsForRule = executions.filter((execution) => !selectedRule || execution.rule_id === selectedRule.id)
  const filteredExecutions = executionsForRule.filter((execution) => statusFilter === 'all' || execution.status === statusFilter)
  const changesForRule = changes.filter((change) => !selectedRule || change.rule_id === selectedRule.id)
  const totalSuccess = executions.filter((execution) => execution.status === 'success').length
  const totalErrors = executions.filter((execution) => execution.status === 'error').length
  const totalIgnored = executions.filter((execution) => execution.status === 'ignored').length

  if (!rules.length) return <div className="h-full overflow-y-auto p-5"><Panel className="p-8 text-center text-slate-500">Nenhuma regra de automação registrada ainda.</Panel></div>

  return <div className="h-full overflow-y-auto p-5">
    <div className="mb-4 grid gap-3 md:grid-cols-4">
      <Panel className="p-4"><p className="text-xs font-bold uppercase text-slate-400">Regras cadastradas</p><p className="mt-1 text-2xl font-black text-slate-900">{rules.length}</p></Panel>
      <Panel className="p-4"><p className="text-xs font-bold uppercase text-slate-400">Execuções OK</p><p className="mt-1 text-2xl font-black text-emerald-600">{totalSuccess}</p></Panel>
      <Panel className="p-4"><p className="text-xs font-bold uppercase text-slate-400">Ignoradas</p><p className="mt-1 text-2xl font-black text-amber-600">{totalIgnored}</p></Panel>
      <Panel className="p-4"><p className="text-xs font-bold uppercase text-slate-400">Erros</p><p className="mt-1 text-2xl font-black text-rose-600">{totalErrors}</p></Panel>
    </div>

    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><Settings size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Automações</h2></div>
          <p className="mt-2 text-sm text-slate-500">Catálogo das regras entre Pipedrive, CRM BPO e automações complementares. Novas regras devem ser registradas aqui.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {rules.map((rule) => {
            const lastExecution = executions.find((execution) => execution.rule_id === rule.id)
            return <button type="button" key={rule.id} onClick={() => setSelectedRuleId(rule.id)} className={cn('w-full p-4 text-left hover:bg-blue-50', selectedRule?.id === rule.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : '')}>
              <div className="flex items-start justify-between gap-3">
                <b className="text-sm text-slate-900">{rule.name}</b>
                <Badge tone={automationStatusTone(rule.status)}>{rule.status}</Badge>
              </div>
              <p className="mt-2 text-xs text-slate-500">{rule.source_system} → {rule.target_system}</p>
              <p className="mt-1 text-xs text-slate-400">Última execução: {lastExecution ? formatDateTime(lastExecution.started_at) : 'sem histórico'}</p>
            </button>
          })}
        </div>
      </Panel>

      {selectedRule && <div className="space-y-4">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-[-0.03em] text-slate-950">{selectedRule.name}</h2>
                <p className="mt-2 max-w-4xl text-sm text-slate-600">{selectedRule.description}</p>
              </div>
              <Badge tone={automationStatusTone(selectedRule.status)}>{selectedRule.status}</Badge>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div><p className="text-[11px] font-bold uppercase text-slate-400">Gatilho</p><p className="text-sm font-semibold text-slate-800">{selectedRule.trigger_system}<br/><span className="font-normal text-slate-500">{selectedRule.trigger_type}</span></p></div>
              <div><p className="text-[11px] font-bold uppercase text-slate-400">Origem</p><p className="text-sm font-semibold text-slate-800">{selectedRule.source_system}</p></div>
              <div><p className="text-[11px] font-bold uppercase text-slate-400">Destino</p><p className="text-sm font-semibold text-slate-800">{selectedRule.target_system}</p></div>
              <div><p className="text-[11px] font-bold uppercase text-slate-400">Criada/alterada</p><p className="text-sm font-semibold text-slate-800">{formatDateTime(selectedRule.created_at)}<br/><span className="font-normal text-slate-500">Alterada: {formatDateTime(selectedRule.updated_at)}</span></p></div>
            </div>
          </div>
          <div className="grid gap-4 p-5 lg:grid-cols-2">
            <section><h3 className="mb-2 text-sm font-black uppercase text-slate-500">Gatilhos</h3><AutomationJsonList items={jsonList(selectedRule.triggers)} /></section>
            <section><h3 className="mb-2 text-sm font-black uppercase text-slate-500">Filtros</h3><AutomationJsonList items={jsonList(selectedRule.filters)} /></section>
            <section><h3 className="mb-2 text-sm font-black uppercase text-slate-500">Ações</h3><AutomationJsonList items={jsonList(selectedRule.actions)} /></section>
            <section><h3 className="mb-2 text-sm font-black uppercase text-slate-500">Implementação</h3><AutomationJsonList items={jsonList(selectedRule.implementation_refs)} /></section>
            <section className="lg:col-span-2"><h3 className="mb-2 text-sm font-black uppercase text-slate-500">Campos envolvidos</h3><div className="flex flex-wrap gap-2">{jsonList(selectedRule.fields_involved).map((field, index) => <Badge key={index}>{formatAuditValue(field)}</Badge>)}</div></section>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white p-4">
            <div><h3 className="font-bold text-slate-900">Histórico de execuções</h3><p className="mt-1 text-sm text-slate-500">Horário, status, campos alterados, filtros, ações e erro quando houver.</p></div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"><option value="all">Todos status</option><option value="success">Sucesso</option><option value="ignored">Ignorado</option><option value="error">Erro</option><option value="processing">Processando</option></select>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredExecutions.map((execution) => <div key={execution.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={automationStatusTone(execution.status)}>{execution.status}</Badge>
                <b>{formatDateTime(execution.started_at)}</b>
                <span className="text-slate-500">Fim: {formatDateTime(execution.finished_at)}</span>
                <span className="text-slate-400">{execution.record_entity || 'registro'} · {execution.external_id || execution.internal_id || '-'}</span>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <div><p className="mb-1 text-[11px] font-bold uppercase text-slate-400">Campos alterados</p><AutomationJsonList items={jsonList(execution.changed_fields)} /></div>
                <div><p className="mb-1 text-[11px] font-bold uppercase text-slate-400">Filtros avaliados</p><AutomationJsonList items={jsonList(execution.filters_evaluated)} /></div>
                <div><p className="mb-1 text-[11px] font-bold uppercase text-slate-400">Ações executadas</p><AutomationJsonList items={jsonList(execution.actions_performed)} /></div>
              </div>
              {execution.error_message && <p className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-rose-700"><b>Erro:</b> {execution.error_message}</p>}
            </div>)}
            {!filteredExecutions.length && <div className="p-8 text-center text-slate-400">Nenhuma execução encontrada para esta regra.</div>}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">Registro de criação e alterações</h3></div>
          <div className="divide-y divide-slate-100">
            {changesForRule.map((change) => <div key={change.id} className="p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3"><Badge>{change.change_type}</Badge><b>{formatDateTime(change.created_at)}</b><span className="text-slate-500">por {change.changed_by}</span></div>
              <p className="mt-2 text-slate-700">{change.summary}</p>
            </div>)}
            {!changesForRule.length && <div className="p-6 text-center text-slate-400">Sem alterações registradas.</div>}
          </div>
        </Panel>
      </div>}
    </div>
  </div>
}

function AuditLogView({ logs }: { logs: AuditLog[] }) {
  const [actorFilter, setActorFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const actorOptions = [...new Set(logs.map((log) => log.actor_name || actorTypeLabel(log.actor_type)))].sort((a, b) => a.localeCompare(b))
  const typeOptions = [...new Set(logs.map((log) => `${log.operation}:${log.table_name}:${log.field_name || '*'}`))]
  const filtered = logs.filter((log) => {
    const actor = log.actor_name || actorTypeLabel(log.actor_type)
    const typeKey = `${log.operation}:${log.table_name}:${log.field_name || '*'}`
    const time = new Date(log.created_at).getTime()
    if (actorFilter !== 'all' && actor !== actorFilter) return false
    if (typeFilter !== 'all' && typeKey !== typeFilter) return false
    if (startDate && time < new Date(`${startDate}T00:00:00`).getTime()) return false
    if (endDate && time > new Date(`${endDate}T23:59:59`).getTime()) return false
    return true
  })
  const typeLabel = (key: string) => {
    const [operation, table, field] = key.split(':')
    return `${operationLabel(operation as AuditLog['operation'])} · ${tableLabels[table] || table}${field && field !== '*' ? ` · ${fieldLabels[field] || field}` : ''}`
  }
  return <div className="h-full overflow-y-auto p-5">
    <Panel className="overflow-hidden">
      <div className="border-b border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><ClipboardList size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Log de Alterações</h2></div>
          <Badge tone="bg-blue-100 text-blue-700">{filtered.length} registros</Badge>
        </div>
        <p className="mt-2 text-sm text-slate-500">Alterações feitas por API, usuários e administradores, com campo alterado, valor anterior, valor atual, autor, data e hora.</p>
      </div>
      <div className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1.4fr_160px_160px_auto]">
        <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Quem fez</span><select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2"><option value="all">Todos</option>{actorOptions.map((actor) => <option key={actor} value={actor}>{actor}</option>)}</select></label>
        <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Tipo de alteração</span><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2"><option value="all">Todos</option>{typeOptions.map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label>
        <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Data inicial</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="block text-sm"><span className="mb-1 block font-semibold text-slate-700">Data final</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded border border-slate-300 bg-white px-3 py-2" /></label>
        <button type="button" onClick={() => { setActorFilter('all'); setTypeFilter('all'); setStartDate(''); setEndDate('') }} className="self-end rounded border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Limpar</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <tr><th className="px-4 py-3">Data e hora</th><th className="px-4 py-3">Quem fez</th><th className="px-4 py-3">Tipo</th><th className="px-4 py-3">Registro</th><th className="px-4 py-3">Campo</th><th className="px-4 py-3">Valor anterior</th><th className="px-4 py-3">Valor atual</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((log) => <tr key={log.id} className="align-top hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(log.created_at)}</td>
              <td className="px-4 py-3"><b className="text-slate-900">{log.actor_name || actorTypeLabel(log.actor_type)}</b><p className="mt-1 text-xs text-slate-500">{actorTypeLabel(log.actor_type)}</p></td>
              <td className="px-4 py-3"><Badge tone={log.operation === 'delete' ? 'bg-rose-100 text-rose-700' : log.operation === 'insert' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}>{operationLabel(log.operation)}</Badge></td>
              <td className="px-4 py-3 text-slate-700"><b>{tableLabels[log.table_name] || log.table_name}</b><p className="mt-1 max-w-[180px] truncate text-xs text-slate-400">{log.entity_id || '-'}</p></td>
              <td className="px-4 py-3 font-semibold text-slate-800">{log.field_name ? (fieldLabels[log.field_name] || log.field_name) : 'Registro completo'}</td>
              <td className="max-w-[260px] px-4 py-3 text-slate-600"><span className="line-clamp-3 break-words">{formatAuditValue(log.old_value)}</span></td>
              <td className="max-w-[260px] px-4 py-3 text-slate-900"><span className="line-clamp-3 break-words">{formatAuditValue(log.new_value)}</span></td>
            </tr>)}
          </tbody>
        </table>
        {!filtered.length && <div className="p-8 text-center text-slate-400">Nenhuma alteração encontrada para os filtros selecionados.</div>}
      </div>
    </Panel>
  </div>
}

type CleanupTarget = 'deals' | 'activities' | 'people' | 'organizations' | 'users'

type CleanupResult = {
  target: CleanupTarget
  before?: number
  deleted?: number
  auth_deleted?: number
  custom_values_deleted?: number
  after?: number
}

function UserDetailField({ label, value }: { label: string; value?: string | number | boolean | string[] | null }) {
  const display = Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Sim' : 'Não') : value
  return <div className="rounded-lg border border-slate-100 bg-white p-3">
    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-slate-800">{display === null || display === undefined || display === '' ? '-' : display}</p>
  </div>
}

function CrmUserTallyDetails({ user }: { user: CrmUser }) {
  const contacts = (user.additional_contacts || []).filter((contact) => contact?.name || contact?.role || contact?.whatsapp)
  return <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-black text-slate-900">Dados do cadastro Tally</h3>
      {user.tally_submitted_at && <Badge tone="bg-purple-100 text-purple-700">Enviado em {new Date(user.tally_submitted_at).toLocaleDateString('pt-BR')}</Badge>}
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <UserDetailField label="Razão social" value={user.legal_company_name} />
      <UserDetailField label="CNPJ" value={user.cnpj} />
      <UserDetailField label="Endereço completo da sede" value={user.headquarters_address} />
      <UserDetailField label="Inscrição estadual/municipal" value={user.state_registration} />
      <UserDetailField label="Representante legal" value={user.legal_representative_name} />
      <UserDetailField label="Nacionalidade" value={user.nationality} />
      <UserDetailField label="Estado civil" value={user.marital_status} />
      <UserDetailField label="Profissão" value={user.profession} />
      <UserDetailField label="RG e órgão emissor" value={user.rg_issuer} />
      <UserDetailField label="CPF" value={user.cpf} />
      <UserDetailField label="Cargo na empresa" value={user.company_role} />
      <UserDetailField label="Email principal" value={user.primary_email} />
      <UserDetailField label="Telefone/WhatsApp CRM" value={user.crm_phone} />
      <UserDetailField label="Emite NF de serviço" value={user.issues_service_invoice} />
      <UserDetailField label="Banco" value={user.bank_name} />
      <UserDetailField label="Agência" value={user.bank_agency} />
      <UserDetailField label="Conta e tipo" value={user.bank_account} />
      <UserDetailField label="Chave PIX" value={user.pix_key} />
      <UserDetailField label="Regiões de atuação" value={user.service_regions} />
      <UserDetailField label="Tipos de operação" value={user.operation_types} />
      <UserDetailField label="Clientes novos/mês" value={user.monthly_new_clients_capacity} />
      <UserDetailField label="Experiência food service" value={user.food_service_experience} />
      <UserDetailField label="Clientes atuais" value={user.current_clients_count} />
      <UserDetailField label="Clientes em compras" value={user.current_purchasing_clients_count} />
      <UserDetailField label="Ticket médio compras" value={user.purchasing_ticket_avg} />
      <UserDetailField label="Serviços oferecidos" value={user.offered_services} />
      <UserDetailField label="Autorização" value={user.data_authorization} />
    </div>
    <div className="mt-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Outras pessoas da empresa</p>
      {contacts.length ? <div className="mt-2 grid gap-2 md:grid-cols-3">
        {contacts.map((contact, index) => <div key={`${contact.name || 'contato'}-${index}`} className="rounded-lg border border-slate-100 bg-white p-3 text-sm">
          <b>{contact.name || `Pessoa ${index + 1}`}</b>
          <p className="mt-1 text-slate-500">{contact.role || 'Cargo não informado'}</p>
          <p className="mt-1 font-semibold text-slate-700">{contact.whatsapp || 'WhatsApp não informado'}</p>
        </div>)}
      </div> : <p className="mt-2 text-sm text-slate-400">Nenhum contato adicional cadastrado.</p>}
    </div>
  </div>
}

function AdminUsersView({ users, companies, dealsCount, activitiesCount, peopleCount, organizationsCount, reload, setError }: {
  users: CrmUser[]
  companies: CrmCompany[]
  dealsCount: number
  activitiesCount: number
  peopleCount: number
  organizationsCount: number
  reload: () => Promise<void>
  setError: (error: string) => void
}) {
  const [busyId, setBusyId] = useState<string>('')
  const [message, setMessage] = useState('')
  const [newUser, setNewUser] = useState({ full_name: '', email: '', company_name: '' })
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})
  const [cleanupConfirm, setCleanupConfirm] = useState<Record<CleanupTarget, string>>({ deals: '', activities: '', people: '', organizations: '', users: '' })

  const cleanupItems: Array<{ target: CleanupTarget; label: string; count: number; description: string }> = [
    { target: 'deals', label: 'Apagar negócios', count: dealsCount, description: 'Remove negócios, histórico e atividades vinculadas aos negócios.' },
    { target: 'activities', label: 'Apagar atividades', count: activitiesCount, description: 'Remove apenas as atividades registradas.' },
    { target: 'people', label: 'Apagar contatos', count: peopleCount, description: 'Remove contatos e desvincula contato dos negócios.' },
    { target: 'organizations', label: 'Apagar empresas', count: organizationsCount, description: 'Remove empresas dos negócios e desvincula empresas de contatos e negócios.' },
    { target: 'users', label: 'Apagar usuários', count: users.length, description: 'Remove usuários do CRM e Auth vinculados, preservando o admin logado.' },
  ]

  async function callAdminFunction(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('admin-users', { body })
    if (error) throw error
    if (data?.error) throw new Error(String(data.error))
    return data
  }

  async function createUser(e: FormEvent) {
    e.preventDefault()
    setBusyId('create')
    setMessage('')
    setError('')
    try {
      await callAdminFunction({ action: 'create-crm-user', ...newUser })
      setNewUser({ full_name: '', email: '', company_name: '' })
      setMessage('Usuário cadastrado. Agora você pode enviar o email de acesso.')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  async function sendAccessEmail(user: CrmUser) {
    setBusyId(user.id)
    setMessage('')
    setError('')
    try {
      const data = await callAdminFunction({ action: 'send-access-email', crm_user_id: user.id })
      setMessage(`${data.mode === 'invite' ? 'Convite enviado' : 'Email de redefinição enviado'} para ${user.full_name} (${user.crm_companies?.name || 'sem empresa'}).`)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  async function setInitialPassword(user: CrmUser) {
    const password = passwordDrafts[user.id] || ''
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    setBusyId(`password-${user.id}`)
    setMessage('')
    setError('')
    try {
      await callAdminFunction({ action: 'set-initial-password', crm_user_id: user.id, password })
      setPasswordDrafts((current) => ({ ...current, [user.id]: '' }))
      setMessage(`Senha inicial definida para ${user.full_name}.`)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  async function deleteUser(user: CrmUser) {
    const confirmed = window.confirm(`Apagar usuário ${user.full_name}? Essa ação remove o acesso dele e não pode ser desfeita.`)
    if (!confirmed) return
    setBusyId(`delete-${user.id}`)
    setMessage('')
    setError('')
    try {
      const data = await callAdminFunction({ action: 'delete-one', target: 'user', id: user.id })
      setMessage(`Usuário ${user.full_name} apagado.${data.auth_deleted ? ' Acesso Auth removido também.' : ''}`)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  async function cleanupData(target: CleanupTarget) {
    setBusyId(`cleanup-${target}`)
    setMessage('')
    setError('')
    try {
      const data = await callAdminFunction({ action: 'cleanup-data', target, confirm: cleanupConfirm[target] }) as CleanupResult
      setCleanupConfirm((current) => ({ ...current, [target]: '' }))
      const extra = data.auth_deleted ? ` Também apagou ${data.auth_deleted} usuários de acesso.` : ''
      const custom = data.custom_values_deleted ? ` Limpou ${data.custom_values_deleted} valores customizados.` : ''
      setMessage(`${data.deleted ?? 0} registros apagados de ${cleanupItems.find((item) => item.target === target)?.label.toLowerCase()}.${extra}${custom}`)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId('')
    }
  }

  return <div className="h-full overflow-y-auto p-5">
    <div className="space-y-5">
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Settings size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Admin de usuários</h2></div>
            <div className="flex gap-2 text-xs font-semibold"><Badge tone="bg-blue-100 text-blue-700">{users.length} usuários</Badge><Badge tone="bg-emerald-100 text-emerald-700">{companies.length} empresas de acesso</Badge></div>
          </div>
          <p className="mt-2 text-sm text-slate-500">Crie usuários do BPO CRM, associe cada um a uma empresa e envie o email para definição de senha. Cada negócio deve ter um proprietário e usuários comuns enxergam apenas os negócios deles.</p>
          {message && <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</p>}
        </div>

        <form onSubmit={createUser} className="grid gap-3 border-b border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_1fr_150px]">
          <input value={newUser.full_name} onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Nome do usuário" required />
          <input value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="email@empresa.com" type="email" required />
          <input value={newUser.company_name} onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Empresa" list="crm-companies-list" required />
          <datalist id="crm-companies-list">{companies.map((company) => <option key={company.id} value={company.name} />)}</datalist>
          <button disabled={busyId === 'create'} className="rounded bg-[#238847] px-3 py-2 text-sm font-bold text-white disabled:opacity-60">{busyId === 'create' ? 'Criando...' : 'Criar usuário'}</button>
        </form>

        <div className="divide-y divide-slate-100">
          {users.map((user) => <div key={user.id} className="p-4 text-sm hover:bg-slate-50">
            <div className="grid gap-3 md:grid-cols-[1.1fr_1.1fr_1fr_100px_1fr_150px_150px_100px]">
              <div><b>{user.full_name}</b><p className="mt-1 text-xs text-slate-500">ID usuário: <code>{user.id}</code></p></div>
              <div className="text-slate-600">{user.email}</div>
              <div><b>{user.crm_companies?.name || 'Sem empresa'}</b><p className="mt-1 text-xs text-slate-500">ID empresa: <code>{user.company_id}</code></p></div>
              <div><Badge tone={user.status === 'active' ? 'bg-emerald-100 text-emerald-700' : user.status === 'invited' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>{user.status}</Badge></div>
              <input value={passwordDrafts[user.id] || ''} onChange={(e) => setPasswordDrafts((current) => ({ ...current, [user.id]: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Senha inicial" type="text" autoComplete="new-password" />
              <button onClick={() => void setInitialPassword(user)} disabled={busyId === `password-${user.id}` || !(passwordDrafts[user.id] || '').trim()} className="rounded border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{busyId === `password-${user.id}` ? 'Salvando...' : 'Definir senha'}</button>
              <button onClick={() => void sendAccessEmail(user)} disabled={busyId === user.id} className="rounded border border-[#238847] px-3 py-2 text-sm font-bold text-[#238847] hover:bg-emerald-50 disabled:opacity-60">{busyId === user.id ? 'Enviando...' : user.auth_user_id ? 'Redefinir senha' : 'Enviar acesso'}</button>
              <button type="button" onClick={() => void deleteUser(user)} disabled={busyId === `delete-${user.id}`} className="rounded border border-rose-200 px-3 py-2 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-60">{busyId === `delete-${user.id}` ? 'Apagando...' : 'Apagar'}</button>
            </div>
            <CrmUserTallyDetails user={user} />
          </div>)}
          {!users.length && <div className="p-8 text-center text-slate-400">Nenhum usuário cadastrado.</div>}
        </div>
      </Panel>

      <Panel className="overflow-hidden border-rose-200">
        <div className="border-b border-rose-200 bg-rose-50 p-4">
          <h2 className="text-lg font-bold text-rose-900">Limpeza de dados</h2>
          <p className="mt-2 text-sm text-rose-800">Ação irreversível. Para habilitar um botão, digite <b>APAGAR</b> no campo daquela linha. Cada botão apaga apenas o tipo de dado indicado.</p>
        </div>
        <div className="divide-y divide-rose-100">
          {cleanupItems.map((item) => <div key={item.target} className="grid gap-3 p-4 text-sm md:grid-cols-[1fr_110px_160px_160px]">
            <div>
              <b className="text-slate-900">{item.label}</b>
              <p className="mt-1 text-xs text-slate-500">{item.description}</p>
            </div>
            <Badge tone="bg-slate-100 text-slate-700">{item.count} registros</Badge>
            <input value={cleanupConfirm[item.target]} onChange={(e) => setCleanupConfirm((current) => ({ ...current, [item.target]: e.target.value }))} className="rounded border border-rose-200 px-3 py-2 text-sm outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-100" placeholder="APAGAR" />
            <button type="button" onClick={() => void cleanupData(item.target)} disabled={busyId === `cleanup-${item.target}` || cleanupConfirm[item.target] !== 'APAGAR'} className="rounded bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">{busyId === `cleanup-${item.target}` ? 'Apagando...' : item.label}</button>
          </div>)}
        </div>
      </Panel>
    </div>
  </div>
}

function ListViewDeals({ deals, stages, dealLabelAssignments, selectedId, setSelectedId, openDealPage, canDelete = false, deleteDeal }: { deals: Deal[]; stages: Stage[]; dealLabelAssignments: DealLabelAssignment[]; selectedId?: string; setSelectedId: (id: string) => void; openDealPage: (id: string) => void; canDelete?: boolean; deleteDeal?: (id: string, label: string) => void }) {
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name || ''
  const labelsForDeal = (dealId: string) => dealLabelAssignments.filter((assignment) => assignment.deal_id === dealId && assignment.deal_labels).map((assignment) => assignment.deal_labels as DealLabel)
  return <div className="min-h-0 flex-1 overflow-auto">
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase text-slate-500">
          <th className="px-4 py-3">Negócio</th>
          <th className="px-4 py-3">Empresa</th>
          <th className="px-4 py-3">Etiquetas</th>
          <th className="px-4 py-3">Contato</th>
          <th className="px-4 py-3">Etapa</th>
          <th className="px-4 py-3">Valor</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Data esperada de Fechamento</th>
          {canDelete && <th className="px-4 py-3">Ação</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {deals.map((deal) => <tr key={deal.id} onClick={() => { setSelectedId(deal.id); openDealPage(deal.id) }} className={cn('cursor-pointer transition hover:bg-blue-50', selectedId === deal.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : '')}>
          <td className="px-4 py-3 font-semibold text-slate-900">{deal.title}</td>
          <td className="px-4 py-3 text-slate-600">{deal.organizations?.name || '-'}</td>
          <td className="px-4 py-3"><DealLabelPills labels={labelsForDeal(deal.id)} /></td>
          <td className="px-4 py-3 text-slate-600">{deal.people?.full_name || '-'}</td>
          <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{stageName(deal.stage_id || '') || '-'}</span></td>
          <td className="px-4 py-3 font-semibold text-slate-800">{money(deal.value)}</td>
          <td className="px-4 py-3"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', deal.status === 'ganho' ? 'bg-green-100 text-green-700' : deal.status === 'perdido' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700')}>{statusLabel[deal.status || 'aberto'] || 'Aberto'}</span></td>
          <td className="px-4 py-3 text-slate-500">{deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString('pt-BR') : '-'}</td>
          {canDelete && <td className="px-4 py-3"><button type="button" onClick={(e) => { e.stopPropagation(); deleteDeal?.(deal.id, deal.title) }} className="rounded border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50">Apagar</button></td>}
        </tr>)}
      </tbody>
    </table>
    {deals.length === 0 && <div className="p-8 text-center text-slate-400">Nenhum negócio encontrado.</div>}
  </div>
}

function ForecastView({ deals, stages, selectedId, setSelectedId, openDealPage }: { deals: Deal[]; stages: Stage[]; selectedId?: string; setSelectedId: (id: string) => void; openDealPage: (id: string) => void }) {
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name || ''
  const byMonth: Record<string, { deals: Deal[]; total: number; won: number }> = {}
  deals.forEach((deal) => {
    const date = deal.expected_close_date ? new Date(deal.expected_close_date) : new Date()
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    if (!byMonth[key]) byMonth[key] = { deals: [], total: 0, won: 0 }
    byMonth[key].deals.push(deal)
    byMonth[key].total += Number(deal.value || 0)
    if (deal.status === 'ganho') byMonth[key].won += Number(deal.value || 0)
  })
  const sorted = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b))
  const months: Record<string, string> = { '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr', '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez' }

  return <div className="min-h-0 flex-1 overflow-auto">
    {sorted.map(([key, group]) => {
      const [year, month] = key.split('-')
      const pctWon = group.total > 0 ? Math.round((group.won / group.total) * 100) : 0
      return <div key={key} className="border-b border-slate-200">
        <div className="flex items-center gap-4 bg-slate-50 px-5 py-3">
          <h2 className="text-lg font-bold text-slate-800">{months[month] || month} {year}</h2>
          <span className="text-sm text-slate-500">{group.deals.length} negócios</span>
          <span className="text-sm font-semibold text-slate-700">Previsto: {money(group.total)}</span>
          <span className="text-sm font-semibold text-green-700">Ganho: {money(group.won)}</span>
          <div className="ml-auto h-3 w-48 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pctWon}%` }}/>
          </div>
          <span className="text-xs font-semibold text-slate-600">{pctWon}%</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase text-slate-400">
              <th className="px-5 py-2">Negócio</th>
              <th className="px-5 py-2">Empresa</th>
              <th className="px-5 py-2">Etapa</th>
              <th className="px-5 py-2">Valor</th>
              <th className="px-5 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {group.deals.map((deal) => <tr key={deal.id} onClick={() => { setSelectedId(deal.id); openDealPage(deal.id) }} className={cn('cursor-pointer transition hover:bg-blue-50', selectedId === deal.id ? 'bg-blue-50' : '')}>
              <td className="px-5 py-2 font-semibold text-slate-900">{deal.title}</td>
              <td className="px-5 py-2 text-slate-600">{deal.organizations?.name || '-'}</td>
              <td className="px-5 py-2"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{stageName(deal.stage_id || '') || '-'}</span></td>
              <td className="px-5 py-2 font-semibold text-slate-800">{money(deal.value)}</td>
              <td className="px-5 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', deal.status === 'ganho' ? 'bg-green-100 text-green-700' : deal.status === 'perdido' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700')}>{statusLabel[deal.status || 'aberto'] || 'Aberto'}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    })}
    {sorted.length === 0 && <div className="p-8 text-center text-slate-400">Nenhum negócio com data prevista.</div>}
  </div>
}

export default App
