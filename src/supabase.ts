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
  status: 'pending' | 'invited' | 'active' | 'disabled' | 'deleted'
  last_invited_at: string | null
  password_reset_sent_at?: string | null
  password_reset_completed_at?: string | null
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
  ddd_prefix?: string | null
  ddd_state?: string | null
  ddd_region?: string | null
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
  type: 'restaurante' | 'hotel' | 'fornecedor' | null
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
  ddd_prefix: string | null
  ddd_state: string | null
  ddd_region: string | null
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
  partner_value: number | null
  monthly_purchase: number | null
  estimated_savings: number | null
  probability: number | null
  status: 'aberto' | 'ganho' | 'perdido' | 'quente' | 'morno' | 'risco' | null
  lost_reason: string | null
  lead_source: 'vmarket' | 'parceiro' | null
  vm_sale: boolean | null
  contract_with: 'cliente' | 'parceiro' | null
  business_type: 'restaurante' | 'hotel' | 'fornecedor' | null
  vm_product_type: 'restaurante' | 'hotel' | 'fornecedor' | null
  vm_cnpj_count: number | null
  vm_plan: string | null
  vm_value_per_cnpj: number | null
  contract_legal_name: string | null
  contract_tax_id: string | null
  contract_address: string | null
  contract_representative: string | null
  contract_email: string | null
  contract_phone: string | null
  partner_services: Record<string, unknown> | null
  source: string | null
  plan: string | null
  pipedrive_owner_name: string | null
  pipedrive_deal_created_at: string | null
  pipedrive_stage_entered_at: string | null
  expected_close_date: string | null
  score: number | null
  focus_items: string[] | null
  created_at?: string
  updated_at?: string
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

export type AuditLog = {
  id: string
  table_name: string
  entity_id: string | null
  operation: 'insert' | 'update' | 'delete'
  field_name: string | null
  old_value: unknown
  new_value: unknown
  actor_id: string | null
  actor_name: string
  actor_type: 'api' | 'admin' | 'user'
  change_source: string
  created_at: string
}

export type AutomationRule = {
  id: string
  name: string
  status: 'active' | 'paused' | 'draft' | 'deprecated'
  source_system: string
  target_system: string
  trigger_system: string
  trigger_type: string
  description: string
  triggers: unknown[]
  filters: unknown[]
  actions: unknown[]
  fields_involved: unknown[]
  implementation_refs: unknown[]
  owner: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export type AutomationRuleChange = {
  id: string
  rule_id: string
  change_type: 'created' | 'updated' | 'status_changed' | 'implementation_changed'
  changed_by: string
  summary: string
  before_snapshot: unknown
  after_snapshot: unknown
  created_at: string
}

export type AutomationRuleExecution = {
  id: string
  rule_id: string
  integration_event_id: string | null
  status: 'processing' | 'success' | 'error' | 'ignored'
  trigger_system: string | null
  trigger_type: string | null
  record_entity: string | null
  internal_id: string | null
  external_id: string | null
  started_at: string
  finished_at: string | null
  changed_fields: unknown[]
  filters_evaluated: unknown[]
  actions_performed: unknown[]
  details: unknown
  error_message: string | null
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
