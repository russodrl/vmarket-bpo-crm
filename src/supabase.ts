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
  crm_user_id?: string | null
  crm_company_id?: string | null
}

export type CrmCompany = {
  id: string
  name: string
  created_at?: string
  updated_at?: string
}

export type CrmAdditionalContact = {
  name?: string
  role?: string
  whatsapp?: string
}

export type CrmUser = {
  id: string
  full_name: string
  email: string
  company_id: string
  auth_user_id: string | null
  status: 'pending' | 'invited' | 'active' | 'disabled'
  last_invited_at: string | null
  legal_company_name?: string | null
  cnpj?: string | null
  headquarters_address?: string | null
  state_registration?: string | null
  legal_representative_name?: string | null
  nationality?: string | null
  marital_status?: string | null
  profession?: string | null
  rg_issuer?: string | null
  cpf?: string | null
  company_role?: string | null
  primary_email?: string | null
  crm_phone?: string | null
  additional_contacts?: CrmAdditionalContact[] | null
  issues_service_invoice?: boolean | null
  bank_name?: string | null
  bank_agency?: string | null
  bank_account?: string | null
  pix_key?: string | null
  service_regions?: string | null
  operation_types?: string[] | null
  monthly_new_clients_capacity?: number | null
  food_service_experience?: string | null
  current_clients_count?: number | null
  current_purchasing_clients_count?: number | null
  purchasing_ticket_avg?: number | null
  offered_services?: string[] | null
  data_authorization?: string | null
  tally_form_id?: string | null
  tally_submission_id?: string | null
  tally_submitted_at?: string | null
  tally_synced_at?: string | null
  crm_companies?: CrmCompany | null
  created_at?: string
  updated_at?: string
}

export type Stage = {
  id: string
  name: string
  sort_order: number
  color: string | null
  pipedrive_stage_id?: number | null
  pipedrive_pipeline_id?: number | null
  pipeline_name?: string | null
  deal_probability?: number | null
  is_pipedrive_replica?: boolean | null
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
  pipedrive_owner_name: string | null
  expected_close_date: string | null
  score: number | null
  focus_items: string[] | null
  organizations?: Organization | null
  people?: Person | null
  bpo_partners?: BpoPartner | null
  pipeline_stages?: Stage | null
}

export type DealLabel = {
  id: string
  name: string
  color: string
  created_by: string | null
  created_at?: string
  updated_at?: string
}

export type DealLabelAssignment = {
  deal_id: string
  label_id: string
  created_by: string | null
  created_at?: string
  deal_labels?: DealLabel | null
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
  created_at?: string
  completed_at?: string | null
}

export type HistoryRow = {
  id: string
  deal_id: string
  event_type: string
  title: string
  description: string | null
  created_at: string
}

export type CustomField = {
  id: string
  entity: 'deal' | 'organization' | 'person' | 'activity'
  name: string
  field_type: 'text' | 'large_text' | 'single_option' | 'multi_option' | 'autocomplete' | 'numeric' | 'monetary' | 'user_ref' | 'organization_ref' | 'person_ref' | 'phone' | 'time' | 'time_range' | 'date' | 'date_range' | 'address' | 'formula'
  options: string[] | null
  sort_order: number | null
  pipedrive_key?: string | null
  pipedrive_field_type?: string | null
  pipedrive_id?: number | null
  pipedrive_options?: Array<{ id?: number | string; label?: string }> | null
  created_at?: string
}

export type CustomFieldValue = {
  id: string
  field_id: string
  entity_id: string
  value: unknown
  created_at: string
  updated_at: string
}
