import type {
  QuestionnaireAnswerRow,
  QuestionnaireRun,
  RunStats,
  SecurityDocument,
} from '../../../types/index.js'
import { analyzeDocument, PROMPTS as ANALYSIS_PROMPTS } from './analyze.js'
import { answerQuestion, RUN_PROMPT_VERSIONS } from './answer.js'
import { buildEvidenceContext } from './evidence.js'
import { LlmUsage, TprmLlm } from './llm.js'
import { parseQuestionnaire, QuestionnaireItem } from './parsers.js'
import { runPool } from './pool.js'
import { SecurityReviewStore } from './store.js'

export class RunRejected extends Error {
  constructor(message: string, readonly status: 409) {
    super(message)
  }
}

// A run still "running" after this long is assumed dead (server restart) and doesn't block a new one
const STALE_RUN_MS = 15 * 60 * 1000

export type RunEvent =
  | { type: 'run_started'; run_id: string; questions: number }
  | { type: 'analysis'; document_id: string; filename: string; status: 'analyzed' | 'failed' | 'skipped' }
  | { type: 'answer'; answer: QuestionnaireAnswerRow; done: number; total: number }
  | { type: 'done'; run: QuestionnaireRun }
  | { type: 'error'; message: string }

export interface RunContext {
  store: SecurityReviewStore
  llm: TprmLlm
  supplierId: string
  requestId: string
  userId: string | null
}

export interface PreparedRun {
  questionnaire: SecurityDocument
  questions: QuestionnaireItem[]
  evidence: SecurityDocument[]
}

// Everything that can reject a run is checked here, before any streaming starts
export async function prepareRun(ctx: RunContext): Promise<PreparedRun> {
  const docs = await ctx.store.listDocuments(ctx.requestId)
  const questionnaire = docs.filter((d) => d.role === 'questionnaire' && d.parse_status === 'parsed').at(-1)
  if (!questionnaire) throw new RunRejected('Upload the questionnaire first', 409)
  const evidence = docs.filter((d) => d.role === 'evidence' && d.parse_status === 'parsed')
  if (evidence.length === 0) throw new RunRejected('Upload evidence documents first', 409)

  const running = (await ctx.store.listRuns(ctx.requestId))
    .find((r) => r.status === 'running' && Date.now() - Date.parse(r.created_at) < STALE_RUN_MS)
  if (running) throw new RunRejected('A run is already in progress for this request', 409)

  if (!questionnaire.storage_path) throw new RunRejected('The questionnaire file is unavailable; upload it again', 409)
  let questions: QuestionnaireItem[]
  try {
    questions = await parseQuestionnaire(await ctx.store.downloadOriginal(questionnaire.storage_path))
  } catch {
    throw new RunRejected('The questionnaire file could not be read; upload it again', 409)
  }
  return { questionnaire, questions, evidence }
}

function addUsage(total: LlmUsage, u: LlmUsage) {
  for (const k of Object.keys(total) as (keyof LlmUsage)[]) total[k] += u[k]
}

export async function executeRun(
  ctx: RunContext,
  prepared: PreparedRun,
  { asOf, concurrency = 4, onEvent = () => {} }: { asOf: string; concurrency?: number; onEvent?: (e: RunEvent) => void },
): Promise<QuestionnaireRun> {
  const { store, llm, supplierId, requestId, userId } = ctx
  const started = Date.now()
  const run = await store.createRun({
    supplier_id: supplierId, request_id: requestId, questionnaire_doc_id: prepared.questionnaire.id,
    model: llm.model, prompt_versions: { ...ANALYSIS_PROMPTS, ...RUN_PROMPT_VERSIONS }, as_of: asOf,
  })
  const log = (event_type: string, actor: 'user' | 'ai' | 'system', payload: Record<string, unknown>, entity?: { type: string; id: string }) =>
    store.logEvent({
      supplier_id: supplierId, request_id: requestId, actor, actor_id: actor === 'user' ? userId : null, event_type,
      entity_type: entity?.type ?? 'questionnaire_run', entity_id: entity?.id ?? run.id, payload,
    })
  await log('questionnaire_run_started', 'user', { questions: prepared.questions.length, model: llm.model })
  onEvent({ type: 'run_started', run_id: run.id, questions: prepared.questions.length })

  const usage: LlmUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  try {
    // Findings feed readiness rules 7-8, so documents not yet analyzed are analyzed first
    const pending = prepared.evidence.filter((d) => d.analysis_status !== 'analyzed')
    await runPool(pending, 3, async (doc) => {
      const r = await analyzeDocument({ store, llm, supplierId, requestId }, doc)
      r.usage.forEach((u) => addUsage(usage, u))
      onEvent({ type: 'analysis', document_id: doc.id, filename: doc.filename, status: r.status })
    })

    const ev = await buildEvidenceContext(store, requestId)
    const findings = await store.listFindings(ev.docs.map((d) => d.document.id))
    const counts = { ready: 0, needs_evidence: 0, conflict: 0 }
    let done = 0

    await runPool(prepared.questions, concurrency, async (q) => {
      const result = await answerQuestion(llm, ev, findings, q, asOf)
      result.usage.forEach((u) => addUsage(usage, u))
      const row = await store.saveAnswer(supplierId, run.id, result.answer)
      counts[row.readiness]++
      done++
      if (row.readiness === 'conflict') {
        await log('answer_conflict_detected', 'ai', {
          question_ref: row.question_ref, explanation: row.conflict?.explanation ?? null,
          a: row.conflict?.a?.filename ?? null, b: row.conflict?.b?.filename ?? null,
        }, { type: 'questionnaire_answer', id: row.id })
      }
      onEvent({ type: 'answer', answer: row, done, total: prepared.questions.length })
    }, { warmFirst: true })

    const stats: RunStats = { questions: prepared.questions.length, ...counts, duration_ms: Date.now() - started, ...usage }
    const patch = { status: 'completed' as const, stats, completed_at: new Date().toISOString() }
    await store.updateRun(run.id, patch)
    await log('questionnaire_run_completed', 'ai', { ...counts, duration_ms: stats.duration_ms })
    const final = { ...run, ...patch }
    onEvent({ type: 'done', run: final })
    return final
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    const patch = { status: 'failed' as const, error, completed_at: new Date().toISOString() }
    await store.updateRun(run.id, patch).catch(() => {})
    await log('questionnaire_run_failed', 'system', { error })
    onEvent({ type: 'error', message: 'The run failed. Answers saved so far are kept; start a new run to retry.' })
    return { ...run, ...patch }
  }
}
