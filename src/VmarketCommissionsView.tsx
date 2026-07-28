import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Deal, HistoryRow, Stage } from './supabase'

const statusLabel: Record<string, string> = { aberto: 'Aberto', ganho: 'Ganho', perdido: 'Perdido' }
const money = (value?: number | null) =>
  Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const cn = (...classes: Array<string | false | undefined | null>) => classes.filter(Boolean).join(' ')
const getDealVmarketValue = (deal: Pick<Deal, 'value'>) => Number(deal.value || 0)

function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold', tone || 'bg-slate-100 text-slate-600')}>{children}</span>
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>
}

type CommissionMetric = {
  key: string
  label: string
  value: string
  description: string
  deals: Deal[]
  tone?: string
}

export default function VmarketCommissionsView({ deals, stages, history, selectedId, setSelectedId, openDealPage }: { deals: Deal[]; stages: Stage[]; history: HistoryRow[]; selectedId?: string; setSelectedId: (id: string) => void; openDealPage: (id: string) => void }) {
  const [openMetric, setOpenMetric] = useState<CommissionMetric | null>(null)
  const [currentDate] = useState(() => new Date())
  const historyByDeal = history.reduce<Map<string, HistoryRow[]>>((acc, row) => {
    acc.set(row.deal_id, [...(acc.get(row.deal_id) || []), row])
    return acc
  }, new Map())
  const stageName = (deal: Deal) => stages.find((stage) => stage.id === deal.stage_id)?.name || deal.pipeline_stages?.name || ''
  const dealText = (deal: Deal) => `${deal.title} ${stageName(deal)} ${deal.lost_reason || ''} ${(historyByDeal.get(deal.id) || []).map((row) => `${row.title} ${row.description || ''}`).join(' ')}`.toLocaleLowerCase('pt-BR')
  const monthKey = (deal: Deal) => {
    const source = deal.expected_close_date || deal.pipedrive_stage_entered_at || deal.pipedrive_deal_created_at || deal.updated_at || deal.created_at || currentDate.toISOString()
    const date = new Date(source)
    if (Number.isNaN(date.getTime())) return currentDate.toISOString().slice(0, 7)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  }
  const monthLabel = (key: string) => {
    const [year, month] = key.split('-')
    const names: Record<string, string> = { '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Abr', '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Ago', '09': 'Set', '10': 'Out', '11': 'Nov', '12': 'Dez' }
    return `${names[month] || month}/${year?.slice(2) || ''}`
  }
  const monthsBetweenNow = (deal: Deal) => {
    const start = new Date(deal.expected_close_date || deal.pipedrive_stage_entered_at || deal.pipedrive_deal_created_at || deal.created_at || currentDate.toISOString())
    if (Number.isNaN(start.getTime())) return 0
    const now = currentDate
    return Math.max(0, Math.min(12, (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth()))
  }
  const isVmarketDeal = (deal: Deal) => Boolean(deal.vm_sale || getDealVmarketValue(deal) > 0)
  const wonDeals = deals.filter((deal) => isVmarketDeal(deal) && deal.status === 'ganho')
  const cancelledDeals = wonDeals.filter((deal) => /cancel|perdid|parou|churn|encerr/.test(dealText(deal)) || deal.status === 'perdido')
  const overdueDeals = wonDeals.filter((deal) => !cancelledDeals.includes(deal) && /atras|inadimpl|retid|parou de pagar|sem pagamento/.test(dealText(deal)))
  const paidDeals = wonDeals.filter((deal) => /pagamento recebido|pago|pagou|primeiro pagamento|1o pagamento|1º pagamento/.test(dealText(deal)))
  const awaitingFirstPaymentDeals = wonDeals.filter((deal) => !cancelledDeals.includes(deal) && !overdueDeals.includes(deal) && !paidDeals.includes(deal))
  const activePaidDeals = wonDeals.filter((deal) => !cancelledDeals.includes(deal) && !overdueDeals.includes(deal))
  const sumValue = (rows: Deal[]) => rows.reduce((acc, deal) => acc + getDealVmarketValue(deal), 0)
  const commissionFirstInstallment = (deal: Deal) => getDealVmarketValue(deal)
  const commissionRecurring12 = (deal: Deal) => getDealVmarketValue(deal) * 0.2 * 12
  const commissionTotal = (deal: Deal) => commissionFirstInstallment(deal) + commissionRecurring12(deal)
  const commissionPaidEstimate = (deal: Deal) => commissionFirstInstallment(deal) + (getDealVmarketValue(deal) * 0.2 * monthsBetweenNow(deal))
  const commissionLost = (deal: Deal) => Math.max(0, commissionTotal(deal) - commissionPaidEstimate(deal))
  const monthlyCommission = activePaidDeals.reduce((acc, deal) => acc + getDealVmarketValue(deal) * 0.2, 0) + awaitingFirstPaymentDeals.reduce((acc, deal) => acc + commissionFirstInstallment(deal), 0)
  const previousMonthCommission = activePaidDeals.filter((deal) => monthKey(deal) < currentDate.toISOString().slice(0, 7)).reduce((acc, deal) => acc + getDealVmarketValue(deal) * 0.2, 0)
  const variation = previousMonthCommission > 0 ? ((monthlyCommission - previousMonthCommission) / previousMonthCommission) * 100 : (monthlyCommission > 0 ? 100 : 0)
  const metrics: CommissionMetric[] = [
    { key: 'won', label: 'Total de negócios ganhos', value: String(wonDeals.length), description: 'Negócios VMarket marcados como ganhos.', deals: wonDeals, tone: 'ring-emerald-200' },
    { key: 'awaiting', label: 'Negócios aguardando primeiro pagamento', value: String(awaitingFirstPaymentDeals.length), description: 'Ganhos sem registro textual de pagamento no histórico.', deals: awaitingFirstPaymentDeals, tone: 'ring-amber-200' },
    { key: 'overdue', label: 'Negócios com pagamento em atraso, comissão retida', value: String(overdueDeals.length), description: 'Ganhos com sinais de atraso, inadimplência ou retenção.', deals: overdueDeals, tone: 'ring-rose-200' },
    { key: 'monthly-subscription', label: 'Valor de assinaturas mensais VMarket atual', value: money(sumValue(activePaidDeals)), description: 'Soma mensal VMarket dos ganhos ativos.', deals: activePaidDeals },
    { key: 'first-commission', label: 'Total ganho de Comissão de 1 parcela', value: money(wonDeals.reduce((acc, deal) => acc + commissionFirstInstallment(deal), 0)), description: '100% da primeira parcela VMarket dos negócios ganhos.', deals: wonDeals },
    { key: 'recurring-commission', label: 'Total ganho de Comissão 20% dos 12 primeiros meses', value: money(wonDeals.reduce((acc, deal) => acc + commissionRecurring12(deal), 0)), description: '20% ao mês sobre a assinatura VMarket por 12 meses.', deals: wonDeals },
    { key: 'total-commission', label: 'Comissão total ganha', value: money(wonDeals.reduce((acc, deal) => acc + commissionTotal(deal), 0)), description: 'Primeira parcela + 20% dos 12 primeiros meses.', deals: wonDeals, tone: 'ring-blue-200' },
    { key: 'cancelled', label: 'Negócios cancelados', value: String(cancelledDeals.length), description: 'Ganhos com indicação de cancelamento ou perda.', deals: cancelledDeals, tone: 'ring-slate-300' },
    { key: 'cancelled-subscription', label: 'Valor de Assinatura mensal cancelada', value: money(sumValue(cancelledDeals)), description: 'Soma mensal VMarket cancelada.', deals: cancelledDeals },
    { key: 'lost-commission', label: 'Comissão perdida', value: money(cancelledDeals.reduce((acc, deal) => acc + commissionLost(deal), 0)), description: 'Comissão de 12 meses menos valor estimado já pago até o cancelamento.', deals: cancelledDeals, tone: 'ring-rose-200' },
  ]
  const chartRows = [
    { key: 'monthly', label: 'Comissionamento mensal previsto', deals: activePaidDeals, valueFor: (deal: Deal) => getDealVmarketValue(deal) * 0.2 },
    { key: 'first', label: 'Comissão de 1 parcela', deals: wonDeals, valueFor: commissionFirstInstallment },
    { key: 'recurring', label: 'Comissão 20% dos 12 meses', deals: wonDeals, valueFor: commissionRecurring12 },
    { key: 'lost', label: 'Comissão perdida', deals: cancelledDeals, valueFor: commissionLost },
  ].map((chart) => {
    const byMonth = chart.deals.reduce<Record<string, { value: number; deals: Deal[] }>>((acc, deal) => {
      const key = monthKey(deal)
      if (!acc[key]) acc[key] = { value: 0, deals: [] }
      acc[key].value += chart.valueFor(deal)
      acc[key].deals.push(deal)
      return acc
    }, {})
    return { ...chart, months: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12) }
  })
  const maxChartValue = Math.max(1, ...chartRows.flatMap((chart) => chart.months.map(([, row]) => row.value)))
  const openDeal = (deal: Deal) => {
    setSelectedId(deal.id)
    openDealPage(deal.id)
  }

  return <div className="min-h-0 flex-1 overflow-auto bg-[#f4f5f7] p-4 md:p-6">
    <div className="mb-5 rounded-2xl bg-[#211746] p-5 text-white shadow-sm md:flex md:items-end md:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em] text-white/60">Comissões VMarket</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight">{money(monthlyCommission)}</h2>
        <p className="mt-1 text-sm text-white/70">Comissionamento previsto para este mês se todos os clientes ativos pagarem.</p>
      </div>
      <button type="button" onClick={() => setOpenMetric({ key: 'monthly-top', label: 'Comissionamento previsto do mês', value: money(monthlyCommission), description: '20% das assinaturas ativas + primeira parcela dos negócios aguardando primeiro pagamento.', deals: [...activePaidDeals, ...awaitingFirstPaymentDeals] })} className="mt-4 rounded-xl bg-white/10 px-4 py-3 text-left ring-1 ring-white/15 hover:bg-white/15 md:mt-0">
        <p className="text-xs font-bold uppercase text-white/60">Variação mensal</p>
        <p className={cn('text-2xl font-black', variation >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{variation >= 0 ? '+' : ''}{variation.toFixed(1)}%</p>
      </button>
    </div>

    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric) => <button key={metric.key} type="button" onClick={() => setOpenMetric(metric)} className={cn('rounded-xl bg-white p-4 text-left shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-md', metric.tone || 'ring-slate-200')}>
        <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">{metric.label}</p>
        <p className="mt-2 text-2xl font-black text-slate-950">{metric.value}</p>
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{metric.description}</p>
        <p className="mt-3 text-xs font-bold text-blue-700">Abrir negócios referentes</p>
      </button>)}
    </div>

    <div className="mt-5 grid gap-4 xl:grid-cols-2">
      {chartRows.map((chart) => <Panel key={chart.key} className="overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <h3 className="font-black text-slate-900">{chart.label}</h3>
          <p className="mt-1 text-xs text-slate-500">Clique em qualquer barra para abrir os negócios do mês.</p>
        </div>
        <div className="flex h-72 items-end gap-2 overflow-x-auto px-4 py-5">
          {chart.months.map(([key, row]) => <button key={key} type="button" onClick={() => setOpenMetric({ key: `${chart.key}-${key}`, label: `${chart.label} em ${monthLabel(key)}`, value: money(row.value), description: `${row.deals.length} negócios referentes ao mês.`, deals: row.deals })} className="flex h-full min-w-[58px] flex-col items-center justify-end gap-2 rounded-lg px-2 py-1 hover:bg-blue-50">
            <span className="text-[10px] font-bold text-slate-500">{money(row.value)}</span>
            <span className="w-full rounded-t bg-[#238847] transition-all" style={{ height: `${Math.max(8, (row.value / maxChartValue) * 210)}px` }} />
            <span className="text-[10px] font-bold text-slate-600">{monthLabel(key)}</span>
          </button>)}
          {!chart.months.length && <div className="grid h-full flex-1 place-items-center text-sm text-slate-400">Sem dados para exibir.</div>}
        </div>
      </Panel>)}
    </div>

    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <b>Critério atual:</b> enquanto não houver uma tabela de pagamentos, a tela usa negócios ganhos VMarket, valores VMarket, estágio, motivo de perda e histórico textual para identificar primeiro pagamento, atraso, retenção e cancelamento.
    </div>

    {openMetric && <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={() => setOpenMetric(null)}>
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div><h2 className="text-xl font-black text-slate-950">{openMetric.label}</h2><p className="mt-1 text-sm text-slate-500">{openMetric.value} · {openMetric.description}</p></div>
          <button type="button" onClick={() => setOpenMetric(null)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">×</button>
        </div>
        <div className="min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white"><tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase text-slate-500"><th className="px-4 py-3">Negócio</th><th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Etapa</th><th className="px-4 py-3">Valor VMarket</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {openMetric.deals.map((deal) => <tr key={deal.id} onClick={() => openDeal(deal)} className={cn('cursor-pointer hover:bg-blue-50', selectedId === deal.id ? 'bg-blue-50' : '')}>
                <td className="px-4 py-3 font-semibold text-slate-900">{deal.title}</td>
                <td className="px-4 py-3 text-slate-600">{deal.organizations?.name || '-'}</td>
                <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{stageName(deal) || '-'}</span></td>
                <td className="px-4 py-3 font-semibold text-slate-800">{money(getDealVmarketValue(deal))}</td>
                <td className="px-4 py-3"><Badge tone={deal.status === 'ganho' ? 'bg-emerald-100 text-emerald-700' : deal.status === 'perdido' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-700'}>{statusLabel[deal.status || 'aberto'] || 'Aberto'}</Badge></td>
              </tr>)}
            </tbody>
          </table>
          {!openMetric.deals.length && <p className="p-8 text-center text-sm text-slate-400">Nenhum negócio referente a esta informação.</p>}
        </div>
      </div>
    </div>}
  </div>
}
