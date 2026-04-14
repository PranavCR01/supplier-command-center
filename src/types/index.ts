export interface Supplier {
  id: string
  user_id: string
  company_name: string
  dba: string | null
  founded_year: number | null
  headquarters: string | null
  employees: number | null
  annual_revenue: string | null
  website: string | null
  ein: string | null
  created_at: string
  updated_at: string
}

export interface SupplierContact {
  id: string
  supplier_id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  type: 'primary' | 'ar' | 'legal' | 'technical'
}

export type CertStatus = 'active' | 'expired' | 'expiring_soon' | 'critical'
export type CertCategory = 'certification' | 'insurance' | 'diversity'

export interface Certification {
  id: string
  supplier_id: string
  name: string
  issuer: string | null
  cert_number: string | null
  issued_date: string | null
  expiry_date: string | null
  status: CertStatus
  category: CertCategory
  required_by: string[]
}

export type BuyerStatus = 'preferred' | 'approved' | 'onboarding' | 'inactive'

export interface BuyerRelationship {
  id: string
  supplier_id: string
  buyer_name: string
  platform: string | null
  vendor_id: string | null
  since_date: string | null
  annual_spend: string | null
  status: BuyerStatus
}

export type RequestType = 'rfp' | 'rfq' | 'rfi' | 'compliance' | 'onboarding' | 'survey'
export type RequestPriority = 'urgent' | 'high' | 'medium' | 'low'
export type RequestStatus = 'pending_response' | 'in_progress' | 'submitted' | 'urgent_action'

export interface InboxRequest {
  id: string
  supplier_id: string
  type: RequestType
  priority: RequestPriority
  deadline: string | null
  received_at: string
  from_buyer: string | null
  from_contact: string | null
  from_email: string | null
  from_platform: string | null
  subject: string | null
  body: string | null
  status: RequestStatus
  tags: string[]
  attachments: string[]
}

export interface AIResponse {
  id: string
  request_id: string
  supplier_id: string
  draft_content: string | null
  final_content: string | null
  status: 'draft' | 'edited' | 'submitted'
  tokens_used: number | null
  created_at: string
}
