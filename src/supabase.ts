import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(supabaseUrl || 'https://example.supabase.co', supabaseAnonKey || 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

export type Profile = {
  id: string
  full_name: string | null
  role: 'admin_vmarket' | 'bpo_partner'
  bpo_id: string | null
}

export type Stage = {
  id: string
  name: string
  sort_order: number
  color: string | null
}

export type BpoPartner = {
  id: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
}

export type Organization = {
  id: string
  name: string
  segment: string | null
  city: string | null
  state: string | null
  cnpjs: number | null
  monthly_purchase: number | null
  supplier_count: number | null
  bpo_id: string | null
}

export type Person = {
  id: string
  full_name: string
  role_title: string | null
  email: string | null
  phone: string | null
  organization_id: string | null
  labels: string[] | null
  bpo_id: string | null
}

export type Deal = {
  id: string
  title: string
  organization_id: string | null
  person_id: string | null
  stage_id: string | null
  owner_id: string | null
  bpo_id: string | null
  value: number | null
  monthly_purchase: number | null
  estimated_savings: number | null
  probability: number | null
  status: 'quente' | 'morno' | 'risco' | 'ganho' | 'perdido' | null
  source: string | null
  plan: string | null
  expected_close_date: string | null
  score: number | null
  focus_items: string[] | null
  organizations?: Organization | null
  people?: Person | null
  bpo_partners?: BpoPartner | null
  pipeline_stages?: Stage | null
}

export type ActivityRow = {
  id: string
  title: string
  activity_type: string
  due_at: string | null
  status: 'open' | 'done' | 'cancelled'
  note: string | null
  deal_id: string | null
  organization_id: string | null
  person_id: string | null
  owner_id: string | null
  bpo_id: string | null
}

export type HistoryRow = {
  id: string
  deal_id: string
  event_type: string
  title: string
  description: string | null
  created_at: string
}
