import type { ReactNode } from 'react'
import type { CrmUser, Deal } from './supabase'

const statusLabel: Record<string, string> = { aberto: 'Aberto', ganho: 'Ganho', perdido: 'Perdido' }
const normalizeKey = (value?: string | null) => (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
const crmPermissionLabel = (user: CrmUser) => user.permission || (user.email?.toLowerCase().includes('teste') ? 'Teste' : 'BPO')
const cn = (...classes: Array<string | false | undefined | null>) => classes.filter(Boolean).join(' ')

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>
}

export default function LeadDistributionView({ users, deals }: { users: CrmUser[]; deals: Deal[] }) {
  const activeUsers = users.filter((user) => user.status === 'active' && user.auth_user_id && !['Admin', 'Teste'].includes(crmPermissionLabel(user)) && !normalizeKey(`${user.full_name} ${user.email}`).includes('aspalamar'))
  const isDistributionOpenDeal = (deal: Deal) => (deal.status === 'aberto' || !deal.status || !statusLabel[deal.status]) && deal.pipeline_stages?.pipeline_name === 'Pipeline de Vendas'
  const companyNameForUser = (user: CrmUser) => user.crm_companies?.name || 'Sem empresa'
  const statsForUser = (user: CrmUser) => {
    const userDeals = deals.filter((deal) => deal.owner_id && deal.owner_id === user.auth_user_id)
    return {
      received: userDeals.length,
      open: userDeals.filter(isDistributionOpenDeal).length,
      won: userDeals.filter((deal) => deal.status === 'ganho').length,
      lost: userDeals.filter((deal) => deal.status === 'perdido').length,
    }
  }
  const companyStats = [...new Set(activeUsers.map(companyNameForUser))].map((company) => {
    const companyUsers = activeUsers.filter((user) => companyNameForUser(user) === company)
    const authIds = new Set(companyUsers.map((user) => user.auth_user_id))
    const companyDeals = deals.filter((deal) => deal.owner_id && authIds.has(deal.owner_id))
    const ddds = [...new Set(companyUsers.map((user) => user.ddd_prefix).filter(Boolean))]
    const states = [...new Set(companyUsers.map((user) => user.ddd_state).filter(Boolean))]
    return {
      company,
      users: companyUsers,
      ddds,
      states,
      received: companyDeals.length,
      open: companyDeals.filter(isDistributionOpenDeal).length,
      won: companyDeals.filter((deal) => deal.status === 'ganho').length,
      lost: companyDeals.filter((deal) => deal.status === 'perdido').length,
    }
  }).sort((a, b) => a.open - b.open || a.received - b.received || a.company.localeCompare(b.company, 'pt-BR'))
  const orderUsers = (list: CrmUser[]) => [...list].sort((a, b) => {
    const sa = statsForUser(a)
    const sb = statsForUser(b)
    return sa.open - sb.open || sa.received - sb.received || a.full_name.localeCompare(b.full_name, 'pt-BR')
  })
  const nextCompany = companyStats[0]
  const nextUserInCompany = nextCompany ? orderUsers(nextCompany.users)[0] : undefined
  const queueCard = (title: string, subtitle: string, next?: CrmUser, extra?: string) => {
    const stats = next ? statsForUser(next) : null
    return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">{title}</p>
      <h3 className="mt-1 text-base font-bold text-slate-950">{subtitle}</h3>
      {extra && <p className="mt-1 text-xs text-slate-500">{extra}</p>}
      {next ? <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="font-black">Próximo usuário: {next.full_name}</p>
        <p className="mt-1 text-xs">Empresa {companyNameForUser(next)}</p>
        <p className="mt-1 text-xs">Abertos {stats?.open || 0} · Ganhos {stats?.won || 0} · Recebidos {stats?.received || 0}</p>
      </div> : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">Nenhum usuário ativo nessa fila.</p>}
    </div>
  }
  const userRows = users.map((user) => ({ user, stats: statsForUser(user) })).sort((a, b) => companyNameForUser(a.user).localeCompare(companyNameForUser(b.user), 'pt-BR') || a.user.full_name.localeCompare(b.user.full_name, 'pt-BR'))

  return <div className="h-full overflow-auto p-4">
    <div className="mb-4">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-slate-950">Distribuição de Leads</h2>
      <p className="mt-1 text-sm text-slate-500">Ordem de distribuição: primeiro respeita o DDD do lead, depois o estado, e só então a fila geral. Em cada etapa a escolha é por empresa parceira, não por usuário solto. Depois entrega para o próximo usuário ativo dentro da empresa escolhida. A fila exclui usuários com permissão Admin ou Teste, usuários desativados, deletados e contas de teste.</p>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-200 p-4"><h3 className="font-black">Próxima empresa na fila geral</h3><p className="text-xs text-slate-500">Para cada lead, o CRM tenta primeiro empresas com o DDD do contato, depois o estado, depois esta fila geral.</p></div>
        <div className="p-4">{queueCard(nextCompany?.company || 'Fila de empresa', nextCompany ? `${nextCompany.open} leads abertos · ${nextCompany.users.length} usuário(s)` : 'Nenhuma empresa ativa', nextUserInCompany, nextCompany ? `DDDs ${nextCompany.ddds.join(', ') || '-'} · Estados ${nextCompany.states.join(', ') || '-'} · Recebidos ${nextCompany.received}` : undefined)}</div>
      </Panel>
      <Panel className="overflow-hidden">
        <div className="border-b border-slate-200 p-4"><h3 className="font-black">Fila das empresas</h3><p className="text-xs text-slate-500">Empresas aparecem na fila do DDD ou estado quando algum usuário elegível da empresa tem esse DDD/estado.</p></div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">{companyStats.length ? companyStats.map((company) => queueCard(company.company, `${company.open} abertos · ${company.received} recebidos`, orderUsers(company.users)[0], `DDDs ${company.ddds.join(', ') || '-'} · Estados ${company.states.join(', ') || '-'}`)) : <p className="text-sm text-slate-500">Nenhuma empresa ativa mapeada.</p>}</div>
      </Panel>
    </div>
    <Panel className="mt-4 overflow-hidden">
      <div className="border-b border-slate-200 p-4"><h3 className="font-black">Usuários e desempenho</h3><p className="text-xs text-slate-500">Contagem por usuário, agrupada pela empresa de distribuição.</p></div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">DDD</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Recebidos</th><th className="px-4 py-3">Abertos</th><th className="px-4 py-3">Perdidos</th><th className="px-4 py-3">Ganhos</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{userRows.map(({ user, stats }) => <tr key={user.id} className="bg-white"><td className="px-4 py-3 font-semibold text-slate-700">{companyNameForUser(user)}</td><td className="px-4 py-3"><b>{user.full_name}</b><p className="text-xs text-slate-400">{user.email}</p></td><td className="px-4 py-3">{user.ddd_prefix || '-'}</td><td className="px-4 py-3">{user.ddd_state || '-'}</td><td className="px-4 py-3 font-semibold">{stats.received}</td><td className="px-4 py-3 font-semibold text-blue-700">{stats.open}</td><td className="px-4 py-3 font-semibold text-rose-700">{stats.lost}</td><td className="px-4 py-3 font-semibold text-emerald-700">{stats.won}</td></tr>)}</tbody>
        </table>
      </div>
    </Panel>
  </div>
}
