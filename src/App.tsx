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
  FileText,
  Filter,
  GripVertical,
  LayoutDashboard,
  List,
  LogOut,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tags,
  UsersRound,
  Workflow,
} from 'lucide-react'
import { supabase, supabaseConfigured, type ActivityRow, type BpoPartner, type Deal, type HistoryRow, type Organization, type Person, type Profile, type Stage } from './supabase'
import './App.css'

type View = 'pipeline' | 'contacts' | 'companies' | 'activities' | 'fields' | 'owners'
type NewDeal = {
  title: string
  organization_name: string
  contact_name: string
  value: string
  monthly_purchase: string
  plan: string
  stage_id: string
  bpo_id: string
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
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    const res = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: email.split('@')[0] } } })
    setBusy(false)
    if (res.error) setMessage(res.error.message)
    else setMessage(mode === 'signup' ? 'Usuário criado. Se confirmação por email estiver ativa, confirme antes de entrar.' : 'Login efetuado.')
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
              <button disabled={busy} className="w-full rounded-lg bg-[#2cbf6d] px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#26a961] disabled:opacity-60">{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar usuário'}</button>
            </form>

            <div className="mt-5 flex max-w-md items-center justify-between text-sm">
              <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="font-semibold text-[#238847] hover:text-[#1f7a40]">{mode === 'login' ? 'Criar conta de teste' : 'Já tenho conta'}</button>
              <span className="text-slate-400">Ambiente seguro VMarket</span>
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
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [bpos, setBpos] = useState<BpoPartner[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [activeView, setActiveView] = useState<View>('pipeline')
  const [activePipeline, setActivePipeline] = useState('Pipeline de Vendas BPO')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [pipelineView, setPipelineView] = useState<'kanban' | 'list' | 'forecast'>('kanban')
  const [newDeal, setNewDeal] = useState<NewDeal>({ title: '', organization_name: '', contact_name: '', value: '399', monthly_purchase: '50000', plan: 'BPO completo + Essencial', stage_id: '', bpo_id: '' })

  const selected = useMemo(() => deals.find((d) => d.id === selectedId) || deals[0], [deals, selectedId])
  const selectedStageIndex = selected ? stages.findIndex((s) => s.id === selected.stage_id) : -1
  const selectedActivities = selected ? activities.filter((a) => a.deal_id === selected.id) : []
  const selectedHistory = selected ? history.filter((h) => h.deal_id === selected.id) : []
  const totals = useMemo(() => ({
    value: deals.reduce((acc, d) => acc + Number(d.value || 0), 0),
    gmv: deals.reduce((acc, d) => acc + Number(d.monthly_purchase || 0), 0),
    openActivities: activities.filter((a) => a.status === 'open').length,
  }), [deals, activities])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setLoading(false); return }
    void loadAll()
  }, [session])

  async function loadAll() {
    setLoading(true)
    setError('')
    try {
      const [profileRes, stagesRes, bpoRes, orgRes, peopleRes, dealsRes, actsRes, histRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session!.user.id).maybeSingle(),
        supabase.from('pipeline_stages').select('*').order('sort_order'),
        supabase.from('bpo_partners').select('*').order('name'),
        supabase.from('organizations').select('*').order('created_at', { ascending: false }),
        supabase.from('people').select('*').order('created_at', { ascending: false }),
        supabase.from('deals').select('*, organizations(*), people(*), bpo_partners(*), pipeline_stages(*)').order('created_at', { ascending: false }),
        supabase.from('activities').select('*').order('due_at', { ascending: true }),
        supabase.from('deal_history').select('*').order('created_at', { ascending: false }),
      ])
      const firstError = [profileRes, stagesRes, bpoRes, orgRes, peopleRes, dealsRes, actsRes, histRes].find((r) => r.error)?.error
      if (firstError) throw firstError
      setProfile(profileRes.data as Profile | null)
      setStages((stagesRes.data || []) as Stage[])
      setBpos((bpoRes.data || []) as BpoPartner[])
      setOrganizations((orgRes.data || []) as Organization[])
      setPeople((peopleRes.data || []) as Person[])
      setDeals((dealsRes.data || []) as Deal[])
      setActivities((actsRes.data || []) as ActivityRow[])
      setHistory((histRes.data || []) as HistoryRow[])
      if (!selectedId && dealsRes.data?.[0]) setSelectedId(dealsRes.data[0].id)
      if (!newDeal.stage_id && stagesRes.data?.[0]) setNewDeal((d) => ({ ...d, stage_id: stagesRes.data[0].id, bpo_id: bpoRes.data?.[0]?.id || '' }))
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
    try {
      const bpoId = newDeal.bpo_id || profile?.bpo_id || bpos[0]?.id || null
      const { data: org, error: orgErr } = await supabase.from('organizations').insert({ name: newDeal.organization_name, segment: 'Food service', cnpjs: 1, monthly_purchase: Number(newDeal.monthly_purchase || 0), bpo_id: bpoId }).select('*').single()
      if (orgErr) throw orgErr
      const { data: person, error: personErr } = await supabase.from('people').insert({ full_name: newDeal.contact_name, organization_id: org.id, labels: ['Novo lead'], bpo_id: bpoId }).select('*').single()
      if (personErr) throw personErr
      const monthly = Number(newDeal.monthly_purchase || 0)
      const { data: deal, error: dealErr } = await supabase.from('deals').insert({ title: newDeal.title, organization_id: org.id, person_id: person.id, stage_id: newDeal.stage_id || stages[0]?.id, bpo_id: bpoId, owner_id: session?.user.id, value: Number(newDeal.value || 0), monthly_purchase: monthly, estimated_savings: Math.round(monthly * 0.12), probability: 50, status: 'morno', source: 'Cadastro manual', plan: newDeal.plan, expected_close_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), score: 60, focus_items: ['Qualificar lead', 'Marcar diagnóstico', 'Enviar simulação de economia'] }).select('*').single()
      if (dealErr) throw dealErr
      await supabase.from('activities').insert({ title: 'Agendar diagnóstico gratuito', activity_type: 'meeting', due_at: new Date(Date.now() + 86400000).toISOString(), status: 'open', deal_id: deal.id, organization_id: org.id, person_id: person.id, bpo_id: bpoId, owner_id: session?.user.id })
      await supabase.from('deal_history').insert({ deal_id: deal.id, event_type: 'Sistema', title: 'Negócio criado', description: 'Criado pelo CRM VMarket BPO' })
      setNewDeal({ title: '', organization_name: '', contact_name: '', value: '399', monthly_purchase: '50000', plan: 'BPO completo + Essencial', stage_id: stages[0]?.id || '', bpo_id: bpoId || '' })
      await loadAll()
      setSelectedId(deal.id)
      setActiveView('pipeline')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function moveDeal(stageId: string, dealId = selected?.id) {
    if (!dealId) return
    const deal = deals.find((d) => d.id === dealId)
    if (deal?.stage_id === stageId) return
    const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', dealId)
    if (error) setError(error.message)
    else {
      await supabase.from('deal_history').insert({ deal_id: dealId, event_type: 'Campo', title: 'Etapa do pipeline alterada', description: `Nova etapa: ${stages.find((s) => s.id === stageId)?.name || ''}` })
      await loadAll()
      setSelectedId(dealId)
    }
  }

  async function completeActivity(id: string) {
    const { error } = await supabase.from('activities').update({ status: 'done' }).eq('id', id)
    if (error) setError(error.message)
    else await loadAll()
  }

  function handleDrop(e: DragEvent, stageId: string) {
    e.preventDefault()
    if (draggingId) void moveDeal(stageId, draggingId)
    setDraggingId(null)
  }

  if (!session) return <Login />

  const navItems: Array<[View, ReactNode, string]> = [
    ['pipeline', <LayoutDashboard size={19}/>, 'Negócios'],
    ['contacts', <Contact size={19}/>, 'Contatos'],
    ['companies', <Building2 size={19}/>, 'Empresas'],
    ['activities', <Activity size={19}/>, 'Atividades'],
    ['fields', <Tags size={19}/>, 'Campos'],
    ['owners', <UsersRound size={19}/>, 'Proprietários'],
  ]

  return (
    <main className="min-h-screen bg-[#f4f5f7] text-slate-900">
      <div className="flex min-h-screen">
        <aside className="flex w-14 shrink-0 flex-col items-center gap-2 bg-[#211746] py-3 text-white">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-white text-[13px] font-black tracking-[-0.08em] text-[#211746] shadow-sm">VM</div>
          {navItems.map(([key, icon, label]) => <button key={key} onClick={() => setActiveView(key)} title={label} className={cn('grid h-10 w-10 place-items-center rounded-lg transition', activeView === key ? 'bg-[#6f5cf6] text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')}>{icon}</button>)}
          <button onClick={() => supabase.auth.signOut()} title="Sair" className="mt-auto grid h-10 w-10 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"><LogOut size={18}/></button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-5">
            <h1 className="min-w-[155px] text-base font-semibold">{navItems.find(([key]) => key === activeView)?.[2]}</h1>
            <div className="mx-auto hidden w-full max-w-xl items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-400 shadow-inner md:flex"><Search size={17}/>Search VMarket</div>
            <button onClick={() => setActiveView('pipeline')} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><Plus size={19}/></button>
            <button onClick={loadAll} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><RefreshCw size={17}/></button>
            <div className="hidden items-center gap-2 sm:flex"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{profile?.full_name?.slice(0,1) || 'V'}</span><span className="text-xs font-semibold leading-tight text-slate-700">VMarket<br/><span className="font-normal text-slate-500">BPO CRM</span></span></div>
            <button onClick={() => supabase.auth.signOut()} className="hidden rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:block">Sair</button>
          </header>

          <section className="min-h-0 flex-1 overflow-hidden">
            {error && <div className="m-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><b>Erro:</b> {error}</div>}
            {loading ? <div className="m-4 rounded bg-white p-4 text-sm shadow-sm">Carregando dados do Supabase...</div> : (
              <>
                {activeView === 'pipeline' && <PipelineView stages={stages} deals={deals} selectedId={selected?.id} setSelectedId={setSelectedId} setDraggingId={setDraggingId} handleDrop={handleDrop} totals={totals} selected={selected} selectedStageIndex={selectedStageIndex} selectedActivities={selectedActivities} selectedHistory={selectedHistory} moveDeal={moveDeal} completeActivity={completeActivity} newDeal={newDeal} setNewDeal={setNewDeal} createDeal={createDeal} creating={creating} bpos={bpos} activePipeline={activePipeline} setActivePipeline={setActivePipeline} pipelineView={pipelineView} setPipelineView={setPipelineView} />}
                {activeView === 'contacts' && <ListView title="Contatos" icon={<Contact size={18}/>} rows={people.map((p) => ({ id: p.id, title: p.full_name, sub: `${p.role_title || 'Contato'} · ${p.email || 'sem email'}`, meta: p.phone || 'sem telefone' }))} />}
                {activeView === 'companies' && <ListView title="Empresas" icon={<Building2 size={18}/>} rows={organizations.map((o) => ({ id: o.id, title: o.name, sub: `${o.segment || 'Segmento não informado'} · ${o.city || ''} ${o.state || ''}`, meta: money(o.monthly_purchase) }))} />}
                {activeView === 'activities' && <ActivitiesView activities={activities} deals={deals} completeActivity={completeActivity} />}
                {activeView === 'fields' && <SettingsView title="Campos" items={['Volume mensal de compras', 'Plano recomendado', 'Economia estimada', 'Tipo de operação', 'Perfil do decisor', 'Cotação coletiva']} />}
                {activeView === 'owners' && <SettingsView title="Proprietários e parceiros" items={[`Usuário atual: ${session.user.email}`, `Perfil: ${profile?.role === 'admin_vmarket' ? 'Admin VMarket' : 'BPO parceiro'}`, ...bpos.map((b) => `${b.name} · ${b.contact_name || 'sem contato'}`)]} />}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function PipelineView({ stages, deals, selectedId, setSelectedId, setDraggingId, handleDrop, totals, selected, selectedStageIndex, selectedActivities, selectedHistory, moveDeal, completeActivity, newDeal, setNewDeal, createDeal, creating, bpos, activePipeline, setActivePipeline, pipelineView, setPipelineView }: {
  stages: Stage[]
  deals: Deal[]
  selectedId?: string
  setSelectedId: (id: string) => void
  setDraggingId: (id: string | null) => void
  handleDrop: (e: DragEvent, stageId: string) => void
  totals: { value: number; gmv: number; openActivities: number }
  selected?: Deal
  selectedStageIndex: number
  selectedActivities: ActivityRow[]
  selectedHistory: HistoryRow[]
  moveDeal: (stageId: string, dealId?: string) => Promise<void>
  completeActivity: (id: string) => Promise<void>
  newDeal: NewDeal
  setNewDeal: (deal: NewDeal) => void
  createDeal: (e: FormEvent) => Promise<void>
  creating: boolean
  bpos: BpoPartner[]
  activePipeline: string
  setActivePipeline: (pipeline: string) => void
  pipelineView: 'kanban' | 'list' | 'forecast'
  setPipelineView: (view: 'kanban' | 'list' | 'forecast') => void
}) {
  const selectedStage = selected ? stages.find((s) => s.id === selected.stage_id) : undefined
  const ageDays = Math.max(1, Math.min(96, selected?.score || 36))
  const stageSegments = stages.length ? stages : [{ id: 'empty', name: 'Sem etapa' } as Stage]

  return <div className="flex h-full min-h-0 flex-col">
    <div className="border-b border-slate-200 bg-white">
      <div className="flex h-12 items-center gap-2 px-4">
        <div className="flex overflow-hidden rounded border border-slate-300">
          <button onClick={() => setPipelineView('kanban')} className={cn('grid h-8 w-9 place-items-center', pipelineView === 'kanban' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Kanban"><GripVertical size={15}/></button>
          <button onClick={() => setPipelineView('list')} className={cn('grid h-8 w-9 place-items-center border-l border-slate-300', pipelineView === 'list' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Lista"><List size={15}/></button>
          <button onClick={() => setPipelineView('forecast')} className={cn('grid h-8 w-9 place-items-center border-l border-slate-300', pipelineView === 'forecast' ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300' : 'text-slate-600 hover:bg-slate-50')} title="Previsão"><CalendarClock size={15}/></button>
        </div>
        <button className="rounded-l border border-[#087d3e] bg-[#238847] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1f7a40]">+ Deal</button>
        <button className="-ml-2 rounded-r border border-[#087d3e] bg-[#1f7a40] px-2 py-1.5 text-sm font-semibold text-white"><ChevronDown size={14}/></button>
<button className="ml-1 rounded border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Adicionar condição</button>
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <span><b>{deals.length}</b> negócios · {money(totals.value)}</span>
          <span className="hidden text-slate-300 md:inline">|</span>
          <label className="flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-700">
            <Workflow size={15}/>
            <select value={activePipeline} onChange={(e) => setActivePipeline(e.target.value)} className="max-w-[170px] bg-transparent text-sm outline-none">
              <option>Pipeline de Vendas BPO</option>
              <option>Pipeline de Onboarding</option>
              <option>Carteira ativa</option>
            </select>
          </label>
          <button className="grid h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50">✎</button>
          <button className="grid h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50">ⓘ</button>
          <button className="rounded border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Filter size={14} className="inline"/> Filtro</button>
          <button className="grid h-8 w-8 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50"><MoreHorizontal size={17}/></button>
        </div>
      </div>
      <div className="flex h-8 items-center justify-between border-t border-slate-100 px-4 text-xs text-slate-500">
        <span><Filter size={12} className="inline"/> Add condition</span>
        <span className="font-semibold text-blue-600">Sort by: Next activity ▾</span>
      </div>
    </div>

    {pipelineView === 'kanban' ? <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex h-full min-w-max gap-3">
          {stages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stage_id === stage.id)
            const stageValue = stageDeals.reduce((acc, d) => acc + Number(d.value || 0), 0)
            return <div key={stage.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)} className="flex h-full w-[142px] flex-col bg-[#f0f2f4] ring-1 ring-slate-200 xl:w-[146px]">
              <div className="border-b border-slate-200 bg-white/60 p-2">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-sm font-bold text-slate-800">{stage.name}</p>
                  <button className="grid h-6 w-6 shrink-0 place-items-center rounded border border-slate-300 bg-white text-slate-500 hover:bg-slate-50">+</button>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500">{money(stageValue)} · {stageDeals.length} negócios</p>
              </div>
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
                {stageDeals.map((deal) => <button key={deal.id} draggable onDragStart={() => setDraggingId(deal.id)} onDragEnd={() => setDraggingId(null)} onClick={() => setSelectedId(deal.id)} className={cn('group w-full rounded border p-2 text-left shadow-sm transition hover:shadow-md cursor-pointer', selectedId === deal.id ? 'border-blue-300 bg-[#fff3f0] ring-2 ring-blue-200/70' : 'border-[#eadfda] bg-[#fff2ef] hover:border-blue-200')}>
                  <div className="mb-1.5 flex items-center gap-1">
                    <span className="h-1 w-8 rounded-full bg-[#5c7cfa]" />
                    <span className="h-1 w-8 rounded-full bg-[#e6509c]" />
                  </div>
                  <p className="line-clamp-2 text-sm font-bold leading-snug text-slate-900">{deal.title}</p>
                  <p className="mt-1 truncate text-xs text-slate-600">{deal.organizations?.name || 'Sem empresa'}</p>
                  <p className="truncate text-xs text-slate-500">{deal.people?.full_name || 'Sem contato'}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{Math.max(1, Math.min(96, deal.score || deal.probability || 14))}d</span>
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
      </div>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-slate-200 bg-[#f5f6f8] xl:block">
        {selected ? <div>
          <div className="border-b border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-2xl font-normal leading-tight text-slate-900">{selected.title}</h2>
                <p className="mt-2 text-xs text-slate-500"><span className="font-semibold text-blue-600">{activePipeline}</span> → {selectedStage?.name || 'Sem etapa'}</p>
              </div>
              <MoreHorizontal size={20} className="mt-1 text-slate-500"/>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="rounded-full bg-red-500 px-2 py-1 text-[11px] font-bold uppercase text-white">Rotting for {ageDays} days</span>
              <div className="flex items-center gap-2 text-xs text-slate-600"><span className="grid h-8 w-8 place-items-center rounded-full bg-slate-200 text-slate-500">{selected.people?.full_name?.slice(0,1) || 'V'}</span><span><b>{profileName(selected)}</b><br/>Owner</span></div>
            </div>
            <div className="mt-4 flex overflow-hidden rounded-sm">
              {stageSegments.map((stage, i) => <button key={stage.id} onClick={() => void moveDeal(stage.id, selected.id)} className={cn('h-6 min-w-[68px] flex-1 border-r border-white text-[11px]', i <= selectedStageIndex ? 'bg-[#27864d] text-white' : 'bg-slate-200 text-slate-500')}>{i === selectedStageIndex ? `${ageDays} days` : '0 days'}</button>)}
            </div>
            <div className="mt-4 flex gap-2">
              <button className="rounded bg-[#238847] px-4 py-2 text-sm font-bold text-white">Won</button>
              <button className="rounded bg-red-500 px-4 py-2 text-sm font-bold text-white">Lost</button>
              <button className="rounded border border-slate-300 bg-white px-3 py-2 text-slate-600">▦</button>
            </div>
          </div>

          <div className="grid min-h-[620px] grid-cols-[40%_60%]">
            <section className="border-r border-slate-200 bg-white">
              <div className="border-b border-slate-200 p-4">
                <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-slate-700"><b>Organize your sidebar</b><br/>Campos principais, resumo e detalhes do negócio ficam aqui.</div>
                <div className="flex items-center gap-2 rounded border border-slate-300 px-3 py-2 text-sm text-slate-500"><Search size={15}/> Filter fields</div>
              </div>
              <DetailSection title="Please fill" accent>
                <FieldLine label="Quantidade de CNPJs" value={`${selected.organizations?.cnpjs || 1}`} />
                <FieldLine label="Plano recomendado" value={selected.plan || 'BPO completo'} />
              </DetailSection>
              <DetailSection title="Summary">
                <FieldLine label="Pessoa" value={selected.people?.full_name || 'Sem contato'} blue />
                <FieldLine label="Empresa" value={selected.organizations?.name || 'Sem empresa'} blue />
                <FieldLine label="Valor" value={money(selected.value)} />
                <FieldLine label="Status" value={statusLabel[selected.status || 'morno']} />
                <FieldLine label="Data esperada" value={selected.expected_close_date ? new Date(selected.expected_close_date).toLocaleDateString('pt-BR') : 'Sem data'} />
              </DetailSection>
              <DetailSection title="Details">
                <FieldLine label="GMV mensal" value={money(selected.monthly_purchase)} />
                <FieldLine label="Economia estimada" value={money(selected.estimated_savings)} />
                <FieldLine label="Probabilidade" value={`${selected.probability || 0}%`} />
                <FieldLine label="BPO" value={selected.bpo_partners?.name || 'Sem BPO'} />
              </DetailSection>
            </section>

            <section className="bg-[#f5f6f8] p-4">
              <div className="rounded border border-slate-200 bg-white shadow-sm">
                <div className="flex overflow-x-auto border-b border-slate-200 text-sm text-slate-600">
                  {[['Notas', <FileText size={15}/>], ['Atividade', <CalendarClock size={15}/>], ['Call', <Phone size={15}/>], ['Email', <Mail size={15}/>], ['Arquivos', <FileText size={15}/>], ['Documentos', <FileText size={15}/>]].map(([tab, icon], i) => <button key={String(tab)} className={cn('flex items-center gap-1 border-b-2 px-4 py-3 whitespace-nowrap', i === 0 ? 'border-blue-600 text-blue-700' : 'border-transparent hover:bg-slate-50')}>{icon}{tab}</button>)}
                </div>
                <div className="flex items-center justify-between px-4 py-4 text-sm text-slate-400"><span>Take a note, @name...</span><span>0/100 notes ⓘ</span></div>
              </div>
              <div className="mt-6 flex items-center justify-between"><h3 className="font-bold">Focus <ChevronDown size={15} className="inline"/></h3><span className="text-sm text-slate-500">○ Expand all items</span></div>
              <div className="mt-4 space-y-3">
                {selectedActivities.length ? selectedActivities.map((a) => <div key={a.id} className="rounded border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between p-4"><div className="flex items-center gap-3"><button onClick={() => void completeActivity(a.id)} className="h-4 w-4 rounded-full border-2 border-slate-300 hover:border-emerald-500" title="Marcar como feita"/><div><b>{a.title}</b><p className="text-xs text-slate-500"><span className="rounded bg-red-500 px-1.5 py-0.5 font-bold text-white">OVERDUE</span> · {a.due_at ? new Date(a.due_at).toLocaleDateString('pt-BR') : 'sem data'} · {selected.people?.full_name || 'Contato'} · {selected.organizations?.name || 'Empresa'}</p></div></div><MoreHorizontal size={18} className="text-slate-400"/></div><div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-slate-700">Oi, {selected.people?.full_name || 'contato'}! Aqui é da VMarket, a plataforma de compras que ajuda bares, restaurantes e hotéis a economizar.</div></div>) : <div className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Nenhuma atividade planejada para este negócio.</div>}
              </div>
              <h3 className="mt-8 font-bold">History ›</h3>
              <div className="mt-3 space-y-2">{selectedHistory.map((h) => <div key={h.id} className="rounded border border-slate-200 bg-white p-3 text-sm"><b>{h.event_type}: {h.title}</b><p className="text-xs text-slate-500">{h.description}</p></div>)}</div>
            </section>
          </div>
        </div> : <div className="p-4 text-sm text-slate-500">Selecione um negócio.</div>}
      </aside>
    </div> : pipelineView === 'list' ? <ListViewDeals deals={deals} stages={stages} selectedId={selectedId} setSelectedId={setSelectedId} /> : <ForecastView deals={deals} stages={stages} selectedId={selectedId} setSelectedId={setSelectedId} />}

    <div className="border-t border-slate-200 bg-white p-4">
      <form onSubmit={createDeal} className="grid gap-2 md:grid-cols-7">
        <input className="rounded border border-slate-200 px-3 py-2 text-sm md:col-span-2" placeholder="Título do negócio" value={newDeal.title} onChange={e=>setNewDeal({...newDeal,title:e.target.value})} required/>
        <input className="rounded border border-slate-200 px-3 py-2 text-sm" placeholder="Empresa" value={newDeal.organization_name} onChange={e=>setNewDeal({...newDeal,organization_name:e.target.value})} required/>
        <input className="rounded border border-slate-200 px-3 py-2 text-sm" placeholder="Contato" value={newDeal.contact_name} onChange={e=>setNewDeal({...newDeal,contact_name:e.target.value})} required/>
        <select className="rounded border border-slate-200 px-3 py-2 text-sm" value={newDeal.stage_id} onChange={e=>setNewDeal({...newDeal,stage_id:e.target.value})}>{stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="rounded border border-slate-200 px-3 py-2 text-sm" value={newDeal.bpo_id} onChange={e=>setNewDeal({...newDeal,bpo_id:e.target.value})}>{bpos.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <button disabled={creating} className="rounded bg-[#2cbf6d] px-3 py-2 text-sm font-bold text-white disabled:opacity-60">{creating?'Criando...':'+ Negócio'}</button>
      </form>
    </div>
  </div>
}

function profileName(deal: Deal) {
  return deal.bpo_partners?.contact_name || deal.people?.full_name || 'VMarket'
}

function DetailSection({ title, children, accent }: { title: string; children: ReactNode; accent?: boolean }) {
  return <section className={cn('border-b border-slate-200 p-4', accent && 'border-r-4 border-r-amber-300')}><div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-slate-800">⌃ {title}</h3><span className="text-slate-400">•••</span></div><div className="space-y-3">{children}</div></section>
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

function SettingsView({ title, items }: { title: string; items: string[] }) {
  return <div className="h-full overflow-y-auto p-5"><Panel><div className="flex items-center gap-2 border-b border-slate-200 p-4"><Settings size={18} className="text-[#6f5cf6]"/><h2 className="text-lg font-bold">{title}</h2></div><div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <div key={item} className="rounded border border-slate-200 bg-slate-50 p-4 text-sm"><b>{item}</b><p className="mt-2 text-xs text-slate-500">Configurado no CRM VMarket.</p></div>)}</div></Panel></div>
}

function ListViewDeals({ deals, stages, selectedId, setSelectedId }: { deals: Deal[]; stages: Stage[]; selectedId?: string; setSelectedId: (id: string) => void }) {
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
        {deals.map((deal) => <tr key={deal.id} onClick={() => setSelectedId(deal.id)} className={cn('cursor-pointer transition hover:bg-blue-50', selectedId === deal.id ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : '')}>
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

function ForecastView({ deals, stages, selectedId, setSelectedId }: { deals: Deal[]; stages: Stage[]; selectedId?: string; setSelectedId: (id: string) => void }) {
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
            {group.deals.map((deal) => <tr key={deal.id} onClick={() => setSelectedId(deal.id)} className={cn('cursor-pointer transition hover:bg-blue-50', selectedId === deal.id ? 'bg-blue-50' : '')}>
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
