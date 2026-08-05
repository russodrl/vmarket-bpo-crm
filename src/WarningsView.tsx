import { useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { supabase, type ActivityRow, type CrmUser, type Deal, type Organization, type Person } from './supabase'

function cn(...classes: Array<string | false | undefined | null>) { return classes.filter(Boolean).join(' ') }
function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={cn('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tone || 'bg-slate-100 text-slate-600')}>{children}</span>
}
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded border border-slate-200 bg-white', className)}>{children}</section>
}
function daysSince(value?: string | null) {
  if (!value) return 0
  const start = new Date(value).getTime()
  if (Number.isNaN(start)) return 0
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000))
}
function dayLabel(days: number) {
  return `${days} ${days === 1 ? 'dia' : 'dias'}`
}
function normalizeKey(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}
function normalizeDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '')
}
function crmUserForOwner(crmUsers: CrmUser[], ownerId?: string | null) {
  return ownerId ? crmUsers.find((user) => user.auth_user_id === ownerId || user.id === ownerId) : undefined
}
function crmOwnerDisplay(crmUsers: CrmUser[], ownerId?: string | null, fallback = 'Sem proprietário CRM') {
  const owner = crmUserForOwner(crmUsers, ownerId)
  if (!owner) return ownerId ? 'Usuário CRM removido' : fallback
  return `${owner.full_name}${owner.status === 'deleted' ? ' (deletado)' : owner.status === 'disabled' ? ' (desativado)' : ''}`
}

type DuplicateEntity = 'deal' | 'person' | 'organization'

type WarningItem = {
  id: string
  title: string
  subtitle?: string
  meta?: string
  dealId?: string
  duplicate?: {
    entity: DuplicateEntity
    key: string
    groupIds: string[]
  }
}
type WarningGroup = {
  id: string
  section: string
  title: string
  items: WarningItem[]
}

type DuplicateCompare = {
  entity: DuplicateEntity
  key: string
  leftId: string
  rightId: string
}

type CompareField = {
  key: string
  label: string
  left: unknown
  right: unknown
  different: boolean
}

const duplicateEntityLabels: Record<DuplicateEntity, string> = {
  deal: 'Negócio',
  person: 'Contato',
  organization: 'Empresa',
}

const mergeFieldConfig: Record<DuplicateEntity, Array<{ key: string; label: string }>> = {
  deal: [
    { key: 'title', label: 'Título' },
    { key: 'organization_id', label: 'Empresa' },
    { key: 'person_id', label: 'Contato' },
    { key: 'stage_id', label: 'Etapa' },
    { key: 'owner_id', label: 'Proprietário' },
    { key: 'value', label: 'Valor' },
    { key: 'partner_value', label: 'Valor parceiro' },
    { key: 'monthly_purchase', label: 'GMV mensal' },
    { key: 'estimated_savings', label: 'Economia estimada' },
    { key: 'status', label: 'Status' },
    { key: 'lead_source', label: 'Fonte' },
    { key: 'business_type', label: 'Tipo de estabelecimento' },
    { key: 'expected_close_date', label: 'Data esperada' },
    { key: 'lost_reason', label: 'Motivo de perda' },
  ],
  person: [
    { key: 'full_name', label: 'Nome' },
    { key: 'owner_id', label: 'Proprietário do contato' },
    { key: 'role_title', label: 'Cargo' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Telefone' },
    { key: 'ddd_prefix', label: 'DDD' },
    { key: 'ddd_state', label: 'Estado' },
    { key: 'ddd_region', label: 'Região' },
    { key: 'organization_id', label: 'Empresa' },
    { key: 'labels', label: 'Etiquetas' },
    { key: 'bpo_id', label: 'BPO' },
  ],
  organization: [
    { key: 'name', label: 'Nome' },
    { key: 'owner_id', label: 'Proprietário da empresa' },
    { key: 'segment', label: 'Segmento' },
    { key: 'type', label: 'Tipo' },
    { key: 'city', label: 'Cidade' },
    { key: 'state', label: 'Estado' },
    { key: 'cnpjs', label: 'CNPJs' },
    { key: 'monthly_purchase', label: 'GMV mensal' },
    { key: 'supplier_count', label: 'Fornecedores' },
    { key: 'bpo_id', label: 'BPO' },
  ],
}

function isMeaningfulMergeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return false
  if (Array.isArray(value)) return value.length > 0
  return true
}

function mergeFieldValue(preferred: unknown, other: unknown) {
  if (isMeaningfulMergeValue(preferred)) return preferred
  if (isMeaningfulMergeValue(other)) return other
  return preferred ?? other ?? null
}

function mergePayloadForRecords(entity: DuplicateEntity, preferred: Record<string, unknown>, other: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  mergeFieldConfig[entity].forEach(({ key }) => {
    payload[key] = mergeFieldValue(preferred[key], other[key])
  })
  payload.updated_at = new Date().toISOString()
  return payload
}

function duplicateWarningGroups(deals: Deal[], people: Person[], organizations: Organization[]): WarningGroup[] {
  const build = <T extends { id: string }>(id: string, section: string, title: string, entity: DuplicateEntity, rows: T[], keyFor: (row: T) => string, itemFor: (row: T) => WarningItem): WarningGroup => {
    const groups = new Map<string, T[]>()
    rows.forEach((row) => {
      const key = keyFor(row)
      if (!key) return
      groups.set(key, [...(groups.get(key) || []), row])
    })
    const duplicateEntries = [...groups.entries()].filter(([, list]) => list.length > 1)
    const items = duplicateEntries.map(([key, list]) => {
      const item = itemFor(list[0])
      return {
        ...item,
        meta: `${item.meta || ''}${item.meta ? ' · ' : ''}${list.length} registros com a mesma chave`,
        duplicate: { entity, key, groupIds: list.map((duplicateRow) => duplicateRow.id) },
      }
    })
    return { id, section, title, items }
  }
  return [
    build('duplicates-deals', 'Possíveis Duplicatas', 'Negócios', 'deal', deals, (deal) => normalizeKey(deal.title), (deal) => ({ id: deal.id, title: deal.title, subtitle: `${deal.organizations?.name || 'Sem empresa'} · ${deal.people?.full_name || 'Sem contato'}`, dealId: deal.id })),
    build('duplicates-contacts', 'Possíveis Duplicatas', 'Contatos', 'person', people, (person) => normalizeKey(person.email) || normalizeDigits(person.phone) || normalizeKey(person.full_name), (person) => ({ id: person.id, title: person.full_name, subtitle: `${person.email || 'sem email'} · ${person.phone || 'sem telefone'}` })),
    build('duplicates-companies', 'Possíveis Duplicatas', 'Empresas', 'organization', organizations, (org) => normalizeKey(org.name), (org) => ({ id: org.id, title: org.name, subtitle: `${org.city || ''} ${org.state || ''}`.trim() || 'Sem localidade' })),
  ]
}

export default function WarningsView({ deals, people, organizations, activities, crmUsers, openDealPage, reload, setError }: { deals: Deal[]; people: Person[]; organizations: Organization[]; activities: ActivityRow[]; crmUsers: CrmUser[]; openDealPage: (id: string) => void; reload: () => Promise<void>; setError: (error: string) => void }) {
  const [selectedGroup, setSelectedGroup] = useState<WarningGroup | null>(null)
  const [duplicateCompare, setDuplicateCompare] = useState<DuplicateCompare | null>(null)
  const [mergeKeepSide, setMergeKeepSide] = useState<'left' | 'right'>('left')
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeMessage, setMergeMessage] = useState('')
  const openActivitiesByDeal = new Map<string, ActivityRow[]>()
  activities.filter((activity) => activity.deal_id && activity.status === 'open').forEach((activity) => {
    openActivitiesByDeal.set(activity.deal_id!, [...(openActivitiesByDeal.get(activity.deal_id!) || []), activity])
  })
  const assignedDeleted = deals.filter((deal) => crmUserForOwner(crmUsers, deal.owner_id)?.status === 'deleted')
  const assignedDisabled = deals.filter((deal) => crmUserForOwner(crmUsers, deal.owner_id)?.status === 'disabled')
  const unassigned = deals.filter((deal) => !deal.owner_id || !crmUserForOwner(crmUsers, deal.owner_id))
  const assignedPeopleDeleted = people.filter((person) => crmUserForOwner(crmUsers, person.owner_id)?.status === 'deleted')
  const assignedPeopleDisabled = people.filter((person) => crmUserForOwner(crmUsers, person.owner_id)?.status === 'disabled')
  const unassignedPeople = people.filter((person) => !person.owner_id || !crmUserForOwner(crmUsers, person.owner_id))
  const assignedOrganizationsDeleted = organizations.filter((org) => crmUserForOwner(crmUsers, org.owner_id)?.status === 'deleted')
  const assignedOrganizationsDisabled = organizations.filter((org) => crmUserForOwner(crmUsers, org.owner_id)?.status === 'disabled')
  const unassignedOrganizations = organizations.filter((org) => !org.owner_id || !crmUserForOwner(crmUsers, org.owner_id))
  const dealItem = (deal: Deal): WarningItem => ({
    id: deal.id,
    title: deal.title,
    subtitle: `${deal.organizations?.name || 'Sem empresa'} · ${deal.people?.full_name || 'Sem contato'}`,
    meta: `${crmOwnerDisplay(crmUsers, deal.owner_id, 'Sem usuário')} · ${deal.pipeline_stages?.name || 'Sem etapa'}`,
    dealId: deal.id,
  })
  const personItem = (person: Person): WarningItem => ({
    id: person.id,
    title: person.full_name,
    subtitle: `${person.email || 'sem email'} · ${person.phone || 'sem telefone'}`,
    meta: `${crmOwnerDisplay(crmUsers, person.owner_id, 'Sem usuário')} · ${organizations.find((org) => org.id === person.organization_id)?.name || 'Sem empresa'}`,
  })
  const organizationItem = (org: Organization): WarningItem => ({
    id: org.id,
    title: org.name,
    subtitle: `${org.city || ''} ${org.state || ''}`.trim() || 'Sem localidade',
    meta: `${crmOwnerDisplay(crmUsers, org.owner_id, 'Sem usuário')} · ${org.type || org.segment || 'Sem tipo'}`,
  })
  const withoutActivityBase = deals.filter((deal) => deal.status === 'aberto' && deal.lead_source === 'vmarket' && !openActivitiesByDeal.get(deal.id)?.length)
  const thresholds = [
    ['open-vmarket-no-activity-7', '+1 semana', 7],
    ['open-vmarket-no-activity-14', '+2 semanas', 14],
    ['open-vmarket-no-activity-21', '+3 semanas', 21],
    ['open-vmarket-no-activity-28', '+4 semanas', 28],
    ['open-vmarket-no-activity-30', '+1 mês', 30],
    ['open-vmarket-no-activity-60', '+2 meses', 60],
    ['open-vmarket-no-activity-90', '+3 meses', 90],
  ] as const
  const groups: WarningGroup[] = [
    ...duplicateWarningGroups(deals, people, organizations),
    { id: 'assigned-deleted', section: 'Negócios com usuários Atribuídos', title: 'Deletados', items: assignedDeleted.map(dealItem) },
    { id: 'assigned-disabled', section: 'Negócios com usuários Atribuídos', title: 'Desativados', items: assignedDisabled.map(dealItem) },
    { id: 'assigned-missing', section: 'Negócios com usuários Atribuídos', title: 'Sem usuários', items: unassigned.map(dealItem) },
    { id: 'assigned-people-deleted', section: 'Contatos com usuários Atribuídos', title: 'Deletados', items: assignedPeopleDeleted.map(personItem) },
    { id: 'assigned-people-disabled', section: 'Contatos com usuários Atribuídos', title: 'Desativados', items: assignedPeopleDisabled.map(personItem) },
    { id: 'assigned-people-missing', section: 'Contatos com usuários Atribuídos', title: 'Sem usuários', items: unassignedPeople.map(personItem) },
    { id: 'assigned-organizations-deleted', section: 'Empresas com usuários Atribuídos', title: 'Deletados', items: assignedOrganizationsDeleted.map(organizationItem) },
    { id: 'assigned-organizations-disabled', section: 'Empresas com usuários Atribuídos', title: 'Desativados', items: assignedOrganizationsDisabled.map(organizationItem) },
    { id: 'assigned-organizations-missing', section: 'Empresas com usuários Atribuídos', title: 'Sem usuários', items: unassignedOrganizations.map(organizationItem) },
    ...thresholds.map(([id, title, days]) => ({
      id,
      section: 'Negócios abertos VMarket sem atividade',
      title,
      items: withoutActivityBase
        .filter((deal) => daysSince(deal.pipedrive_stage_entered_at || deal.updated_at || deal.pipedrive_deal_created_at || deal.created_at) >= days)
        .map((deal) => ({ ...dealItem(deal), meta: `${dealItem(deal).meta} · ${dayLabel(daysSince(deal.pipedrive_stage_entered_at || deal.updated_at || deal.pipedrive_deal_created_at || deal.created_at))} sem atividade aberta` })),
    })),
  ]
  const sections = [...new Set(groups.map((group) => group.section))]
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const recordForCompare = (entity: DuplicateEntity, id: string): Record<string, unknown> | undefined => {
    if (entity === 'deal') return deals.find((deal) => deal.id === id) as Record<string, unknown> | undefined
    if (entity === 'person') return people.find((person) => person.id === id) as Record<string, unknown> | undefined
    return organizations.find((org) => org.id === id) as Record<string, unknown> | undefined
  }
  const labelForValue = (entity: DuplicateEntity, key: string, value: unknown) => {
    if (!isMeaningfulMergeValue(value)) return '-'
    if (Array.isArray(value)) return value.join(', ')
    if (entity === 'deal' && key === 'organization_id') return organizations.find((org) => org.id === value)?.name || String(value)
    if (entity === 'deal' && key === 'person_id') return people.find((person) => person.id === value)?.full_name || String(value)
    if (entity === 'person' && key === 'organization_id') return organizations.find((org) => org.id === value)?.name || String(value)
    if (key === 'owner_id') return crmOwnerDisplay(crmUsers, value as string | null, 'Sem usuário')
    return String(value)
  }
  const compareFields = (compare: DuplicateCompare): CompareField[] => {
    const left = recordForCompare(compare.entity, compare.leftId)
    const right = recordForCompare(compare.entity, compare.rightId)
    if (!left || !right) return []
    return mergeFieldConfig[compare.entity].map(({ key, label }) => {
      const leftValue = labelForValue(compare.entity, key, left[key])
      const rightValue = labelForValue(compare.entity, key, right[key])
      return { key, label, left: leftValue, right: rightValue, different: normalizeKey(leftValue) !== normalizeKey(rightValue) }
    })
  }
  const openDuplicateCompare = (item: WarningItem) => {
    if (!item.duplicate) return
    const rightId = item.duplicate.groupIds.find((id) => id !== item.id)
    if (!rightId) return
    setMergeKeepSide('left')
    setDuplicateCompare({ entity: item.duplicate.entity, key: item.duplicate.key, leftId: item.id, rightId })
  }
  const closeDuplicateCompare = () => {
    setDuplicateCompare(null)
    setMergeMessage('')
  }
  const mergeDuplicateRecords = async () => {
    if (!duplicateCompare) return
    const left = recordForCompare(duplicateCompare.entity, duplicateCompare.leftId)
    const right = recordForCompare(duplicateCompare.entity, duplicateCompare.rightId)
    if (!left || !right) return
    const keepId = mergeKeepSide === 'left' ? duplicateCompare.leftId : duplicateCompare.rightId
    const removeId = mergeKeepSide === 'left' ? duplicateCompare.rightId : duplicateCompare.leftId
    const preferred = mergeKeepSide === 'left' ? left : right
    const other = mergeKeepSide === 'left' ? right : left
    const payload = mergePayloadForRecords(duplicateCompare.entity, preferred, other)
    setMergeBusy(true)
    setError('')
    try {
      if (duplicateCompare.entity === 'deal') {
        const { error: updateError } = await supabase.from('deals').update(payload).eq('id', keepId)
        if (updateError) throw updateError
        const { error: activityError } = await supabase.from('activities').update({ deal_id: keepId }).eq('deal_id', removeId)
        if (activityError) throw activityError
        const { error: historyError } = await supabase.from('deal_history').update({ deal_id: keepId }).eq('deal_id', removeId)
        if (historyError) throw historyError
        const { error: deleteError } = await supabase.from('deals').delete().eq('id', removeId)
        if (deleteError) throw deleteError
        const ownerToSync = (payload.owner_id as string | null | undefined) || (preferred.owner_id as string | null | undefined) || null
        if (ownerToSync) {
          const { error: syncError } = await supabase.from('deals').update({ owner_id: ownerToSync }).eq('id', keepId)
          if (syncError) throw syncError
        }
      } else if (duplicateCompare.entity === 'person') {
        const { error: updateError } = await supabase.from('people').update(payload).eq('id', keepId)
        if (updateError) throw updateError
        const { error: dealError } = await supabase.from('deals').update({ person_id: keepId }).eq('person_id', removeId)
        if (dealError) throw dealError
        const { error: activityError } = await supabase.from('activities').update({ person_id: keepId }).eq('person_id', removeId)
        if (activityError) throw activityError
        const { error: deleteError } = await supabase.from('people').delete().eq('id', removeId)
        if (deleteError) throw deleteError
      } else {
        const { error: updateError } = await supabase.from('organizations').update(payload).eq('id', keepId)
        if (updateError) throw updateError
        const { error: dealError } = await supabase.from('deals').update({ organization_id: keepId }).eq('organization_id', removeId)
        if (dealError) throw dealError
        const { error: peopleError } = await supabase.from('people').update({ organization_id: keepId }).eq('organization_id', removeId)
        if (peopleError) throw peopleError
        const { error: activityError } = await supabase.from('activities').update({ organization_id: keepId }).eq('organization_id', removeId)
        if (activityError) throw activityError
        const { error: deleteError } = await supabase.from('organizations').delete().eq('id', removeId)
        if (deleteError) throw deleteError
      }
      setMergeMessage('Registros mesclados com sucesso.')
      setSelectedGroup(null)
      setDuplicateCompare(null)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMergeBusy(false)
    }
  }
  const duplicateLeft = duplicateCompare ? recordForCompare(duplicateCompare.entity, duplicateCompare.leftId) : undefined
  const duplicateRight = duplicateCompare ? recordForCompare(duplicateCompare.entity, duplicateCompare.rightId) : undefined
  const duplicateFields = duplicateCompare ? compareFields(duplicateCompare) : []

  return <div className="h-full overflow-y-auto p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-2xl font-black tracking-[-0.04em] text-slate-950">Avisos</h2>
        <p className="mt-1 text-sm text-slate-500">Contagens operacionais para duplicatas, atribuições de usuários em negócios, contatos e empresas, e negócios VMarket sem atividade aberta.</p>
        {mergeMessage && <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{mergeMessage}</p>}
      </div>
      <Badge tone={total ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}>{total} registros contabilizados</Badge>
    </div>
    <div className="grid gap-4 xl:grid-cols-3">
      {sections.map((section) => <Panel key={section} className="overflow-hidden">
        <div className="border-b border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-500"/><h3 className="font-black text-slate-900">{section}</h3></div>
        </div>
        <div className="divide-y divide-slate-100">
          {groups.filter((group) => group.section === section).map((group) => <button type="button" key={group.id} onClick={() => setSelectedGroup(group)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-amber-50">
            <span className="font-semibold text-slate-800">{group.title}</span>
            <span className={cn('rounded-full px-3 py-1 text-sm font-black', group.items.length ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500')}>{group.items.length}</span>
          </button>)}
        </div>
      </Panel>)}
    </div>
    {selectedGroup && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div><p className="text-xs font-black uppercase tracking-wide text-amber-600">{selectedGroup.section}</p><h2 className="mt-1 text-xl font-black text-slate-950">{selectedGroup.title} · {selectedGroup.items.length}</h2></div>
          <button type="button" onClick={() => setSelectedGroup(null)} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {selectedGroup.items.length ? <div className="space-y-2">{selectedGroup.items.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
            {item.duplicate ? <button type="button" onClick={() => openDuplicateCompare(item)} className="text-left font-black text-blue-700 hover:underline">{item.title}</button> : item.dealId ? <button type="button" onClick={() => { setSelectedGroup(null); openDealPage(item.dealId!) }} className="text-left font-black text-blue-700 hover:underline">{item.title}</button> : <b className="text-slate-950">{item.title}</b>}
            {item.subtitle && <p className="mt-1 text-slate-600">{item.subtitle}</p>}
            {item.meta && <p className="mt-1 text-xs font-semibold text-slate-400">{item.meta}</p>}
            {item.duplicate && <p className="mt-2 text-xs font-bold text-amber-700">Clique para comparar e mesclar este registro com a duplicata.</p>}
          </div>)}</div> : <div className="p-8 text-center text-sm text-slate-400">Nenhum item contabilizado nesse aviso.</div>}
        </div>
      </div>
    </div>}
    {duplicateCompare && duplicateLeft && duplicateRight && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-amber-600">Mesclar duplicata · {duplicateEntityLabels[duplicateCompare.entity]}</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">Comparar registros lado a lado</h2>
            <p className="mt-1 text-sm text-slate-500">Campos divergentes ficam marcados. Na mesclagem, campos vazios são preenchidos com o outro registro e divergências mantêm a tela escolhida.</p>
          </div>
          <button type="button" onClick={closeDuplicateCompare} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            {(['left', 'right'] as const).map((side) => {
              const record = side === 'left' ? duplicateLeft : duplicateRight
              return <div key={side} className={cn('rounded-2xl border p-4', mergeKeepSide === side ? 'border-blue-400 bg-blue-50/30 ring-2 ring-blue-100' : 'border-slate-200 bg-white')}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase text-slate-400">Tela {side === 'left' ? 'A' : 'B'}</p>
                    <h3 className="text-lg font-black text-slate-950">{String(record.title || record.full_name || record.name || record.id)}</h3>
                  </div>
                  <Badge tone={mergeKeepSide === side ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}>{mergeKeepSide === side ? 'Selecionada' : 'Comparação'}</Badge>
                </div>
                <div className="space-y-2">
                  {duplicateFields.map((field) => <div key={field.key} className={cn('rounded-lg border p-3', field.different ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white')}>
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{field.label}</p>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-800">{String(side === 'left' ? field.left : field.right)}</p>
                    {field.different && <p className="mt-1 text-[11px] font-bold text-amber-700">Diferente</p>}
                  </div>)}
                </div>
              </div>
            })}
          </div>
          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-sm font-bold text-slate-800">Manter esses dados</label>
            <select value={mergeKeepSide} onChange={(e) => setMergeKeepSide(e.target.value as 'left' | 'right')} className="mt-2 w-full max-w-sm rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">
              <option value="left">Tela A</option>
              <option value="right">Tela B</option>
            </select>
            <button type="button" onClick={() => void mergeDuplicateRecords()} disabled={mergeBusy} className="mt-4 rounded bg-[#238847] px-5 py-2.5 text-sm font-black text-white hover:bg-[#1f7a40] disabled:opacity-60">{mergeBusy ? 'Mesclando...' : 'Mesclar'}</button>
          </div>
        </div>
      </div>
    </div>}
  </div>
}
