import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  Building2,
  CalendarClock,
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
const statusTone: Record<string, string> = {
  quente: 'bg-red-100 text-red-700',
  ganho: 'bg-emerald-100 text-emerald-700',
  morno: 'bg-amber-100 text-amber-700',
  risco: 'bg-rose-100 text-rose-700',
  perdido: 'bg-slate-100 text-slate-500',
}

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
    <main className="min-h-screen bg-[#f4f5f7] p-6 text-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-2xl bg-white shadow-2xl lg:grid-cols-[1.1fr_0.9fr]">
          <section className="bg-[#262a3d] p-8 text-white md:p-12">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2cbf6d] text-white"><Workflow /></div>
              <div><p className="text-xs uppercase tracking-[0.25em] text-emerald-200">VMarket</p><h1 className="text-xl font-black">BPO CRM</h1></div>
            </div>
            <h2 className="text-4xl font-black leading-tight md:text-5xl">CRM estilo Pipedrive conectado ao Supabase</h2>
            <p className="mt-4 max-w-xl text-slate-200">Funil em Kanban, menu lateral navegável, negócios, contatos, empresas e atividades usando dados reais do banco.</p>
            <div className="mt-8 grid gap-3 text-sm md:grid-cols-2">
              {['Funil Kanban', 'Cards por etapa', 'Menu lateral funcional', 'Permissões por BPO'].map((item) => <div key={item} className="rounded-xl bg-white/10 p-3 ring-1 ring-white/10"><CheckCircle2 className="mb-2 text-emerald-300" size={18}/>{item}</div>)}
            </div>
          </section>
          <section className="p-8 md:p-12">
            <h3 className="text-2xl font-black">Entrar no CRM</h3>
            <p className="mt-2 text-sm text-slate-500">Use um usuário criado no Supabase Auth.</p>
            {!supabaseConfigured && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">Supabase não configurado no ambiente.</p>}
            <form onSubmit={submit} className="mt-6 space-y-4">
              <input className="w-full rounded border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-400" placeholder="email@empresa.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input className="w-full rounded border border-slate-300 px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-400" placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button disabled={busy} className="w-full rounded bg-[#2cbf6d] px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar usuário'}</button>
            </form>
            <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="mt-4 text-sm font-semibold text-emerald-700">{mode === 'login' ? 'Criar conta de teste' : 'Já tenho conta'}</button>
            {message && <p className="mt-4 rounded bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
            <div className="mt-6 rounded bg-emerald-50 p-4 text-sm text-emerald-900 ring-1 ring-emerald-100">
              <b>Banco configurado:</b> o CRM já está conectado ao Supabase com tabelas, permissões e dados iniciais.
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
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
          <div className="mb-3 text-2xl font-black">p</div>
          {navItems.map(([key, icon, label]) => <button key={key} onClick={() => setActiveView(key)} title={label} className={cn('grid h-10 w-10 place-items-center rounded-lg transition', activeView === key ? 'bg-[#6f5cf6] text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')}>{icon}</button>)}
          <button onClick={() => supabase.auth.signOut()} title="Sair" className="mt-auto grid h-10 w-10 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"><LogOut size={18}/></button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-5">
            <h1 className="min-w-[155px] text-base font-semibold">{navItems.find(([key]) => key === activeView)?.[2]}</h1>
            <div className="mx-auto hidden w-full max-w-xl items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-400 md:flex"><Search size={17}/>Pesquisar no Pipedrive</div>
            <button onClick={() => setActiveView('pipeline')} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><Plus size={19}/></button>
            <button onClick={loadAll} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><RefreshCw size={17}/></button>
            <button onClick={() => supabase.auth.signOut()} className="hidden rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:block">Sair</button>
          </header>

          <section className="min-h-0 flex-1 overflow-hidden">
            {error && <div className="m-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><b>Erro:</b> {error}</div>}
            {loading ? <div className="m-4 rounded bg-white p-4 text-sm shadow-sm">Carregando dados do Supabase...</div> : (
              <>
                {activeView === 'pipeline' && <PipelineView stages={stages} deals={deals} selectedId={selected?.id} setSelectedId={setSelectedId} setDraggingId={setDraggingId} handleDrop={handleDrop} totals={totals} selected={selected} selectedStageIndex={selectedStageIndex} selectedActivities={selectedActivities} selectedHistory={selectedHistory} moveDeal={moveDeal} completeActivity={completeActivity} newDeal={newDeal} setNewDeal={setNewDeal} createDeal={createDeal} creating={creating} bpos={bpos} />}
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

function PipelineView({ stages, deals, selectedId, setSelectedId, setDraggingId, handleDrop, totals, selected, selectedStageIndex, selectedActivities, selectedHistory, moveDeal, completeActivity, newDeal, setNewDeal, createDeal, creating, bpos }: {
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
}) {
  return <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-5 py-3">
      <button className="rounded border border-[#2cbf6d] bg-[#2cbf6d] px-3 py-2 text-sm font-semibold text-white">+ Negócio</button>
      <button className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-600"><GripVertical size={15} className="inline"/> Kanban</button>
      <button className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-600"><List size={15} className="inline"/> Lista</button>
      <button className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-600"><Filter size={15} className="inline"/> Filtros</button>
      <div className="ml-auto text-sm text-slate-500"><b>{deals.length}</b> negócios · {money(totals.value)} · GMV {money(totals.gmv)}</div>
    </div>

    <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex h-full min-w-max gap-3">
          {stages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stage_id === stage.id)
            const stageValue = stageDeals.reduce((acc, d) => acc + Number(d.value || 0), 0)
            return <div key={stage.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, stage.id)} className="flex h-full w-[180px] flex-col rounded bg-[#edf0f3] ring-1 ring-slate-200 xl:w-[190px]">
              <div className="border-b border-slate-200 p-3">
                <p className="truncate text-sm font-bold text-slate-800">{stage.name}</p>
                <p className="mt-1 text-[11px] text-slate-500">{money(stageValue)} · {stageDeals.length} negócios</p>
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {stageDeals.map((deal) => <button key={deal.id} draggable onDragStart={() => setDraggingId(deal.id)} onDragEnd={() => setDraggingId(null)} onClick={() => setSelectedId(deal.id)} className={cn('w-full rounded border bg-white p-2 text-left shadow-sm transition hover:shadow-md', selectedId === deal.id ? 'border-[#6f5cf6] ring-2 ring-[#6f5cf6]/20' : 'border-slate-200')}>
                  <div className="h-1 w-12 rounded-full bg-[#c251a3]" />
                  <p className="mt-2 line-clamp-2 text-xs font-bold leading-snug text-slate-900">{deal.title}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">{deal.organizations?.name || 'Sem empresa'}</p>
                  <p className="mt-1 text-[11px] text-slate-500">{deal.expected_close_date ? new Date(deal.expected_close_date).toLocaleDateString('pt-BR') : 'Sem data'}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-700">{money(deal.value)}</span>
                    <Badge tone={statusTone[deal.status || 'morno']}>{statusLabel[deal.status || 'morno']}</Badge>
                  </div>
                </button>)}
                {stageDeals.length === 0 && <div className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">Solte cards aqui</div>}
              </div>
            </div>
          })}
        </div>
      </div>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-slate-200 bg-white xl:block">
        {selected ? <div>
          <div className="border-b border-slate-200 p-4">
            <div className="mb-2 flex items-center justify-between"><Badge>{selected.source || 'Sem origem'}</Badge><MoreHorizontal size={18} className="text-slate-400"/></div>
            <h2 className="text-lg font-black leading-tight">{selected.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{selected.people?.full_name || 'Sem contato'} · {selected.organizations?.name || 'Sem empresa'}</p>
            <div className="mt-4 flex flex-wrap gap-1">{stages.map((stage, i) => <button key={stage.id} onClick={() => void moveDeal(stage.id, selected.id)} className={cn('rounded px-2 py-1 text-[11px] font-bold', i <= selectedStageIndex ? 'bg-[#2cbf6d] text-white' : 'bg-slate-100 text-slate-500')}>{stage.name}</button>)}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-4 text-sm">
            <Metric label="Valor" value={money(selected.value)} />
            <Metric label="Probabilidade" value={`${selected.probability || 0}%`} />
            <Metric label="Plano" value={selected.plan || 'Sem plano'} />
            <Metric label="BPO" value={selected.bpo_partners?.name || 'Sem BPO'} />
          </div>
          <div className="p-4">
            <h3 className="mb-2 text-sm font-black">Atividades</h3>
            <div className="space-y-2">{selectedActivities.map((a) => <div key={a.id} className="rounded border border-slate-200 p-2 text-sm"><div className="flex justify-between gap-2"><b>{a.title}</b><Badge>{a.status === 'open' ? 'Aberta' : 'OK'}</Badge></div><p className="text-xs text-slate-500">{a.due_at ? new Date(a.due_at).toLocaleString('pt-BR') : 'sem data'}</p>{a.status === 'open' && <button onClick={() => void completeActivity(a.id)} className="mt-1 text-xs font-bold text-emerald-700">Concluir</button>}</div>)}</div>
            <h3 className="mb-2 mt-5 text-sm font-black">Histórico</h3>
            <div className="space-y-2">{selectedHistory.map((h) => <div key={h.id} className="rounded bg-slate-50 p-2 text-sm"><b>{h.event_type}: {h.title}</b><p className="text-xs text-slate-500">{h.description}</p></div>)}</div>
          </div>
        </div> : <div className="p-4 text-sm text-slate-500">Selecione um negócio.</div>}
      </aside>
    </div>

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

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-slate-50 p-2"><p className="text-[11px] text-slate-500">{label}</p><p className="truncate text-sm font-bold">{value}</p></div>
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

export default App
