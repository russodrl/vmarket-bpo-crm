import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Contact,
  Filter,
  HandCoins,
  LayoutDashboard,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  Tags,
  UserRound,
  UsersRound,
  Workflow,
} from 'lucide-react'
import { supabase, supabaseConfigured, type ActivityRow, type BpoPartner, type Deal, type HistoryRow, type Organization, type Person, type Profile, type Stage } from './supabase'
import './App.css'

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
  quente: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  ganho: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  morno: 'bg-amber-100 text-amber-800 ring-amber-200',
  risco: 'bg-rose-100 text-rose-800 ring-rose-200',
  perdido: 'bg-slate-100 text-slate-600 ring-slate-200',
}

function cn(...classes: Array<string | false | undefined | null>) { return classes.filter(Boolean).join(' ') }
function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1', tone || 'bg-slate-100 text-slate-700 ring-slate-200')}>{children}</span>
}
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn('rounded-2xl border border-white/70 bg-white/85 p-4 card-shadow backdrop-blur', className)}>{children}</section>
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent) {
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
    <main className="min-h-screen bg-[#10241c] bg-grid p-6 text-white">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[2rem] bg-white text-slate-900 shadow-2xl lg:grid-cols-[1.1fr_0.9fr]">
          <section className="bg-[#183b2e] p-8 text-white md:p-12">
            <div className="mb-8 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-[#10241c]"><Workflow /></div>
              <div><p className="text-xs uppercase tracking-[0.25em] text-emerald-200">VMarket</p><h1 className="text-xl font-black">BPO CRM</h1></div>
            </div>
            <h2 className="text-4xl font-black leading-tight md:text-5xl">CRM real conectado ao Supabase</h2>
            <p className="mt-4 max-w-xl text-emerald-50/80">Login por email e senha, RLS para Admin VMarket ver tudo e BPO parceiro ver apenas sua carteira, pipeline, contatos, empresas, atividades e histórico.</p>
            <div className="mt-8 grid gap-3 text-sm md:grid-cols-2">
              {['Pipeline com banco real', 'CRUD de negócios', 'Atividades vinculadas', 'Permissões por BPO'].map((item) => <div key={item} className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10"><CheckCircle2 className="mb-2 text-emerald-300" size={18}/>{item}</div>)}
            </div>
          </section>
          <section className="p-8 md:p-12">
            <h3 className="text-2xl font-black">Entrar no CRM</h3>
            <p className="mt-2 text-sm text-slate-500">Use um usuário criado no Supabase Auth.</p>
            {!supabaseConfigured && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">Supabase não configurado no ambiente.</p>}
            <form onSubmit={submit} className="mt-6 space-y-4">
              <input className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-400" placeholder="email@empresa.com" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input className="w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:ring-2 focus:ring-emerald-400" placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button disabled={busy} className="w-full rounded-xl bg-[#183b2e] px-4 py-3 font-bold text-white disabled:opacity-60">{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar usuário'}</button>
            </form>
            <button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="mt-4 text-sm font-semibold text-emerald-700">{mode === 'login' ? 'Criar conta de teste' : 'Já tenho conta'}</button>
            {message && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
            <div className="mt-6 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-100">
              <b>Antes do primeiro login:</b> rode o arquivo <code>supabase-schema.sql</code> no SQL Editor do Supabase para criar tabelas, RLS e dados mockados.
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newDeal, setNewDeal] = useState<NewDeal>({ title: '', organization_name: '', contact_name: '', value: '399', monthly_purchase: '50000', plan: 'BPO completo + Essencial', stage_id: '', bpo_id: '' })

  const selected = useMemo(() => deals.find((d) => d.id === selectedId) || deals[0], [deals, selectedId])
  const selectedStageIndex = selected ? stages.findIndex((s) => s.id === selected.stage_id) : -1
  const selectedActivities = selected ? activities.filter((a) => a.deal_id === selected.id) : []
  const selectedHistory = selected ? history.filter((h) => h.deal_id === selected.id) : []
  const totals = useMemo(() => ({
    gmv: deals.reduce((acc, d) => acc + Number(d.monthly_purchase || 0), 0),
    savings: deals.reduce((acc, d) => acc + Number(d.estimated_savings || 0), 0),
    openActivities: activities.filter((a) => a.status === 'open').length,
    partners: new Set(deals.map((d) => d.bpo_id).filter(Boolean)).size,
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

  async function createDeal(e: React.FormEvent) {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function moveDeal(stageId: string) {
    if (!selected) return
    const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', selected.id)
    if (error) setError(error.message)
    else {
      await supabase.from('deal_history').insert({ deal_id: selected.id, event_type: 'Campo', title: 'Etapa do pipeline alterada', description: `Nova etapa: ${stages.find((s) => s.id === stageId)?.name || ''}` })
      await loadAll()
    }
  }

  async function completeActivity(id: string) {
    const { error } = await supabase.from('activities').update({ status: 'done' }).eq('id', id)
    if (error) setError(error.message)
    else await loadAll()
  }

  if (!session) return <Login />

  return (
    <main className="min-h-screen bg-[#f4f7f1] bg-grid text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-72 border-r border-emerald-900/10 bg-[#10241c] p-5 text-white lg:block">
          <div className="mb-8 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400 text-[#10241c]"><Workflow size={24} /></div><div><p className="text-xs uppercase tracking-[0.24em] text-emerald-200">VMarket</p><h1 className="text-lg font-bold">BPO CRM</h1></div></div>
          <nav className="space-y-2 text-sm">{[[LayoutDashboard,'Pipeline'],[Contact,'Contatos'],[Building2,'Empresas'],[Activity,'Atividades'],[Tags,'Campos'],[UsersRound,'Proprietários']].map(([Icon,label],i)=><button key={label as string} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', i===0?'bg-white text-[#10241c]':'text-emerald-50 hover:bg-white/10')}><Icon size={18}/>{label as string}</button>)}</nav>
          <div className="mt-8 rounded-2xl bg-emerald-400/12 p-4 ring-1 ring-emerald-300/20"><p className="text-sm font-semibold text-emerald-100">Sessão ativa</p><p className="mt-2 break-all text-xs text-emerald-50/75">{session.user.email}</p><p className="mt-2 text-xs text-emerald-50/75">Perfil: {profile?.role === 'admin_vmarket' ? 'Admin VMarket' : 'BPO parceiro'}</p></div>
          <button onClick={() => supabase.auth.signOut()} className="mt-4 flex w-full items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/20"><LogOut size={16}/>Sair</button>
        </aside>
        <div className="flex-1 p-4 md:p-6 lg:p-8">
          <header className="mb-6 flex flex-col gap-4 rounded-3xl bg-[#183b2e] p-5 text-white card-shadow lg:flex-row lg:items-center lg:justify-between">
            <div><p className="mb-2 text-sm font-semibold uppercase tracking-[0.25em] text-emerald-200">CRM REAL COM SUPABASE</p><h2 className="text-2xl font-black md:text-4xl">Pipeline VMarket para parceiros BPO</h2><p className="mt-2 max-w-3xl text-sm text-emerald-50/80">Dados reais no Supabase, autenticação por email e senha, RLS por perfil, pipeline, negócios, contatos, empresas, atividades e histórico.</p></div>
            <div className="flex flex-wrap gap-2"><button onClick={loadAll} className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#183b2e]"><RefreshCw className="mr-2 inline" size={16}/>Atualizar</button><button className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-[#183b2e]"><Filter className="mr-2 inline" size={16}/>Filtros</button></div>
          </header>
          {error && <div className="mb-6 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800 ring-1 ring-rose-100"><b>Erro:</b> {error}<br/>Se for erro de tabela inexistente, rode <code>supabase-schema.sql</code> no SQL Editor do Supabase.</div>}
          {loading ? <Card>Carregando dados do Supabase...</Card> : (
            <>
              <section className="mb-6 grid gap-4 md:grid-cols-4">{[[CircleDollarSign,'GMV em negociação',money(totals.gmv),'Soma das compras mensais'],[HandCoins,'Economia projetada',money(totals.savings),'Estimativa média de 12%'],[CalendarClock,'Atividades abertas',String(totals.openActivities),'Próximos follow-ups'],[ShieldCheck,'Parceiros ativos',String(totals.partners),'BPOs com negócios']].map(([Icon,label,value,sub])=><Card key={label as string} className="p-5"><div className="rounded-xl bg-emerald-100 p-2 text-emerald-700 w-fit"><Icon size={20}/></div><p className="mt-4 text-sm text-slate-500">{label as string}</p><p className="text-2xl font-black text-slate-950">{value as string}</p><p className="mt-1 text-xs text-slate-500">{sub as string}</p></Card>)}</section>
              <div className="grid gap-6 xl:grid-cols-[1.05fr_1.4fr]">
                <Card>
                  <h3 className="text-lg font-black">Negócios por etapa</h3><p className="mb-4 text-sm text-slate-500">Cards lidos do Supabase.</p>
                  <div className="grid gap-3">{stages.slice(0,5).map(stage=>{const stageDeals=deals.filter(d=>d.stage_id===stage.id);return <div key={stage.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold text-slate-800">{stage.name}</p><Badge>{stageDeals.length}</Badge></div><div className="space-y-2">{stageDeals.map(deal=><button key={deal.id} onClick={()=>setSelectedId(deal.id)} className={cn('w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5', selected?.id===deal.id?'border-emerald-400 bg-white shadow-lg':'border-slate-200 bg-white/75')}><div className="flex items-start justify-between gap-2"><p className="font-bold leading-tight">{deal.title}</p><Badge tone={statusTone[deal.status || 'morno']}>{statusLabel[deal.status || 'morno']}</Badge></div><p className="mt-2 text-xs text-slate-500">{deal.organizations?.name || 'Sem empresa'}</p><div className="mt-3 flex items-center justify-between text-xs"><span className="font-semibold text-emerald-700">{money(deal.value)}</span><span className="text-slate-500">{deal.bpo_partners?.name || 'Sem BPO'}</span></div></button>)}{stageDeals.length===0 && <div className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-400">Sem cards nesta etapa</div>}</div></div>})}</div>
                </Card>
                <Card className="p-0 overflow-hidden">
                  {selected ? <>
                    <div className="border-b border-slate-200 bg-white p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="mb-2 flex flex-wrap gap-2"><Badge>{selected.source || 'Sem origem'}</Badge><Badge tone="bg-emerald-100 text-emerald-800 ring-emerald-200">Score {selected.score || 0}</Badge><Badge>Fechamento {selected.expected_close_date || 'sem data'}</Badge></div><h3 className="text-2xl font-black">{selected.title}</h3><p className="mt-1 text-sm text-slate-500">{selected.people?.full_name || 'Sem contato'} em {selected.organizations?.name || 'Sem empresa'}</p></div><button onClick={()=>moveDeal(stages[Math.min(selectedStageIndex+1, stages.length-1)]?.id)} className="rounded-xl bg-[#183b2e] px-4 py-2 text-sm font-bold text-white">Avançar etapa</button></div><div className="mt-5 flex flex-wrap items-center gap-1 pb-2">{stages.map((stage,i)=><button key={stage.id} onClick={()=>moveDeal(stage.id)} className={cn('rounded-full px-3 py-1.5 text-xs font-bold', i<=selectedStageIndex?'bg-emerald-500 text-white':'bg-slate-100 text-slate-500')}>{stage.name}</button>)}</div></div>
                    <div className="grid gap-0 lg:grid-cols-[1.25fr_0.85fr]"><div className="p-5"><div className="mb-5 rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100"><div className="flex items-center gap-3"><Star className="text-emerald-700" size={20}/><div><p className="font-black">Foco do negócio</p><p className="text-sm text-slate-600">Próximos passos salvos no banco.</p></div></div><div className="mt-3 space-y-2">{(selected.focus_items||[]).map(item=><label key={item} className="flex items-center gap-2 rounded-xl bg-white p-2 text-sm"><CheckCircle2 size={16} className="text-emerald-600"/>{item}</label>)}</div></div><h4 className="mb-3 font-black">Histórico</h4><div className="space-y-3">{selectedHistory.map(h=><div key={h.id} className="rounded-2xl border border-slate-200 bg-white p-3"><p className="text-sm font-bold">{h.event_type}: {h.title}</p><p className="text-xs text-slate-500">{h.description}</p></div>)}{selectedHistory.length===0 && <p className="text-sm text-slate-500">Sem histórico ainda.</p>}</div><h4 className="mb-3 mt-5 font-black">Atividades abertas</h4><div className="grid gap-3 md:grid-cols-2">{selectedActivities.map(a=><div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><CalendarClock size={18} className="text-emerald-700"/><Badge>{a.status === 'open' ? 'Aberta' : 'Concluída'}</Badge></div><p className="mt-2 text-sm font-bold">{a.title}</p><p className="text-xs text-slate-500">{a.activity_type} · {a.due_at ? new Date(a.due_at).toLocaleString('pt-BR') : 'sem data'}</p>{a.status==='open' && <button onClick={()=>completeActivity(a.id)} className="mt-2 text-xs font-bold text-emerald-700">Marcar concluída</button>}</div>)}</div></div><aside className="border-l border-slate-200 bg-slate-50/80 p-5"><h4 className="mb-3 font-black">Resumo</h4>{[['Valor', money(selected.value), CircleDollarSign], ['Probabilidade', `${selected.probability || 0}%`, UserRound], ['BPO parceiro', selected.bpo_partners?.name || 'Sem BPO', UsersRound], ['Plano', selected.plan || 'N/A', ClipboardList], ['Volume compras', money(selected.monthly_purchase), CircleDollarSign], ['Economia estimada', money(selected.estimated_savings), HandCoins]].map(([k,v,Icon])=><div key={k as string} className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200"><div className="flex items-center gap-2 text-sm text-slate-500"><Icon size={15}/>{k as string}</div><p className="text-right text-sm font-bold">{v as string}</p></div>)}</aside></div>
                  </> : <div className="p-5">Nenhum negócio encontrado. Crie o primeiro abaixo.</div>}
                </Card>
              </div>
              <section className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <Card><h3 className="mb-3 flex items-center gap-2 text-lg font-black"><Plus size={20}/>Criar negócio real</h3><form onSubmit={createDeal} className="grid gap-3"><input className="rounded-xl border p-3" placeholder="Título do negócio" value={newDeal.title} onChange={e=>setNewDeal({...newDeal,title:e.target.value})} required/><input className="rounded-xl border p-3" placeholder="Empresa" value={newDeal.organization_name} onChange={e=>setNewDeal({...newDeal,organization_name:e.target.value})} required/><input className="rounded-xl border p-3" placeholder="Contato" value={newDeal.contact_name} onChange={e=>setNewDeal({...newDeal,contact_name:e.target.value})} required/><div className="grid grid-cols-2 gap-3"><input className="rounded-xl border p-3" placeholder="Mensalidade" value={newDeal.value} onChange={e=>setNewDeal({...newDeal,value:e.target.value})}/><input className="rounded-xl border p-3" placeholder="Compras mensais" value={newDeal.monthly_purchase} onChange={e=>setNewDeal({...newDeal,monthly_purchase:e.target.value})}/></div><select className="rounded-xl border p-3" value={newDeal.stage_id} onChange={e=>setNewDeal({...newDeal,stage_id:e.target.value})}>{stages.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><select className="rounded-xl border p-3" value={newDeal.bpo_id} onChange={e=>setNewDeal({...newDeal,bpo_id:e.target.value})}>{bpos.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select><button disabled={creating} className="rounded-xl bg-[#183b2e] p-3 font-bold text-white disabled:opacity-60">{creating?'Criando...':'Criar no Supabase'}</button></form></Card>
                <Card><h3 className="mb-3 text-lg font-black">Base real</h3><div className="grid gap-3 md:grid-cols-2"><div><h4 className="mb-2 font-bold">Empresas</h4>{organizations.slice(0,5).map(o=><p key={o.id} className="mb-2 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200"><b>{o.name}</b><br/><span className="text-slate-500">{o.segment} · {money(o.monthly_purchase)}</span></p>)}</div><div><h4 className="mb-2 font-bold">Contatos</h4>{people.slice(0,5).map(p=><p key={p.id} className="mb-2 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-slate-200"><b>{p.full_name}</b><br/><span className="text-slate-500">{p.role_title || 'Contato'} · {p.email || 'sem email'}</span></p>)}</div></div></Card>
              </section>
            </>
          )}
        </div>
      </div>
    </main>
  )
}

export default App
