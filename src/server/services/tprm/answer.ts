import * as z from 'zod/v4'
import type {
  AnswerEvidence,
  DocumentFinding,
  DraftedAnswer,
  EvidencePassage,
  Locator,
} from '../../../types/index.js'
import { EVIDENCE_PROMPTS, EvidenceContext, gatherQuestionEvidence, QuestionEvidence } from './evidence.js'
import { loadPrompt, LlmUsage, TprmLlm } from './llm.js'
import { locatorLabel, normalizeForMatch, numbersNotInSource, QuestionnaireItem } from './parsers.js'
import { runPool } from './pool.js'
import { decideReadiness } from './readiness.js'

export const ANSWER_PROMPTS = {
  system: 'system.v1',
  draft: 'draft_answer.v2',
  verify: 'verify_support.v2',
} as const

// Every prompt a questionnaire run uses; stored on the run so results are keyed by version
export const RUN_PROMPT_VERSIONS = { ...EVIDENCE_PROMPTS, ...ANSWER_PROMPTS }

export const DraftSchema = z.object({
  response_text: z.string(),
  answer: z.enum(['yes', 'no', 'partial', 'not_addressed']),
  cited: z.array(z.number().int()),
  confidence: z.number(),
})

// Reason before verdict, for the same reason as the conflict check
export const VerifySchema = z.object({
  reason: z.string(),
  verdict: z.enum(['supported', 'partially_supported', 'unsupported']),
})

// Step 2 findings an answer may not lean on without a human signing off (readiness rules 7-8)
function isException(f: DocumentFinding): boolean {
  return f.kind === 'control_exception'
    || f.kind === 'access_review_exception'
    || (f.kind === 'control' && f.status === 'exceptions_noted')
    || (f.kind === 'pentest_finding' && f.status === 'open' && /^(critical|high)$/i.test(f.stated_severity ?? ''))
}

function sameLocation(a: Locator, b: Locator): boolean {
  if ('page' in a && 'page' in b) return a.page === b.page
  if ('sheet' in a && 'sheet' in b) return a.sheet === b.sheet && a.row_start <= b.row_end && b.row_start <= a.row_end
  return false
}

export function unitTextFor(ev: EvidenceContext, documentId: string, locator: Locator): string | null {
  const doc = ev.docs.find((d) => d.document.id === documentId)
  const unit = doc?.units.find((u) => sameLocation(u.locator, locator))
  return unit?.text ?? null
}

function span(text: string, quote: string): [number, number] | null {
  const q = normalizeForMatch(quote)
  const i = q ? text.indexOf(q) : -1
  return i < 0 ? null : [i, i + q.length]
}

const words = (s: string) => new Set(normalizeForMatch(s).split(/[^a-z0-9%.]+/).filter((w) => w.length > 2))

// Does a passage rest on the same text as a finding? Same document and location, then the two
// quotes must overlap on the page: SOC 2 p.11 holds both the clean MFA control and the CC6.2
// exception, so sharing a page is not enough. Spreadsheet citations are already row-level.
export function passageUsesFinding(ev: EvidenceContext, p: EvidencePassage, f: DocumentFinding): boolean {
  if (!p.quote_verified || !p.locator || !f.quote || f.document_id !== p.document_id) return false
  if (!sameLocation(p.locator, f.locator)) return false
  if ('sheet' in p.locator) return true
  const text = normalizeForMatch(unitTextFor(ev, p.document_id, p.locator) ?? '')
  const a = span(text, p.quote)
  const b = span(text, f.quote)
  if (a && b) return a[0] < b[1] && b[0] < a[1]
  // An approximate quote has no exact span; fall back to shared content words
  const pw = words(p.quote)
  const fw = words(f.quote)
  const shared = [...pw].filter((w) => fw.has(w)).length
  return shared / Math.max(1, Math.min(pw.size, fw.size)) >= 0.5
}

// Questions say "within the last 12 months"; without a date the model calls past dates future
function questionBlock(q: QuestionnaireItem, asOf: string): string {
  return `<today>${asOf}</today>\n<question ref="${q.ref}"${q.domain ? ` domain="${q.domain}"` : ''}>\n${q.question}\n</question>`
}

export const todayIso = () => new Date().toISOString().slice(0, 10)

export interface AnswerResult {
  answer: DraftedAnswer
  usage: LlmUsage[]
}

export async function draftAnswer(
  llm: TprmLlm,
  ev: EvidenceContext,
  findings: DocumentFinding[],
  q: QuestionnaireItem,
  gathered: QuestionEvidence,
  asOf: string = todayIso(),
): Promise<AnswerResult> {
  const system = loadPrompt(ANSWER_PROMPTS.system)
  const usage = [...gathered.usage]
  const errors: string[] = []
  if (gathered.error) errors.push(gathered.error)
  if (gathered.conflict.status === 'failed') errors.push(gathered.conflict.error)

  const verified = gathered.passages.filter((p) => p.quote_verified)
  const conflict = gathered.conflict.status === 'detected' ? gathered.conflict.conflict : null
  const number = (p: EvidencePassage | null) => (p ? verified.indexOf(p) + 1 : 0)

  let draft: z.infer<typeof DraftSchema> | null = null
  let cited: EvidencePassage[] = []
  let citedOutOfRange = false
  if (gathered.status === 'ok' && verified.length > 0) {
    const lines = verified.map((p, i) => `[P${i + 1}] ${p.filename}, ${locatorLabel(p.locator!)} (${p.stance}): "${p.quote}"`)
    const note = conflict
      ? `\n<note>A reviewer flagged a possible conflict between P${number(conflict.a)} and P${number(conflict.b)}: ${conflict.explanation}</note>`
      : ''
    const res = await llm.structured({
      system, task: loadPrompt(ANSWER_PROMPTS.draft),
      context: `${questionBlock(q, asOf)}\n<passages>\n${lines.join('\n')}\n</passages>${note}`,
      schema: DraftSchema, maxTokens: 1000,
    })
    if (res.usage) usage.push(res.usage)
    if (!res.ok) {
      errors.push(`draft: ${res.error}: ${res.message}`.slice(0, 500))
    } else {
      draft = res.data
      citedOutOfRange = draft.cited.some((n) => n < 1 || n > verified.length)
      cited = [...new Set(draft.cited)].filter((n) => n >= 1 && n <= verified.length).map((n) => verified[n - 1])
    }
  }

  // Numbers in the answer must come from the pages it cites or from the question itself
  const sources = cited.map((p) => unitTextFor(ev, p.document_id, p.locator!) ?? p.quote)
  const unsupportedNumbers = draft ? numbersNotInSource(draft.response_text, [q.question, ...sources].join('\n')) : []

  let verifier: DraftedAnswer['verifier'] = null
  const verifyNeeded = draft && draft.answer !== 'not_addressed' && !conflict && cited.length > 0 && !citedOutOfRange
  if (verifyNeeded) {
    const seen = new Set<string>()
    const blocks: string[] = []
    for (const p of cited) {
      const key = `${p.document_id}|${locatorLabel(p.locator!)}`
      if (seen.has(key)) continue
      seen.add(key)
      blocks.push(`<source document="${p.filename}" location="${locatorLabel(p.locator!)}">\n${unitTextFor(ev, p.document_id, p.locator!) ?? p.quote}\n</source>`)
    }
    const res = await llm.structured({
      system, task: loadPrompt(ANSWER_PROMPTS.verify),
      context: `${questionBlock(q, asOf)}\n<answer label="${draft!.answer}">\n${draft!.response_text}\n</answer>\n<sources>\n${blocks.join('\n')}\n</sources>`,
      schema: VerifySchema, maxTokens: 600,
    })
    if (res.usage) usage.push(res.usage)
    if (!res.ok) errors.push(`verify: ${res.error}: ${res.message}`.slice(0, 500))
    else verifier = { verdict: res.data.verdict, reason: res.data.reason }
  }

  // A failed quote on adverse evidence must not vanish just because the drafter never saw it
  const unverified = gathered.passages.filter((p) => !p.quote_verified)
  const quoteFailures = (verified.length === 0 ? unverified : unverified.filter((p) => p.stance !== 'supports'))
    .map((p) => p.failure!)

  // Rules 7-8 look at what the answer cites plus any verified adverse passage the drafter was shown
  const considered = [...new Set([...cited, ...verified.filter((p) => p.stance !== 'supports')])]
  const uses = (pred: (f: DocumentFinding) => boolean) =>
    considered.some((p) => findings.some((f) => pred(f) && passageUsesFinding(ev, p, f)))

  const { readiness, reasons } = decideReadiness({
    conflictDetected: Boolean(conflict),
    callFailed: errors.length > 0,
    citedVerified: cited.length,
    answerNotAddressed: !draft || draft.answer === 'not_addressed',
    answerAdmitsGap: draft?.answer === 'partial' || draft?.answer === 'no',
    citedOutOfRange,
    quoteFailures,
    unsupportedNumbers,
    reliesOnException: uses(isException),
    reliesOnCarveOut: uses((f) => f.kind === 'carve_out'),
    verifierVerdict: verifier?.verdict ?? null,
    confidence: draft?.confidence ?? null,
  })

  const evidence: AnswerEvidence[] = gathered.passages.map((p) => ({ ...p, cited: cited.includes(p) }))
  return {
    usage,
    answer: {
      question_ref: q.ref,
      question_row: q.row,
      domain: q.domain,
      question_text: q.question,
      // not_addressed only when the evidence really came back empty; a failed call is unknown
      answer: draft ? draft.answer : gathered.status === 'ok' && verified.length === 0 ? 'not_addressed' : null,
      response_text: draft?.response_text ?? null,
      evidence,
      conflict,
      verifier,
      model_confidence: draft ? Math.round(Math.min(1, Math.max(0, draft.confidence)) * 100) / 100 : null,
      readiness,
      reasons,
      unsupported_numbers: unsupportedNumbers,
      errors,
    },
  }
}

export async function answerQuestion(
  llm: TprmLlm, ev: EvidenceContext, findings: DocumentFinding[], q: QuestionnaireItem, asOf: string = todayIso(),
): Promise<AnswerResult> {
  return draftAnswer(llm, ev, findings, q, await gatherQuestionEvidence(llm, ev, q), asOf)
}

// The whole questionnaire: one cache-warming question first, then the rest in parallel
export async function answerAllQuestions(
  llm: TprmLlm,
  ev: EvidenceContext,
  findings: DocumentFinding[],
  questions: QuestionnaireItem[],
  { concurrency = 4, asOf = todayIso() }: { concurrency?: number; asOf?: string } = {},
): Promise<AnswerResult[]> {
  return runPool(questions, concurrency, (q) => answerQuestion(llm, ev, findings, q, asOf), { warmFirst: true })
}
