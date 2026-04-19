import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { SupabaseClient } from '@supabase/supabase-js'
import { truncateToLimit } from './claude.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface AcmeReference {
  company: string
  description?: string
  relationship?: string
}

interface AcmeProfile {
  capabilities: string[]
  industries_served: string[]
  references: AcmeReference[]
}

// Capabilities, industries, and references are not stored in the DB.
// Load them from the static supplier profile at startup.
const acmeProfile: AcmeProfile = JSON.parse(
  fs.readFileSync(join(__dirname, '../../../test_data/suppliers/acme_tech_solutions.json'), 'utf-8')
)

type RequestType = 'rfp' | 'rfq' | 'rfi' | 'compliance' | 'onboarding' | 'survey'

interface InboxRow {
  id: string
  type: RequestType
  priority: string
  deadline: string | null
  from_buyer: string | null
  from_contact: string | null
  from_email: string | null
  from_platform: string | null
  subject: string | null
  body: string | null
  tags: string[]
  attachments: string[]
}

interface SupplierRow {
  company_name: string
  dba: string | null
  founded_year: number | null
  headquarters: string | null
  employees: number | null
  annual_revenue: string | null
  website: string | null
  ein: string | null
}

// Which supplier data tables to fetch per request type
const FETCH_CERTS: RequestType[] = ['rfp', 'rfq', 'rfi', 'compliance', 'onboarding']
const FETCH_CONTACTS: RequestType[] = ['onboarding']

export async function buildUserMessage(
  supplierId: string,
  request: InboxRow,
  supabase: SupabaseClient
): Promise<string> {
  // Base supplier info — always needed
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('company_name, dba, founded_year, headquarters, employees, annual_revenue, website, ein')
    .eq('id', supplierId)
    .single<SupplierRow>()

  const parts: string[] = []

  // Inject current date so Claude never writes placeholder text like "[Current Date]"
  parts.push(`Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`)

  // --- SUPPLIER PROFILE SECTION ---
  parts.push('\n## SUPPLIER PROFILE')

  if (supplier) {
    const s = supplier
    parts.push([
      `Company: ${s.company_name}${s.dba ? ` (DBA: ${s.dba})` : ''}`,
      s.founded_year   ? `Founded: ${s.founded_year}`     : null,
      s.headquarters   ? `HQ: ${s.headquarters}`           : null,
      s.employees      ? `Employees: ${s.employees}`       : null,
      s.annual_revenue ? `Annual Revenue: ${s.annual_revenue}` : null,
      s.website        ? `Website: ${s.website}`           : null,
      s.ein            ? `EIN: ${s.ein}`                   : null,
    ].filter(Boolean).join('\n'))
  }

  // Capabilities, industries, references — for RFP, RFQ, RFI, survey
  if (['rfp', 'rfq', 'rfi', 'survey'].includes(request.type)) {
    if (acmeProfile.capabilities.length > 0) {
      parts.push('\n### Capabilities')
      parts.push(acmeProfile.capabilities.map((c) => `- ${c}`).join('\n'))
    }
    if (acmeProfile.industries_served.length > 0) {
      parts.push(`\nIndustries Served: ${acmeProfile.industries_served.join(', ')}`)
    }
    if (acmeProfile.references.length > 0) {
      parts.push('\n### Client References & Case Studies')
      parts.push(
        acmeProfile.references.map((r) =>
          `- ${r.company}: ${r.description ?? r.relationship ?? ''}`
        ).join('\n')
      )
    }
  }

  // Certifications — only for relevant request types
  if (FETCH_CERTS.includes(request.type)) {
    const { data: certs } = await supabase
      .from('certifications')
      .select('name, issuer, cert_number, expiry_date, status, category')
      .eq('supplier_id', supplierId)

    if (certs && certs.length > 0) {
      // For compliance requests, only include the category most relevant to the request
      const relevantCerts = request.type === 'compliance'
        ? certs.filter((c) =>
            request.tags.some((tag) =>
              tag.toLowerCase().includes(c.category) ||
              c.name.toLowerCase().includes(tag.toLowerCase())
            )
          ).slice(0, 5) || certs.slice(0, 5)
        : certs

      parts.push('\n### Certifications & Compliance')
      parts.push(
        relevantCerts.map((c) =>
          `- ${c.name} | Issuer: ${c.issuer ?? 'N/A'} | Cert#: ${c.cert_number ?? 'N/A'} | Expires: ${c.expiry_date ?? 'N/A'} | Status: ${c.status}`
        ).join('\n')
      )
    }
  }

  // Contacts — only for onboarding
  if (FETCH_CONTACTS.includes(request.type)) {
    const { data: contacts } = await supabase
      .from('supplier_contacts')
      .select('name, title, email, phone, type')
      .eq('supplier_id', supplierId)

    if (contacts && contacts.length > 0) {
      parts.push('\n### Key Contacts')
      parts.push(
        contacts.map((c) =>
          `- ${c.name} (${c.title ?? c.type}) | ${c.email ?? ''} | ${c.phone ?? ''}`
        ).join('\n')
      )
    }
  }

  // --- REQUEST SECTION ---
  parts.push('\n## BUYER REQUEST')
  parts.push([
    `Type: ${request.type.toUpperCase()}`,
    `Priority: ${request.priority}`,
    request.from_buyer   ? `From: ${request.from_buyer}` : null,
    request.from_contact ? `Contact: ${request.from_contact}` : null,
    request.from_email   ? `Email: ${request.from_email}` : null,
    request.from_platform ? `Platform: ${request.from_platform}` : null,
    request.deadline     ? `Deadline: ${request.deadline}` : null,
    request.subject      ? `Subject: ${request.subject}` : null,
  ].filter(Boolean).join('\n'))

  if (request.body) {
    const { text: bodyText, truncated } = truncateToLimit(request.body)
    parts.push('\n### Message Body')
    parts.push(bodyText)
    if (truncated) {
      parts.push('\n⚠️ Note: message body was truncated to fit context window.')
    }
  }

  if (request.attachments.length > 0) {
    parts.push(`\nAttachments referenced (not parsed): ${request.attachments.join(', ')}`)
  }

  // --- TASK INSTRUCTION ---
  parts.push('\n## TASK')
  parts.push(taskInstruction(request.type))

  return parts.join('\n')
}

function taskInstruction(type: RequestType): string {
  switch (type) {
    case 'rfp':
      return 'Draft a professional RFP response. Include: executive summary, understanding of requirements, proposed solution/approach, relevant qualifications and case studies, certifications held, and a note on any requirements you cannot currently meet. Structure with clear headings.'
    case 'rfq':
      return 'Draft a professional RFQ response. Include: confirmation of ability to supply, proposed resource profiles or product specs, indicative pricing structure (flag if actual rates are not in the profile), timeline/availability, and any assumptions or exclusions.'
    case 'rfi':
      return 'Draft a professional RFI response. Provide factual answers to each question or topic raised. For any information not in the supplier profile, explicitly flag it as "Information not available — to be provided."'
    case 'compliance':
      return 'Draft a professional compliance response. Address the specific compliance requirement raised. Reference relevant certifications or policies held. If there is a gap (e.g. coverage below required minimum), clearly flag it and suggest a remediation path. Do not fabricate coverage details.'
    case 'onboarding':
      return 'Draft a professional vendor onboarding response. Acknowledge the request, list which requested documents you can provide (based on the profile), flag which items are missing or need to be obtained, and propose a timeline for submission.'
    case 'survey':
      return 'Draft a professional survey response. Provide factual, concise answers to each area covered. For ESG/diversity questions, reference relevant certifications and programs in the profile. Flag any areas where data is not available rather than estimating.'
  }
}
