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

// ---------------------------------------------------------------------------
// Security review (vendor-side TPRM)
// ---------------------------------------------------------------------------

// Where a citation points: a PDF page, or a range of spreadsheet rows
export type Locator =
  | { page: number }
  | { sheet: string; row_start: number; row_end: number }

export type SecurityDocType =
  | 'soc2_report' | 'pentest_summary' | 'phishing_summary'
  | 'security_policy' | 'access_review' | 'questionnaire' | 'other'

export type SecurityDocRole = 'evidence' | 'questionnaire'
export type ParseStatus = 'pending' | 'parsed' | 'failed'
export type AnalysisStatus = 'pending' | 'running' | 'analyzed' | 'failed'

// Why a citation failed the code check; shared by findings, summaries and answers
export type CitationFailure = 'NO_LOCATION' | 'PAGE_OUT_OF_RANGE' | 'QUOTE_NOT_FOUND' | 'LOW_TEXT'

// One summary card line: every claim carries a locator and a verbatim quote checked by code
export interface SummaryItem {
  text: string
  locator: Locator | null
  quote: string
  quote_verified: boolean
  failure: CitationFailure | null
  relocated_from: Locator | null
  // Digits in `text` that the cited page/rows never contain: computed or invented numbers
  unsupported_numbers: string[]
}

export interface DocumentSummary {
  headline: string
  top_findings: SummaryItem[]
  key_exceptions: SummaryItem[]
  takeaways: SummaryItem[]
}

export interface SecurityDocument {
  id: string
  supplier_id: string
  request_id: string | null
  filename: string
  storage_path: string | null
  mime_type: string
  sha256: string
  role: SecurityDocRole
  doc_type: SecurityDocType | null
  doc_type_source: 'ai' | 'user' | null
  parse_status: ParseStatus
  parse_error: string | null
  unit_count: number | null
  summary: DocumentSummary | null
  summary_prompt_version: string | null
  analysis_status: AnalysisStatus
  analysis_error: string | null
  created_at: string
}

export type EvidenceStance = 'supports' | 'limits' | 'contradicts'

// A passage gathered for one question, after the code quote check
export interface EvidencePassage {
  document_id: string
  filename: string
  locator: Locator | null
  quote: string
  stance: EvidenceStance
  note: string
  quote_verified: boolean
  failure: CitationFailure | null
  // The model cited a different location; code found the quote here (see checkCitation)
  relocated_from: Locator | null
}

// a/b are null when the model reported a conflict but named an invalid pair; the
// question still routes to Conflict (fail safe), with the explanation for the reviewer
export interface EvidenceConflict {
  a: EvidencePassage | null
  b: EvidencePassage | null
  explanation: string
}

export type AnswerValue = 'yes' | 'no' | 'partial' | 'not_addressed'
export type Readiness = 'ready' | 'needs_evidence' | 'conflict'

// In rule order (first match sets readiness); every rule that applies is recorded
export const READINESS_REASONS = [
  'CONFLICT', 'SCHEMA_INVALID', 'NO_EVIDENCE', 'PAGE_OUT_OF_RANGE', 'QUOTE_NOT_FOUND', 'LOW_TEXT',
  'UNSUPPORTED_NUMBER', 'CONTROL_EXCEPTION', 'CARVE_OUT', 'GAP_DISCLOSED', 'VERIFIER_UNSUPPORTED', 'VERIFIER_PARTIAL',
  'LOW_CONFIDENCE',
] as const
export type ReadinessReason = typeof READINESS_REASONS[number]

export type VerifierVerdict = 'supported' | 'partially_supported' | 'unsupported'

export interface AnswerEvidence extends EvidencePassage {
  cited: boolean      // the drafted answer cites this passage
}

// One drafted questionnaire answer, shaped like a questionnaire_answers row
export interface DraftedAnswer {
  question_ref: string
  question_row: number      // spreadsheet row, so answers list in questionnaire order
  domain: string | null
  question_text: string
  answer: AnswerValue | null
  response_text: string | null
  evidence: AnswerEvidence[]
  conflict: EvidenceConflict | null
  verifier: { verdict: VerifierVerdict; reason: string } | null
  model_confidence: number | null
  readiness: Readiness
  reasons: ReadinessReason[]
  unsupported_numbers: string[]
  errors: string[]
}

export type RunStatus = 'running' | 'completed' | 'failed'

export interface RunStats {
  questions: number
  ready: number
  needs_evidence: number
  conflict: number
  duration_ms: number
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export interface QuestionnaireRun {
  id: string
  supplier_id: string
  request_id: string
  questionnaire_doc_id: string
  status: RunStatus
  model: string
  prompt_versions: Record<string, string>
  stats: RunStats | null
  error: string | null
  as_of: string | null
  created_at: string
  completed_at: string | null
}

export type ReviewStatus = 'pending' | 'approved' | 'edited' | 'rejected'

export interface QuestionnaireAnswerRow extends DraftedAnswer {
  id: string
  supplier_id: string
  run_id: string
  review_status: ReviewStatus
  final_text: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export type RemediationSeverity = 'critical' | 'high' | 'medium' | 'low'
export type RemediationStatus = 'open' | 'in_progress' | 'done' | 'risk_accepted'

export interface RemediationItem {
  id: string
  supplier_id: string
  request_id: string | null
  finding_id: string | null
  title: string                // starts with the finding ref, e.g. "PT-01: ..."
  description: string | null
  severity: RemediationSeverity
  owner_contact_id: string | null
  owner_name: string | null
  status: RemediationStatus
  due_date: string | null      // YYYY-MM-DD
  source: 'ai' | 'user'        // 'ai' = generated from findings by rule
  external_key: string | null
  created_at: string
  updated_at: string
}

export type FindingKind =
  | 'control' | 'control_exception' | 'carve_out' | 'pentest_finding'
  | 'phishing_metric' | 'policy_statement' | 'access_review_exception'

export type FindingStatus =
  | 'no_exceptions' | 'exceptions_noted' | 'open' | 'remediated' | 'risk_accepted'

export interface DocumentFinding {
  id: string
  supplier_id: string
  document_id: string
  kind: FindingKind
  ref: string | null
  title: string
  stated_severity: string | null
  status: FindingStatus | null
  detail: string | null
  locator: Locator
  quote: string | null
  quote_verified: boolean
  prompt_version: string
  created_at: string
}

export interface DocumentUnitRow {
  id: string
  supplier_id: string
  document_id: string
  unit_index: number
  locator: Locator
  text: string
}

export type ActivityActor = 'user' | 'ai' | 'system'

export interface ActivityEvent {
  id: string
  supplier_id: string
  request_id: string | null
  actor: ActivityActor
  actor_id: string | null
  event_type: string
  entity_type: string | null
  entity_id: string | null
  payload: Record<string, unknown>
  created_at: string
}
