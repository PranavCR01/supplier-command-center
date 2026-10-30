import * as z from 'zod/v4'
import type {
  DocumentSummary,
  DocumentUnitRow,
  FindingKind,
  SecurityDocType,
  SecurityDocument,
  SummaryItem,
} from '../../../types/index.js'
import { checkCitation, ClaimedLocation, renderDocument } from './citations.js'
import { LlmUsage, loadPrompt, Prompt, StructuredResult, TprmLlm } from './llm.js'
import { normalizeForMatch, numbersNotInSource } from './parsers.js'
import { NewFinding, SecurityReviewStore } from './store.js'

export const PROMPTS = {
  system: 'system.v1',
  extract: 'classify_and_extract.v1',
  summarize: 'summarize_document.v2',
} as const

const EVIDENCE_TYPES = ['soc2_report', 'pentest_summary', 'phishing_summary', 'security_policy', 'access_review', 'other'] as const
const FINDING_KINDS = ['control', 'control_exception', 'carve_out', 'pentest_finding',
  'phishing_metric', 'policy_statement', 'access_review_exception'] as const
const FINDING_STATUSES = ['no_exceptions', 'exceptions_noted', 'open', 'remediated', 'risk_accepted'] as const

const LocationSchema = z.object({
  page: z.number().int().nullable(),
  sheet: z.string().nullable(),
  row: z.number().int().nullable(),
})

export const ExtractionSchema = z.object({
  doc_type: z.enum(EVIDENCE_TYPES),
  doc_type_reason: z.string(),
  findings: z.array(z.object({
    kind: z.enum(FINDING_KINDS),
    ref: z.string().nullable(),
    title: z.string(),
    stated_severity: z.string().nullable(),
    status: z.enum(FINDING_STATUSES).nullable(),
    detail: z.string().nullable(),
    location: LocationSchema,
    quote: z.string(),
  })),
})
export type Extraction = z.infer<typeof ExtractionSchema>

const SummaryItemSchema = z.object({ text: z.string(), location: LocationSchema, quote: z.string() })
export const SummarySchema = z.object({
  headline: z.string(),
  top_findings: z.array(SummaryItemSchema),
  key_exceptions: z.array(SummaryItemSchema),
  takeaways: z.array(SummaryItemSchema),
})
export type SummaryOutput = z.infer<typeof SummarySchema>

// A record of the wrong kind for its document (a pen test finding inside a SOC 2 report)
// is a model error, not data; code drops it rather than trusting the prompt alone.
const ALLOWED_KINDS: Record<SecurityDocType, FindingKind[]> = {
  soc2_report: ['control', 'control_exception', 'carve_out'],
  pentest_summary: ['pentest_finding'],
  phishing_summary: ['phishing_metric'],
  security_policy: ['policy_statement'],
  access_review: ['access_review_exception'],
  questionnaire: [],
  other: [],
}

export interface FindingStats {
  extracted: number
  kept: number
  quote_verified: number
  dropped_wrong_kind: number
  dropped_no_location: number
  severity_cleared: number
}

// Applies the code checks to raw extraction output: kind allowed for the doc type, a usable
// location, quote found at that location, and a stated severity that is literally in the
// cited text (severity is copied, never inferred — a severity word the page doesn't contain
// is cleared, not kept).
export function buildFindings(
  units: DocumentUnitRow[],
  docType: SecurityDocType,
  raw: Extraction['findings'],
  promptVersion: string,
): { findings: NewFinding[]; stats: FindingStats } {
  const stats: FindingStats = {
    extracted: raw.length, kept: 0, quote_verified: 0, dropped_wrong_kind: 0, dropped_no_location: 0, severity_cleared: 0,
  }
  const findings: NewFinding[] = []

  for (const f of raw) {
    if (!ALLOWED_KINDS[docType].includes(f.kind)) {
      stats.dropped_wrong_kind++
      continue
    }
    const check = checkCitation(units, f.location, f.quote)
    if (!check.locator) {
      stats.dropped_no_location++
      continue
    }

    let severity = f.stated_severity?.trim() || null
    if (severity) {
      const unit = check.unitIndex === null ? undefined : units.find((u) => u.unit_index === check.unitIndex)
      if (!unit || !normalizeForMatch(unit.text).includes(normalizeForMatch(severity))) {
        severity = null
        stats.severity_cleared++
      }
    }

    findings.push({
      kind: f.kind,
      ref: f.ref?.trim() || null,
      title: f.title.trim(),
      stated_severity: severity,
      status: f.status,
      detail: f.detail?.trim() || null,
      locator: check.locator,
      quote: f.quote,
      quote_verified: check.verified,
      prompt_version: promptVersion,
    })
    stats.kept++
    if (check.verified) stats.quote_verified++
  }
  return { findings, stats }
}

function toSummaryItem(units: DocumentUnitRow[], item: SummaryOutput['top_findings'][number]): SummaryItem {
  const check = checkCitation(units, item.location as ClaimedLocation, item.quote)
  const unit = check.unitIndex === null ? undefined : units.find((u) => u.unit_index === check.unitIndex)
  const text = item.text.trim()
  return {
    text,
    locator: check.locator,
    quote: item.quote,
    quote_verified: check.verified,
    failure: check.verified ? null : check.failure,
    // Checked against the whole cited page or row range, since a sentence may combine nearby values
    unsupported_numbers: unit ? numbersNotInSource(text, unit.text) : numbersNotInSource(text, ''),
  }
}

// Unverified items stay on the card, flagged, so a reviewer sees what the model claimed
export function buildSummary(units: DocumentUnitRow[], raw: SummaryOutput): DocumentSummary {
  return {
    headline: raw.headline.trim(),
    top_findings: raw.top_findings.map((i) => toSummaryItem(units, i)),
    key_exceptions: raw.key_exceptions.map((i) => toSummaryItem(units, i)),
    takeaways: raw.takeaways.map((i) => toSummaryItem(units, i)),
  }
}

export interface AnalyzeContext {
  store: SecurityReviewStore
  llm: TprmLlm
  supplierId: string
  requestId: string
}

export interface AnalyzeResult {
  documentId: string
  filename: string
  status: 'analyzed' | 'failed' | 'skipped'
  docType: SecurityDocType | null
  findings: FindingStats | null
  error: string | null
  usage: LlmUsage[]
}

function failureMessage(stage: string, r: Extract<StructuredResult<unknown>, { ok: false }>): string {
  return `${stage}: ${r.error}: ${r.message}`.slice(0, 500)
}

export async function analyzeDocument(ctx: AnalyzeContext, doc: SecurityDocument): Promise<AnalyzeResult> {
  const { store, llm, supplierId, requestId } = ctx
  const result: AnalyzeResult = {
    documentId: doc.id, filename: doc.filename, status: 'skipped', docType: doc.doc_type, findings: null, error: null, usage: [],
  }
  if (doc.role !== 'evidence' || doc.parse_status !== 'parsed') return result

  const prompts: Record<keyof typeof PROMPTS, Prompt> = {
    system: loadPrompt(PROMPTS.system),
    extract: loadPrompt(PROMPTS.extract),
    summarize: loadPrompt(PROMPTS.summarize),
  }
  const log = (event_type: string, payload: Record<string, unknown>) => store.logEvent({
    supplier_id: supplierId, request_id: requestId, actor: event_type.endsWith('failed') ? 'system' : 'ai',
    event_type, entity_type: 'security_document', entity_id: doc.id,
    payload: { model: llm.model, ...payload },
  })
  const fail = async (error: string) => {
    await store.updateDocument(doc.id, { analysis_status: 'failed', analysis_error: error })
    await log('document_analysis_failed', { error })
    return { ...result, status: 'failed' as const, error }
  }

  await store.updateDocument(doc.id, { analysis_status: 'running', analysis_error: null })
  try {
    return await run()
  } catch (err) {
    return fail(`internal: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500))
  }

  async function run(): Promise<AnalyzeResult> {
    const units = await store.listUnits(doc.id)
    const context = renderDocument(doc.filename, units)
    const userType = doc.doc_type_source === 'user' && doc.doc_type ? doc.doc_type : null

    const extraction = await llm.structured({
      system: prompts.system,
      task: prompts.extract,
      context,
      input: userType ? `The vendor has confirmed this document's type is "${userType}". Use that doc_type.` : undefined,
      schema: ExtractionSchema,
      maxTokens: 8000,
    })
    if (extraction.usage) result.usage.push(extraction.usage)
    if (!extraction.ok) return fail(failureMessage('extract', extraction))

    // A type the vendor set by hand always wins over the model's classification
    const docType: SecurityDocType = userType ?? extraction.data.doc_type
    result.docType = docType
    const { findings, stats } = buildFindings(units, docType, extraction.data.findings, prompts.extract.version)
    result.findings = stats
    await store.replaceFindings(supplierId, doc.id, findings)
    await store.updateDocument(doc.id, { doc_type: docType, doc_type_source: userType ? 'user' : 'ai' })
    if (!userType) {
      await log('document_classified', {
        doc_type: docType, reason: extraction.data.doc_type_reason, prompt_version: prompts.extract.version,
      })
    }
    await log('findings_extracted', { ...stats, prompt_version: prompts.extract.version })

    const findingsForPrompt = findings.map((f) => ({
      kind: f.kind, ref: f.ref, title: f.title, stated_severity: f.stated_severity, status: f.status, detail: f.detail,
    }))
    const summary = await llm.structured({
      system: prompts.system,
      task: prompts.summarize,
      context,
      input: `<findings doc_type="${docType}">\n${JSON.stringify(findingsForPrompt, null, 1)}\n</findings>`,
      schema: SummarySchema,
      maxTokens: 3000,
    })
    if (summary.usage) result.usage.push(summary.usage)
    if (!summary.ok) return fail(failureMessage('summarize', summary))

    const card = buildSummary(units, summary.data)
    await store.updateDocument(doc.id, {
      summary: card, summary_prompt_version: prompts.summarize.version, analysis_status: 'analyzed', analysis_error: null,
    })
    const items = [...card.top_findings, ...card.key_exceptions, ...card.takeaways]
    await log('document_summarized', {
      items: items.length, quote_verified: items.filter((i) => i.quote_verified).length,
    unsupported_numbers: items.filter((i) => i.unsupported_numbers.length > 0).length,
      prompt_version: prompts.summarize.version,
    })

    return { ...result, status: 'analyzed' }
  }
}

// Analyzes every parsed evidence document on a request, a few at a time
export async function analyzeRequestDocuments(ctx: AnalyzeContext, concurrency = 3): Promise<AnalyzeResult[]> {
  const docs = (await ctx.store.listDocuments(ctx.requestId))
    .filter((d) => d.role === 'evidence' && d.parse_status === 'parsed')
  const results: AnalyzeResult[] = new Array(docs.length)
  let next = 0
  const worker = async () => {
    while (next < docs.length) {
      const i = next++
      results[i] = await analyzeDocument(ctx, docs[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, docs.length) }, worker))
  return results
}
