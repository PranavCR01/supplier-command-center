import * as z from 'zod/v4'
import type {
  DocumentUnitRow,
  EvidenceConflict,
  EvidencePassage,
  SecurityDocument,
} from '../../../types/index.js'
import { checkCitation, LocationSchema, renderDocument } from './citations.js'
import { LlmUsage, loadPrompt, TprmLlm } from './llm.js'
import { locatorLabel, normalizeForMatch, QuestionnaireItem } from './parsers.js'
import { runPool } from './pool.js'
import { SecurityReviewStore } from './store.js'

export const EVIDENCE_PROMPTS = {
  system: 'system.v1',
  gather: 'gather_evidence.v2',
  conflict: 'detect_conflict.v2',
} as const

const STANCES = ['supports', 'limits', 'contradicts'] as const

export const GatherSchema = z.object({
  passages: z.array(z.object({
    document: z.string(),
    location: LocationSchema,
    quote: z.string(),
    stance: z.enum(STANCES),
    note: z.string(),
  })),
})

// Field order matters: structured output is generated in schema order, so the reasoning
// comes before the verdict. With the verdict first (v1), explanations argued against the
// conflict the model had already declared.
export const ConflictSchema = z.object({
  explanation: z.string(),
  conflict: z.boolean(),
  a: z.number().int().nullable(),
  b: z.number().int().nullable(),
})

export interface EvidenceDoc {
  key: string            // "D1" — the id the model cites
  document: SecurityDocument
  units: DocumentUnitRow[]
}

// All evidence for a request rendered once. The same text is sent as the cached prefix of
// every per-question call, so its order must be stable (sorted by filename).
export interface EvidenceContext {
  text: string
  docs: EvidenceDoc[]
}

export async function buildEvidenceContext(store: SecurityReviewStore, requestId: string): Promise<EvidenceContext> {
  const documents = (await store.listDocuments(requestId))
    .filter((d) => d.role === 'evidence' && d.parse_status === 'parsed')
    .sort((a, b) => a.filename.localeCompare(b.filename))
  const docs: EvidenceDoc[] = []
  for (const [i, document] of documents.entries()) {
    docs.push({ key: `D${i + 1}`, document, units: await store.listUnits(document.id) })
  }
  const text = `<evidence>\n${docs.map((d) => renderDocument(d.document.filename, d.units, d.key, d.document.doc_type)).join('\n')}\n</evidence>`
  return { text, docs }
}

export type ConflictCheck =
  | { status: 'not_needed' }                       // verified evidence from fewer than 2 documents
  | { status: 'none'; explanation: string }
  | { status: 'detected'; conflict: EvidenceConflict }
  | { status: 'failed'; error: string }

export interface QuestionEvidence {
  ref: string
  question: string
  status: 'ok' | 'failed'
  error: string | null
  passages: EvidencePassage[]     // every passage returned, verified or not
  conflict: ConflictCheck
  usage: LlmUsage[]
}

function questionBlock(q: QuestionnaireItem): string {
  return `<question ref="${q.ref}"${q.domain ? ` domain="${q.domain}"` : ''}>\n${q.question}\n</question>`
}

// Step 2 of the per-question pipeline: every passage is checked by code against the cited
// document's own text. Unknown document ids count as a location that does not exist.
export function checkPassages(ev: EvidenceContext, raw: z.infer<typeof GatherSchema>['passages']): EvidencePassage[] {
  const seen = new Set<string>()
  const out: EvidencePassage[] = []
  for (const p of raw) {
    const doc = ev.docs.find((d) => d.key === p.document.trim())
    const check = doc ? checkCitation(doc.units, p.location, p.quote) : null
    const passage: EvidencePassage = {
      document_id: doc?.document.id ?? '',
      filename: doc?.document.filename ?? p.document,
      locator: check?.locator ?? null,
      quote: p.quote,
      stance: p.stance,
      note: p.note.trim(),
      quote_verified: check?.verified ?? false,
      failure: !check ? 'PAGE_OUT_OF_RANGE' : check.verified ? null : check.failure,
      relocated_from: check?.verified ? check.relocatedFrom : null,
    }
    const key = `${passage.document_id}|${passage.locator ? locatorLabel(passage.locator) : ''}|${normalizeForMatch(p.quote)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(passage)
  }
  return out
}

function passageLine(p: EvidencePassage, n: number, docKey: string): string {
  return `[P${n}] ${docKey} ${p.filename}, ${p.locator ? locatorLabel(p.locator) : 'no location'} (${p.stance}): "${p.quote}"`
}

export async function gatherQuestionEvidence(llm: TprmLlm, ev: EvidenceContext, q: QuestionnaireItem): Promise<QuestionEvidence> {
  const system = loadPrompt(EVIDENCE_PROMPTS.system)
  const result: QuestionEvidence = {
    ref: q.ref, question: q.question, status: 'ok', error: null, passages: [], conflict: { status: 'not_needed' }, usage: [],
  }

  const gathered = await llm.structured({
    system, task: loadPrompt(EVIDENCE_PROMPTS.gather), context: ev.text, input: questionBlock(q), schema: GatherSchema, maxTokens: 3000,
  })
  if (gathered.usage) result.usage.push(gathered.usage)
  if (!gathered.ok) {
    return { ...result, status: 'failed', error: `gather: ${gathered.error}: ${gathered.message}`.slice(0, 500) }
  }
  result.passages = checkPassages(ev, gathered.data.passages)

  // The conflict check sees verified passages only, and only runs when they span 2+ documents
  const verified = result.passages.filter((p) => p.quote_verified)
  if (new Set(verified.map((p) => p.document_id)).size < 2) return result

  const keyOf = (p: EvidencePassage) => ev.docs.find((d) => d.document.id === p.document_id)?.key ?? '?'
  const checked = await llm.structured({
    system,
    task: loadPrompt(EVIDENCE_PROMPTS.conflict),
    context: `${questionBlock(q)}\n<passages>\n${verified.map((p, i) => passageLine(p, i + 1, keyOf(p))).join('\n')}\n</passages>`,
    schema: ConflictSchema,
    maxTokens: 800,
  })
  if (checked.usage) result.usage.push(checked.usage)
  if (!checked.ok) {
    result.conflict = { status: 'failed', error: `conflict: ${checked.error}: ${checked.message}`.slice(0, 500) }
    return result
  }
  const { conflict, a, b, explanation } = checked.data
  if (!conflict) {
    result.conflict = { status: 'none', explanation }
    return result
  }
  const pa = a !== null ? verified[a - 1] : undefined
  const pb = b !== null ? verified[b - 1] : undefined
  const validPair = pa && pb && pa.document_id !== pb.document_id
  result.conflict = { status: 'detected', conflict: { a: validPair ? pa : null, b: validPair ? pb : null, explanation } }
  return result
}

export async function gatherAllEvidence(
  llm: TprmLlm,
  ev: EvidenceContext,
  questions: QuestionnaireItem[],
  concurrency = 4,
): Promise<QuestionEvidence[]> {
  return runPool(questions, concurrency, (q) => gatherQuestionEvidence(llm, ev, q), { warmFirst: true })
}
