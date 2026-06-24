import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  Building2,
  CalendarClock,
  ChevronDown,
  CheckCircle2,
  Contact,
  Filter,
  GripVertical,
  LayoutDashboard,
  List,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tags,
  Workflow,
} from 'lucide-react'
import { supabase, supabaseConfigured, type ActivityRow, type CrmCompany, type CrmUser, type CustomField, type CustomFieldValue, type Deal, type HistoryRow, type Organization, type Person, type Profile, type Stage } from './supabase'
import './App.css'

type View = 'pipeline' | 'contacts' | 'companies' | 'activities' | 'fields' | 'admin'
type NewDeal = {
  title: string
  organization_name: string
  contact_name: string
  contact_email: string
  contact_phone: string
  value: string
  monthly_purchase: string
  plan: string
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

const blankNewDeal = (): NewDeal => ({
  title: '',
  organization_name: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  value: '',
  monthly_purchase: '',
  plan: '',
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
  estimated_savings: string
  probability: string
  score: string
  source: string
  plan: string
  expected_close_date: string
  focus_items: string
  organization_name: string
  organization_segment: string
  organization_city: string
  organization_state: string
  organization_cnpjs: string
  organization_supplier_count: string
  person_name: string
  person_role: string
  person_email: string
  person_phone: string
}

const money = (value?: number | null) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(Number(value || 0))

const statusLabel: Record<string, string> = { quente: 'Quente', morno: 'Morno', risco: 'Risco', ganho: 'Ganho', perdido: 'Perdido' }

function cn(...classes: Array<string | false | undefined | null>) { return classes.filter(Boolean).join(' ') }
function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tone || 'bg-slate-100 text-slate-600')}>{children}</span>
}
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded border border-slate-200 bg-white', className)}>{children}</section>
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    const res = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (res.error) setMessage(res.error.message)
    else setMessage('Login efetuado.')
  }

  return (
    <main className="min-h-screen bg-[#f5f6f8] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-5 py-8">
        <div className="grid w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.12)] lg:grid-cols-[0.92fr_1.08fr]">
          <section className="flex flex-col justify-center px-7 py-10 md:px-12 lg:px-14">
            <div className="mb-10 flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#211746] text-[14px] font-black tracking-[-0.08em] text-white shadow-sm">VM</div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-[#2cbf6d]">VMarket</p>
                <h1 className="text-lg font-black text-[#211746]">CRM programa de parceria BPO VMarket</h1>
              </div>
            </div>

            <div className="max-w-md">
              <p className="mb-2 text-sm font-semibold text-slate-500">Bem-vindo de volta</p>
              <h2 className="text-3xl font-bold tracking-[-0.04em] text-slate-950">Entrar no CRM</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">Acesse o funil de parceiros BPO, acompanhe negócios, atividades e previsões de vendas da operação VMarket.</p>
            </div>

            {!supabaseConfigured && <p className="mt-6 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-100">Supabase não configurado no ambiente.</p>}

            <form onSubmit={submit} className="mt-8 max-w-md space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Email</span>
                <input className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#2cbf6d] focus:ring-4 focus:ring-emerald-100" placeholder="email@empresa.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Senha</span>
                <input className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#2cbf6d] focus:ring-4 focus:ring-emerald-100" placeholder="Digite sua senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <button disabled={busy} className="w-full rounded-lg bg-[#2cbf6d] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#26a961] disabled:opacity-60">{busy ? 'Aguarde...' : 'Entrar'}</button>
            </form>

            <div className="mt-5 max-w-md text-sm text-slate-500">
              Acesso apenas por convite enviado pelo administrador do CRM.
            </div>

            {message && <p className="mt-5 max-w-md rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-100">{message}</p>}
          </section>

          <section className="relative hidden min-h-[680px] overflow-hidden bg-[#211746] p-10 text-white lg:block">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#6f5cf6]/50 blur-2xl" />
            <div className="absolute -bottom-28 left-16 h-80 w-80 rounded-full bg-[#2cbf6d]/35 blur-2xl" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold ring-1 ring-white/15">
                  <CheckCircle2 size={16} className="text-emerald-300" /> Pipeline, lista e previsão de vendas
                </div>
                <h3 className="mt-8 max-w-lg text-5xl font-black leading-[0.95] tracking-[-0.05em]">CRM para acelerar o programa de parceria BPO.</h3>
                <p className="mt-5 max-w-md text-base leading-7 text-white/70">Interface inspirada no Pipedrive, adaptada para gestão de parceiros, oportunidades e forecast da VMarket.</p>
              </div>

              <div className="relative mt-10 rounded-2xl bg-white/95 p-4 text-slate-900 shadow-2xl ring-1 ring-white/20">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Pipeline BPO</p>
                    <h4 className="text-lg font-black">Negócios ativos</h4>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">VMarket</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {['Kanban', 'Lista Excel', 'Previsão'].map((item, index) => <div key={item} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className={cn('mb-3 h-1.5 rounded-full', index === 0 ? 'bg-[#6f5cf6]' : index === 1 ? 'bg-[#2cbf6d]' : 'bg-[#ff695f]')} />
                    <p className="text-xs font-bold text-slate-700">{item}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{index === 0 ? 'Funil' : index === 1 ? 'Tabela' : 'Datas'}</p>
                  </div>)}
                </div>
                <div className="mt-4 space-y-2">
                  {['Lead diagnóstico BPO', 'Proposta VMarket', 'Onboarding parceiro'].map((item, index) => <div key={item} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm">
                    <div className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span><span className="text-sm font-semibold">{item}</span></div>
                    <span className="text-xs font-bold text-slate-500">R$ {(index + 2) * 399}</span>
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
  const visibleDeals = useMemo(() => {
    const visibleStageIds = new Set(visibleStages.map((stage) => stage.id))
    return visibleStageIds.size ? deals.filter((deal) => deal.stage_id && visibleStageIds.has(deal.stage_id)) : deals
  }, [deals, visibleStages])

  const detailDeal = useMemo(() => deals.find((d) => d.id === detailDealId), [deals, detailDealId])
  const totals = useMemo(() => ({
    value: deals.reduce((acc, d) => acc + Number(d.value || 0), 0),
    gmv: deals.reduce((acc, d) => acc + Number(d.monthly_purchase || 0), 0),
    openActivities: activities.filter((a) => a.status === 'open').length,
  }), [deals, activities])

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
      const [profileRes, stagesRes, crmUsersRes, crmCompaniesRes, orgRes, peopleRes, dealsRes, actsRes, histRes, fieldsRes, valuesRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session!.user.id).maybeSingle(),
        supabase.from('pipeline_stages').select('*').order('sort_order'),
        supabase.from('crm_users').select('*, crm_companies(*)').order('full_name'),
        supabase.from('crm_companies').select('*').order('name'),
        supabase.from('organizations').select('*').order('created_at', { ascending: false }),
        supabase.from('people').select('*').order('created_at', { ascending: false }),
        supabase.from('deals').select('*, organizations(*), people(*), bpo_partners(*), pipeline_stages(*)').order('created_at', { ascending: false }),
        supabase.from('activities').select('*').order('due_at', { ascending: true }),
        supabase.from('deal_history').select('*').order('created_at', { ascending: false }),
        supabase.from('custom_fields').select('*').order('sort_order'),
        supabase.from('custom_field_values').select('*'),
      ])
      const firstError = [profileRes, stagesRes, crmUsersRes, crmCompaniesRes, orgRes, peopleRes, dealsRes, actsRes, histRes, fieldsRes, valuesRes].find((r) => r.error)?.error
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
        status: null,
        source: null,
        plan: newDeal.plan || null,
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

  async function syncExistingDealToPipedriveIfSalesPipeline(dealId: string, stageId: string) {
    if (!isSalesPipelineStage(stageId)) return
    const syncRes = await supabase.functions.invoke('pipedrive-sync', { body: { action: 'sync-existing-deal-to-pipedrive', deal_id: dealId } })
    if (syncRes.error) throw syncRes.error
    if (syncRes.data?.error) throw new Error(String(syncRes.data.error))
    if (syncRes.data?.ignored) return
    await supabase.from('deal_history').insert({
      deal_id: dealId,
      event_type: 'Integração',
      title: 'Campos sincronizados com Pipedrive',
      description: `Pipeline de Vendas sincronizado. Pipedrive deal ID ${syncRes.data?.pipedrive_deal_id || 'existente'}`,
    })
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
        await syncExistingDealToPipedriveIfSalesPipeline(dealId, stageId)
        await loadAll()
        setSelectedId(dealId)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }

  async function completeActivity(id: string) {
    const { error } = await supabase.from('activities').update({ status: 'done' }).eq('id', id)
    if (error) setError(error.message)
    else await loadAll()
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

  function handleDrop(e: DragEvent, stageId: string) {
    e.preventDefault()
    if (draggingId) void moveDeal(stageId, draggingId)
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

  async function saveDeal(form: DealForm, customValues: Record<string, string>) {
    if (!detailDeal) return
    setError('')
    const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value)
    const canManageCustomFields = profile?.role === 'admin_vmarket'
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
        value: numberOrNull(form.value),
        monthly_purchase: numberOrNull(form.monthly_purchase),
        estimated_savings: numberOrNull(form.estimated_savings),
        probability: numberOrNull(form.probability),
        score: numberOrNull(form.score),
        source: form.source || null,
        plan: form.plan || null,
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
          supplier_count: numberOrNull(form.organization_supplier_count),
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

      if (form.stage_id) await syncExistingDealToPipedriveIfSalesPipeline(detailDeal.id, form.stage_id)

      await supabase.from('deal_history').insert({ deal_id: detailDeal.id, event_type: 'Edição', title: 'Ficha do negócio atualizada', description: 'Campos editados na URL da ficha completa e sincronizados com Pipedrive quando aplicável.' })
      await loadAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  if (!session) return <Login />

  if (detailDealId) {
    const isAdmin = profile?.role === 'admin_vmarket'
    return <DealPage key={detailDealId} deal={detailDeal} loading={loading} error={error} stages={salesStages} crmUsers={crmUsers} canEditOwner={isAdmin} canViewCustomFields={isAdmin} activities={activities.filter((a) => a.deal_id === detailDealId)} history={history.filter((h) => h.deal_id === detailDealId)} activePipeline="Pipeline de Vendas" closeDealPage={closeDealPage} saveDeal={saveDeal} createActivity={createActivityForDeal} customFields={isAdmin ? customFields.filter((field) => field.entity === 'deal') : []} customFieldValues={isAdmin ? customFieldValues.filter((value) => value.entity_id === detailDealId) : []} completeActivity={completeActivity} />
  }

  const navItems: Array<[View, ReactNode, string]> = [
    ['pipeline', <LayoutDashboard size={19}/>, 'Negócios'],
    ['contacts', <Contact size={19}/>, 'Contatos'],
    ['companies', <Building2 size={19}/>, 'Empresas'],
    ['activities', <Activity size={19}/>, 'Atividades'],
  ]
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
            <button onClick={() => setActiveView('pipeline')} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><Plus size={19}/></button>
            <button onClick={loadAll} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><RefreshCw size={17}/></button>
            <div className="hidden items-center gap-2 sm:flex"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{profile?.full_name?.slice(0,1) || 'V'}</span><span className="text-xs font-semibold leading-tight text-slate-700">VMarket<br/><span className="font-normal text-slate-500">BPO CRM</span></span></div>
            <button onClick={() => supabase.auth.signOut()} className="hidden rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:block">Sair</button>
          </header>

          <section className="min-h-0 flex-1 overflow-auto md:overflow-hidden">
            {error && <div className="m-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><b>Erro:</b> {error}</div>}
            {loading ? <div className="m-4 rounded bg-white p-4 text-sm shadow-sm">Carregando dados do Supabase...</div> : (
              <>
                {activeView === 'pipeline' && <PipelineView stages={visibleStages} salesStages={salesStages} deals={visibleDeals} selectedId={selectedId} setSelectedId={setSelectedId} openDealPage={openDealPage} setDraggingId={setDraggingId} handleDrop={handleDrop} totals={totals} newDeal={newDeal} setNewDeal={setNewDeal} createDeal={createDeal} creating={creating} crmUsers={crmUsers} canAssignOwner={profile?.role === 'admin_vmarket'} activePipeline={activePipeline} setActivePipeline={setActivePipeline} pipelineNames={pipelineNames} pipelineView={pipelineView} setPipelineView={setPipelineView} />}
                {activeView === 'contacts' && <ListView title="Contatos" icon={<Contact size={18}/>} rows={people.map((p) => ({ id: p.id, title: p.full_name, sub: `${p.role_title || 'Contato'} · ${p.email || 'sem email'}`, meta: p.phone || 'sem telefone' }))} />}
                {activeView === 'companies' && <ListView title="Empresas" icon={<Building2 size={18}/>} rows={organizations.map((o) => ({ id: o.id, title: o.name, sub: `${o.segment || 'Segmento não informado'} · ${o.city || ''} ${o.state || ''}`, meta: money(o.monthly_purchase) }))} />}
                {activeView === 'activities' && <ActivitiesView activities={activities} deals={deals} completeActivity={completeActivity} />}
                {activeView === 'fields' && profile?.role === 'admin_vmarket' && <FieldsConfigView fields={customFields} setError={setError} reload={loadAll} />}
                {activeView === 'admin' && profile?.role === 'admin_vmarket' && <AdminUsersView users={crmUsers} companies={crmCompanies} reload={loadAll} setError={setError} />}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function PipelineView({ stages, salesStages, deals, selectedId, setSelectedId, openDealPage, setDraggingId, handleDrop, totals, newDeal, setNewDeal, createDeal, creating, crmUsers, canAssignOwner, activePipeline, setActivePipeline, pipelineNames, pipelineView, setPipelineView }: {
  stages: Stage[]
  salesStages: Stage[]
  deals: Deal[]
  selectedId?: string
  setSelectedId: (id: string) => void
  openDealPage: (id: string) => void
  setDraggingId: (id: string | null) => void
  handleDrop: (e: DragEvent, stageId: string) => void
  totals: { value: number; gmv: number; openActivities: number }
  newDeal: NewDeal
  setNewDeal: (deal: NewDeal) => void
  createDeal: (e: FormEvent) => Promise<void>
  creating: boolean
  crmUsers: CrmUser[]
  canAssignOwner: boolean
  activePipeline: string
  setActivePipeline: (pipeline: string) => void
  pipelineNames: string[]
  pipelineView: 'kanban' | 'list' | 'forecast'
  setPipelineView: (view: 'kanban' | 'list' | 'forecast') => void
}) {
  const [showCreateDeal, setShowCreateDeal] = useState(false)
  const submitCreateDeal = async (e: FormEvent) => {
    await createDeal(e)
    setShowCreateDeal(false)
  }

  return <div className="flex min-h-[calc(100vh-7.5rem)] flex-col md:h-full md:min-h-0">
    <div className="border-b border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 md:h-12 md:flex-nowrap md:px-4 md:py-0">
        <div className="flex overflow-hidden rounded border border-slate-300">
          <button onClick={() => setPipelineView('kanban')} className={cn('grid h-11 w-12 place-items-center md:h-8 md:w-9', pipelineView === 'kanban' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Kanban" aria-label="Kanban"><GripVertical size={15}/></button>
          <button onClick={() => setPipelineView('list')} className={cn('grid h-11 w-12 place-items-center border-l border-slate-300 md:h-8 md:w-9', pipelineView === 'list' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Lista" aria-label="Lista"><List size={15}/></button>
          <button onClick={() => setPipelineView('forecast')} className={cn('grid h-11 w-12 place-items-center border-l border-slate-300 md:h-8 md:w-9', pipelineView === 'forecast' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Previsão" aria-label="Previsão"><CalendarClock size={15}/></button>
        </div>
        <button onClick={() => setShowCreateDeal(true)} className="h-11 rounded-l border border-[#087d3e] bg-[#238847] px-3 text-sm font-semibold text-white shadow-sm hover:bg-[#1f7a40] md:h-auto md:py-1.5">+ Deal</button>
        <button onClick={() => setShowCreateDeal(true)} className="-ml-2 grid h-11 place-items-center rounded-r border border-[#087d3e] bg-[#1f7a40] px-3 text-sm font-semibold text-white md:h-auto md:py-1.5"><ChevronDown size={14}/></button>
        <button className="h-11 rounded border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50 md:ml-1 md:h-auto md:py-1.5">Adicionar condição</button>
        <div className="flex w-full flex-wrap items-center gap-2 text-sm text-slate-600 md:ml-auto md:w-auto md:flex-nowrap">
          <span><b>{deals.length}</b> negócios · {money(totals.value)}</span>
          <span className="hidden text-slate-300 md:inline">|</span>
          <label className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-700">
            <Workflow size={15}/>
            <select value={activePipeline} onChange={(e) => setActivePipeline(e.target.value)} className="max-w-[190px] bg-transparent text-sm outline-none">
              {(pipelineNames.length ? pipelineNames : ['Pipeline de Vendas']).map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
          <button className="hidden h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 md:grid">✎</button>
          <button className="hidden h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 md:grid">ⓘ</button>
          <button className="h-9 rounded border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 md:h-auto md:py-1.5"><Filter size={14} className="inline"/> Filtro</button>
          <button className="hidden h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 md:grid"><MoreHorizontal size={17}/></button>
        </div>
      </div>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-500 md:h-8 md:flex-nowrap md:px-4 md:py-0">
        <span><Filter size={12} className="inline"/> Add condition</span>
        <span className="font-semibold text-blue-600">Sort by: Next activity ▾</span>
      </div>
    </div>

    {pipelineView === 'kanban' ? <div className="min-h-0 flex-1 overflow-x-auto overflow-y-visible p-3 md:overflow-y-hidden md:p-4">
      <div className="flex min-h-[420px] gap-3 md:h-full md:min-w-max">
        {stages.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage_id === stage.id)
          const stageValue = stageDeals.reduce((acc, d) => acc + Number(d.value || 0), 0)
          return <div key={stage.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)} className="flex max-h-[65vh] min-w-[78vw] flex-col bg-[#f0f2f4] ring-1 ring-slate-200 sm:min-w-[320px] md:h-full md:w-[160px] md:min-w-0 xl:w-[180px]">
            <div className="border-b border-slate-200 bg-white/60 p-2">
              <div className="flex items-center justify-between gap-1">
                <p className="truncate text-sm font-bold text-slate-800">{stage.name}</p>
                <button onClick={() => { setNewDeal({ ...blankNewDeal(), stage_id: stage.id }); setShowCreateDeal(true) }} className="grid h-6 w-6 shrink-0 place-items-center rounded border border-slate-300 bg-white text-slate-500 hover:bg-slate-50">+</button>
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-500">{money(stageValue)} · {stageDeals.length} negócios</p>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
              {stageDeals.map((deal) => <button key={deal.id} draggable onDragStart={() => setDraggingId(deal.id)} onDragEnd={() => setDraggingId(null)} onClick={() => openDealPage(deal.id)} className={cn('group w-full rounded border p-2 text-left shadow-sm transition hover:shadow-md cursor-pointer', selectedId === deal.id ? 'border-blue-300 bg-[#fff3f0] ring-2 ring-blue-200/70' : 'border-[#eadfda] bg-[#fff2ef] hover:border-blue-200')}>
                <div className="mb-1.5 flex items-center gap-1">
                  <span className="h-1 w-8 rounded-full bg-[#5c7cfa]" />
                  <span className="h-1 w-8 rounded-full bg-[#e6509c]" />
                </div>
                <p className="line-clamp-2 text-sm font-bold leading-snug text-slate-900">{deal.title}</p>
                <p className="mt-1 truncate text-xs text-slate-600">{deal.organizations?.name || 'Sem empresa'}</p>
                <p className="truncate text-xs text-slate-500">{deal.people?.full_name || 'Sem contato'}</p>
                <div className="mt-2 flex items-center justify-end">
                  <span className="text-[11px] font-semibold text-slate-700">{money(deal.value)}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[10px] text-slate-500">{deal.people?.full_name?.slice(0,1) || '•'}</span>
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#ff695f] text-xs font-bold text-white">‹</span>
                </div>
              </button>)}
              {stageDeals.length === 0 && <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">Solte cards aqui</div>}
            </div>
          </div>
        })}
      </div>
    </div> : pipelineView === 'list' ? <ListViewDeals deals={deals} stages={stages} selectedId={selectedId} setSelectedId={setSelectedId} openDealPage={openDealPage} /> : <ForecastView deals={deals} stages={stages} selectedId={selectedId} setSelectedId={setSelectedId} openDealPage={openDealPage} />}

    {showCreateDeal && <CreateDealModal salesStages={salesStages} crmUsers={crmUsers} canAssignOwner={canAssignOwner} newDeal={newDeal} setNewDeal={setNewDeal} createDeal={submitCreateDeal} creating={creating} close={() => { setShowCreateDeal(false); setNewDeal(blankNewDeal()) }} />}
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
        <EditInput label="Plano recomendado" value={newDeal.plan} onChange={(v) => setNewDeal({ ...newDeal, plan: v })} />
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

function DealPage({ deal, loading, error, stages, crmUsers, canEditOwner, canViewCustomFields, activities, history, customFields, customFieldValues, activePipeline, closeDealPage, saveDeal, createActivity, completeActivity }: {
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
  activePipeline: string
  closeDealPage: () => void
  saveDeal: (form: DealForm, customValues: Record<string, string>) => Promise<void>
  createActivity: (activity: NewActivity) => Promise<void>
  completeActivity: (id: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [creatingActivity, setCreatingActivity] = useState(false)
  const [activityDraft, setActivityDraft] = useState<NewActivity>(() => blankNewActivity())
  const [form, setForm] = useState<DealForm>(() => dealToForm(deal))
  const [customDrafts, setCustomDrafts] = useState<Record<string, string>>(() => customValuesToDrafts(customFields, customFieldValues))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      await saveDeal(form, customDrafts)
      setSaved(true)
    } finally {
      setSaving(false)
    }
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

  if (loading) return <main className="min-h-screen bg-[#f4f5f7] p-5 text-slate-900"><div className="rounded bg-white p-4 shadow-sm">Carregando ficha do negócio...</div></main>
  if (!deal) return <main className="min-h-screen bg-[#f4f5f7] p-5 text-slate-900"><div className="rounded bg-white p-6 shadow-sm"><h1 className="text-xl font-bold">Negócio não encontrado</h1><button onClick={closeDealPage} className="mt-4 rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white">Voltar ao funil</button></div></main>

  const update = (key: keyof DealForm, value: string) => setForm((current) => ({ ...current, [key]: value }))

  return <main className="min-h-screen bg-[#f4f5f7] text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <button onClick={closeDealPage} className="rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">← Voltar ao funil</button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-blue-600">{activePipeline} → {stages.find((s) => s.id === deal.stage_id)?.name || 'Sem etapa'}</p>
          <h1 className="truncate text-2xl font-semibold tracking-[-0.03em] text-slate-950">{deal.title}</h1>
        </div>
        {saved && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">Salvo</span>}
        <button form="deal-edit-form" disabled={saving} className="rounded bg-[#238847] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar alterações'}</button>
      </div>
    </header>

    <form id="deal-edit-form" onSubmit={submit} className="mx-auto grid max-w-7xl gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      {error && <div className="xl:col-span-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><b>Erro:</b> {error}</div>}

      <section className="space-y-4">
        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Dados principais do negócio</h2>
            <p className="mt-1 text-sm text-slate-500">Todos os campos da ficha lateral agora ficam em uma URL própria e editável.</p>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <EditInput label="Título do negócio" value={form.title} onChange={(v) => update('title', v)} className="md:col-span-2" />
            <EditSelect label="Etapa" value={form.stage_id} onChange={(v) => update('stage_id', v)} options={stages.map((s) => [s.id, s.name])} />
            <EditSelect label="Status" value={form.status} onChange={(v) => update('status', v)} options={Object.entries(statusLabel)} />
            <EditInput label="Valor do negócio" value={form.value} onChange={(v) => update('value', v)} type="number" />
            <EditInput label="GMV mensal" value={form.monthly_purchase} onChange={(v) => update('monthly_purchase', v)} type="number" />
            <EditInput label="Data esperada de fechamento" value={form.expected_close_date} onChange={(v) => update('expected_close_date', v)} type="date" />
            <EditInput label="Fonte" value={form.source} onChange={(v) => update('source', v)} />
            <EditInput label="Plano recomendado" value={form.plan} onChange={(v) => update('plan', v)} />
            {canEditOwner && <EditSelect label="Proprietário do negócio" value={form.owner_id} onChange={(v) => update('owner_id', v)} options={[[deal.owner_id || '', deal.owner_id ? 'Proprietário atual' : 'Sem proprietário'], ...crmUsers.filter((u) => u.auth_user_id).map((u) => [u.auth_user_id || '', `${u.full_name} · ${u.crm_companies?.name || 'sem empresa'}`] as [string, string])]} />}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4"><h2 className="text-lg font-bold">Empresa e contato</h2></div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <EditInput label="Empresa" value={form.organization_name} onChange={(v) => update('organization_name', v)} />
            <EditInput label="Segmento" value={form.organization_segment} onChange={(v) => update('organization_segment', v)} />
            <EditInput label="Cidade" value={form.organization_city} onChange={(v) => update('organization_city', v)} />
            <EditInput label="Estado" value={form.organization_state} onChange={(v) => update('organization_state', v)} />
            <EditInput label="Quantidade de CNPJs" value={form.organization_cnpjs} onChange={(v) => update('organization_cnpjs', v)} type="number" />
            <EditInput label="Quantidade de fornecedores" value={form.organization_supplier_count} onChange={(v) => update('organization_supplier_count', v)} type="number" />
            <EditInput label="Pessoa" value={form.person_name} onChange={(v) => update('person_name', v)} />
            <EditInput label="Cargo" value={form.person_role} onChange={(v) => update('person_role', v)} />
            <EditInput label="Email" value={form.person_email} onChange={(v) => update('person_email', v)} type="email" />
            <EditInput label="Telefone" value={form.person_phone} onChange={(v) => update('person_phone', v)} />
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4"><h2 className="text-lg font-bold">Focus e notas do negócio</h2></div>
          <div className="p-4">
            <label className="block text-sm font-semibold text-slate-700">Itens de foco, um por linha</label>
            <textarea value={form.focus_items} onChange={(e) => update('focus_items', e.target.value)} rows={7} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Diagnóstico gratuito&#10;Enviar proposta&#10;Follow-up" />
          </div>
        </Panel>

        {canViewCustomFields && <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4">
            <h2 className="text-lg font-bold">Campos configuráveis do negócio</h2>
            <p className="mt-1 text-sm text-slate-500">Esses campos vêm da tabela custom_fields e os valores são gravados em custom_field_values por ID do negócio.</p>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            {customFields.length ? customFields.map((field) => <CustomFieldInput key={field.id} field={field} value={customDrafts[field.id] || ''} onChange={(value) => setCustomDrafts((current) => ({ ...current, [field.id]: value }))} />) : <p className="text-sm text-slate-500 md:col-span-2">Nenhum campo customizado de negócio configurado ainda. Use a aba Campos para criar.</p>}
          </div>
        </Panel>}
      </section>

      <aside className="space-y-4">
        <Panel className="overflow-hidden">
          <div className="grid gap-3 p-4 text-sm">
            <FieldLine label="Pessoa" value={form.person_name || 'Sem contato'} blue />
            <FieldLine label="Empresa" value={form.organization_name || 'Sem empresa'} blue />
            <FieldLine label="Valor" value={money(Number(form.value || 0))} />
            <FieldLine label="Status" value={statusLabel[form.status] || form.status || 'Sem status'} />
            <FieldLine label="Data esperada" value={form.expected_close_date || 'Sem data'} />
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2"><CalendarClock size={17}/><h2 className="font-bold">Atividades</h2></div>
            <Badge tone="bg-blue-100 text-blue-700">{activities.length} registradas</Badge>
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
              <div className="grid gap-2">
                <input value={activityDraft.title} onChange={(e) => setActivityDraft((current) => ({ ...current, title: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Título da atividade" />
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                  <select value={activityDraft.activity_type} onChange={(e) => setActivityDraft((current) => ({ ...current, activity_type: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100">
                    <option value="task">Tarefa</option>
                    <option value="call">Ligação</option>
                    <option value="meeting">Reunião</option>
                    <option value="email">Email</option>
                    <option value="whatsapp">WhatsApp</option>
                  </select>
                  <input type="date" value={activityDraft.due_date} onChange={(e) => setActivityDraft((current) => ({ ...current, due_date: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" />
                  <input type="time" value={activityDraft.due_time} onChange={(e) => setActivityDraft((current) => ({ ...current, due_time: e.target.value }))} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" />
                </div>
                <textarea value={activityDraft.note} onChange={(e) => setActivityDraft((current) => ({ ...current, note: e.target.value }))} rows={3} className="rounded border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#238847] focus:ring-4 focus:ring-emerald-100" placeholder="Observação, próximo passo ou combinado" />
                <button type="button" disabled={creatingActivity || !activityDraft.title.trim()} onClick={() => void submitActivity()} className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#1f7a40] disabled:opacity-60">{creatingActivity ? 'Criando...' : 'Criar atividade'}</button>
              </div>
            </div>
            {activities.length ? activities.map((a) => <div key={a.id} className="rounded border border-slate-200 bg-white p-3 text-sm shadow-sm"><div className="flex items-start gap-3"><button type="button" onClick={() => void completeActivity(a.id)} className="mt-1 h-5 w-5 shrink-0 rounded-full border-2 border-slate-300 hover:border-emerald-500"/><div><b>{a.title}</b><p className="mt-1 text-xs text-slate-500">{a.due_at ? new Date(a.due_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'sem data'} · {a.status}</p>{a.note && <p className="mt-2 text-slate-600">{a.note}</p>}</div></div></div>) : <p className="text-sm text-slate-500">Nenhuma atividade planejada.</p>}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="border-b border-slate-200 bg-white p-4"><h2 className="font-bold">Histórico</h2></div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto p-4">
            {history.length ? history.map((h) => <div key={h.id} className="rounded border border-slate-200 bg-slate-50 p-3 text-sm"><b>{h.event_type}: {h.title}</b><p className="text-xs text-slate-500">{h.description}</p></div>) : <p className="text-sm text-slate-500">Sem histórico.</p>}
          </div>
        </Panel>
      </aside>
    </form>
  </main>
}

function dealToForm(deal?: Deal): DealForm {
  return {
    title: deal?.title || '',
    stage_id: deal?.stage_id || '',
    owner_id: deal?.owner_id || '',
    status: deal?.status || 'morno',
    value: String(deal?.value ?? ''),
    monthly_purchase: String(deal?.monthly_purchase ?? ''),
    estimated_savings: String(deal?.estimated_savings ?? ''),
    probability: String(deal?.probability ?? ''),
    score: String(deal?.score ?? ''),
    source: deal?.source || '',
    plan: deal?.plan || '',
    expected_close_date: deal?.expected_close_date || '',
    focus_items: (deal?.focus_items || []).join('\n'),
    organization_name: deal?.organizations?.name || '',
    organization_segment: deal?.organizations?.segment || '',
    organization_city: deal?.organizations?.city || '',
    organization_state: deal?.organizations?.state || '',
    organization_cnpjs: String(deal?.organizations?.cnpjs ?? ''),
    organization_supplier_count: String(deal?.organizations?.supplier_count ?? ''),
    person_name: deal?.people?.full_name || '',
    person_role: deal?.people?.role_title || '',
    person_email: deal?.people?.email || '',
    person_phone: deal?.people?.phone || '',
  }
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

function EditSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span><select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#238847] focus:ring-4 focus:ring-emerald-100">{options.map(([id, label]) => <option key={id || 'empty'} value={id}>{label}</option>)}</select></label>
}

function FieldLine({ label, value, blue }: { label: string; value: string; blue?: boolean }) {
  return <div className="grid grid-cols-[18px_1fr] gap-2 text-sm"><span className="mt-0.5 text-slate-400">▣</span><div><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className={cn('font-semibold', blue ? 'text-blue-600' : 'text-slate-800')}>{value}</p></div></div>
}


function ListView({ title, icon, rows }: { title: string; icon: ReactNode; rows: Array<{ id: string; title: string; sub: string; meta: string }> }) {
  return <div className="h-full overflow-y-auto p-5"><Panel><div className="flex items-center gap-2 border-b border-slate-200 p-4"><span className="text-[#6f5cf6]">{icon}</span><h2 className="text-lg font-bold">{title}</h2></div><div className="divide-y divide-slate-100">{rows.map((row) => <div key={row.id} className="grid gap-2 p-4 text-sm hover:bg-slate-50 md:grid-cols-[1fr_1fr_160px]"><b>{row.title}</b><span className="text-slate-500">{row.sub}</span><span className="font-semibold text-slate-700">{row.meta}</span></div>)}</div></Panel></div>
}

function ActivitiesView({ activities, deals, completeActivity }: { activities: ActivityRow[]; deals: Deal[]; completeActivity: (id: string) => Promise<void> }) {
  return <div className="h-full overflow-y-auto p-5"><Panel><div className="flex items-center gap-2 border-b border-slate-200 p-4"><CalendarClock size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Atividades</h2></div><div className="divide-y divide-slate-100">{activities.map((a) => { const deal = deals.find((d) => d.id === a.deal_id); return <div key={a.id} className="grid gap-2 p-4 text-sm hover:bg-slate-50 md:grid-cols-[1fr_220px_140px_100px]"><b>{a.title}</b><span className="text-slate-500">{deal?.title || 'Sem negócio'}</span><span>{a.due_at ? new Date(a.due_at).toLocaleDateString('pt-BR') : 'sem data'}</span>{a.status === 'open' ? <button onClick={() => void completeActivity(a.id)} className="text-left font-bold text-emerald-700">Concluir</button> : <Badge>OK</Badge>}</div> })}</div></Panel></div>
}

function AdminUsersView({ users, companies, reload, setError }: { users: CrmUser[]; companies: CrmCompany[]; reload: () => Promise<void>; setError: (error: string) => void }) {
  const [busyId, setBusyId] = useState<string>('')
  const [message, setMessage] = useState('')
  const [newUser, setNewUser] = useState({ full_name: '', email: '', company_name: '' })
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})

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

  return <div className="h-full overflow-y-auto p-5">
    <Panel className="overflow-hidden">
      <div className="border-b border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Settings size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">Admin de usuários</h2></div>
          <div className="flex gap-2 text-xs font-semibold"><Badge tone="bg-blue-100 text-blue-700">{users.length} usuários</Badge><Badge tone="bg-emerald-100 text-emerald-700">{companies.length} empresas</Badge></div>
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
        {users.map((user) => <div key={user.id} className="grid gap-3 p-4 text-sm hover:bg-slate-50 md:grid-cols-[1.1fr_1.1fr_1fr_100px_1fr_160px_160px]">
          <div><b>{user.full_name}</b><p className="mt-1 text-xs text-slate-500">ID usuário: <code>{user.id}</code></p></div>
          <div className="text-slate-600">{user.email}</div>
          <div><b>{user.crm_companies?.name || 'Sem empresa'}</b><p className="mt-1 text-xs text-slate-500">ID empresa: <code>{user.company_id}</code></p></div>
          <div><Badge tone={user.status === 'active' ? 'bg-emerald-100 text-emerald-700' : user.status === 'invited' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}>{user.status}</Badge></div>
          <input value={passwordDrafts[user.id] || ''} onChange={(e) => setPasswordDrafts((current) => ({ ...current, [user.id]: e.target.value }))} className="rounded border border-slate-300 px-3 py-2 text-sm" placeholder="Senha inicial" type="text" autoComplete="new-password" />
          <button onClick={() => void setInitialPassword(user)} disabled={busyId === `password-${user.id}` || !(passwordDrafts[user.id] || '').trim()} className="rounded border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">{busyId === `password-${user.id}` ? 'Salvando...' : 'Definir senha'}</button>
          <button onClick={() => void sendAccessEmail(user)} disabled={busyId === user.id} className="rounded border border-[#238847] px-3 py-2 text-sm font-bold text-[#238847] hover:bg-emerald-50 disabled:opacity-60">{busyId === user.id ? 'Enviando...' : user.auth_user_id ? 'Redefinir senha' : 'Enviar acesso'}</button>
        </div>)}
        {!users.length && <div className="p-8 text-center text-slate-400">Nenhum usuário cadastrado.</div>}
      </div>
    </Panel>
  </div>
}

function ListViewDeals({ deals, stages, selectedId, setSelectedId, openDealPage }: { deals: Deal[]; stages: Stage[]; selectedId?: string; setSelectedId: (id: string) => void; openDealPage: (id: string) => void }) {
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name || ''
  return <div className="min-h-0 flex-1 overflow-auto">
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-white">
        <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase text-slate-500">
          <th className="px-4 py-3">Negócio</th>
          <th className="px-4 py-3">Empresa</th>
          <th className="px-4 py-3">Contato</th>
          <th className="px-4 py-3">Etapa</th>
          <th className="px-4 py-3">Valor</th>
          <th className="px-4 py-3">Status</th>
          <th className="px-4 py-3">Data esperada</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {deals.map((deal) => <tr key={deal.id} onClick={() => { setSelectedId(deal.id); openDealPage(deal.id) }} className={cn('cursor-pointer transition hover:bg-blue-50', selectedId === deal.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : '')}>
          <td className="px-4 py-3 font-semibold text-slate-900">{deal.title}</td>
          <td className="px-4 py-3 text-slate-600">{deal.organizations?.name || '-'}</td>
          <td className="px-4 py-3 text-slate-600">{deal.people?.full_name || '-'}</td>
          <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{stageName(deal.stage_id || '') || '-'}</span></td>
          <td className="px-4 py-3 font-semibold text-slate-800">{money(deal.value)}</td>
          <td className="px-4 py-3"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', deal.status === 'ganho' ? 'bg-green-100 text-green-700' : deal.status === 'perdido' ? 'bg-red-100 text-red-700' : deal.status === 'quente' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600')}>{statusLabel[deal.status || 'morno']}</span></td>
          <td className="px-4 py-3 text-slate-500">{deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString('pt-BR') : '-'}</td>
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
              <td className="px-5 py-2"><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase', deal.status === 'ganho' ? 'bg-green-100 text-green-700' : deal.status === 'perdido' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700')}>{statusLabel[deal.status || 'morno']}</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    })}
    {sorted.length === 0 && <div className="p-8 text-center text-slate-400">Nenhum negócio com data prevista.</div>}
  </div>
}

export default App
