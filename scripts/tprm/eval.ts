// End-to-end eval of the security review pipeline on the synthetic Acme evidence set.
// Runs steps 2-4 with the real model and the in-memory store, scores against gold.json,
// and reports misses next to the score. Exit 1 if any answer is unsafely marked Ready.
//
// Usage: ANTHROPIC_API_KEY=... npm run eval:tprm
//   RUNS=3        repeat the whole pipeline to measure consistency (default 1)
//   TPRM_MODEL=…  model to evaluate (default Haiku 4.5)
//   TPRM_AS_OF=…  date the questions are answered on (default 2026-10-30, the gold set's date)
//
// The eval is circular — the same author wrote the documents, labels and prompts — so treat it
// as a regression harness, not a benchmark.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { DraftedAnswer } from '../../src/types/index.js'
import { analyzeRequestDocuments, PROMPTS as ANALYSIS_PROMPTS } from '../../src/server/services/tprm/analyze.js'
import { answerAllQuestions, RUN_PROMPT_VERSIONS } from '../../src/server/services/tprm/answer.js'
import { buildEvidenceContext, QuestionEvidence } from '../../src/server/services/tprm/evidence.js'
import { ingestDocument } from '../../src/server/services/tprm/ingest.js'
import { AnthropicTprmLlm, LlmUsage } from '../../src/server/services/tprm/llm.js'
import { MemorySecurityReviewStore } from '../../src/server/services/tprm/memoryStore.js'
import { parseQuestionnaire } from '../../src/server/services/tprm/parsers.js'
import { generateRemediation } from '../../src/server/services/tprm/remediation.js'
import { AnalysisScore, AnalyzedDoc, GoldAnalysis, scoreAnalysis } from '../../src/server/services/tprm/scoreAnalysis.js'
import { AnswerScore, GoldAnswers, scoreAnswers } from '../../src/server/services/tprm/scoreAnswers.js'
import { EvidenceScore, scoreEvidence } from '../../src/server/services/tprm/scoreEvidence.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = path.join(ROOT, 'test_data/tprm/documents')
const RUNS = Math.max(1, Number(process.env.RUNS ?? 1))
const AS_OF = process.env.TPRM_AS_OF ?? '2026-10-30'

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set')
  process.exit(2)
}

interface GoldRemediation {
  remediation: { required: { ref: string; severity: string }[]; must_not_create: string[] }
}
const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'test_data/tprm/gold.json'), 'utf-8')) as GoldAnswers & GoldAnalysis & GoldRemediation
const llm = new AnthropicTprmLlm()
const prompts = { ...ANALYSIS_PROMPTS, ...RUN_PROMPT_VERSIONS }

interface RunResult {
  seconds: number
  analysis: AnalysisScore
  evidence: EvidenceScore
  answers: AnswerScore
  usage: LlmUsage
  drafted: DraftedAnswer[]
  remediation: { created: string[]; missing: string[]; forbidden: string[]; wrongSeverity: string[] }
}

function addUsage(all: LlmUsage[]): LlmUsage {
  const total: LlmUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  for (const u of all) for (const k of Object.keys(total) as (keyof LlmUsage)[]) total[k] += u[k]
  return total
}

// The evidence scorer reads step 3 output; rebuild that shape from the stored answers
function asEvidence(a: DraftedAnswer): QuestionEvidence {
  const gatherError = a.errors.find((e) => e.startsWith('gather'))
  return {
    ref: a.question_ref, question: a.question_text, status: gatherError ? 'failed' : 'ok', error: gatherError ?? null,
    passages: a.evidence, usage: [],
    conflict: a.conflict ? { status: 'detected', conflict: a.conflict } : { status: 'none', explanation: '' },
  }
}

async function runOnce(): Promise<RunResult> {
  const store = new MemorySecurityReviewStore()
  const ctx = { store, supplierId: 'sup-eval', requestId: 'req-eval', userId: null }
  for (const file of fs.readdirSync(DOCS).filter((f) => /\.(pdf|xlsx)$/.test(f)).sort()) {
    await ingestDocument(ctx, { filename: file, data: new Uint8Array(fs.readFileSync(path.join(DOCS, file))) })
  }
  const started = Date.now()
  const analyzed = await analyzeRequestDocuments({ ...ctx, llm })

  const keyForFile = new Map(Object.entries(gold.documents).map(([key, d]) => [d.file, key]))
  const docs: AnalyzedDoc[] = []
  for (const doc of await store.listDocuments(ctx.requestId)) {
    const key = keyForFile.get(doc.filename)
    if (key && doc.role === 'evidence') docs.push({ key, docType: doc.doc_type, findings: await store.listFindings([doc.id]), summary: doc.summary })
  }

  const ev = await buildEvidenceContext(store, ctx.requestId)
  const findings = await store.listFindings(ev.docs.map((d) => d.document.id))
  const questions = await parseQuestionnaire(fs.readFileSync(path.join(DOCS, 'clearfield_vendor_security_questionnaire.xlsx')))
  const results = await answerAllQuestions(llm, ev, findings, questions, { asOf: AS_OF })
  const drafted = results.map((r) => r.answer)

  // Remediation is rule-based on the model's findings, so it inherits extraction errors
  await generateRemediation(store, { supplierId: ctx.supplierId, requestId: ctx.requestId, userId: null, asOf: AS_OF })
  const items = await store.listRemediation(ctx.requestId)
  const sevOf = new Map(items.map((i) => [i.title.split(':')[0], i.severity]))
  const goldRem = gold.remediation
  const remediation = {
    created: [...sevOf.keys()],
    missing: goldRem.required.filter((r) => !sevOf.has(r.ref)).map((r) => r.ref),
    forbidden: goldRem.must_not_create.filter((ref) => sevOf.has(ref)),
    wrongSeverity: goldRem.required.filter((r) => sevOf.has(r.ref) && sevOf.get(r.ref) !== r.severity).map((r) => r.ref),
  }

  return {
    seconds: (Date.now() - started) / 1000,
    analysis: scoreAnalysis(gold, docs),
    evidence: scoreEvidence(gold, drafted.map(asEvidence)),
    answers: scoreAnswers(gold, drafted),
    usage: addUsage([...analyzed.flatMap((a) => a.usage), ...results.flatMap((r) => r.usage)]),
    drafted,
    remediation,
  }
}

const pct = (c: number, t: number) => `${c}/${t}${t ? ` (${Math.round((100 * c) / t)}%)` : ''}`
const list = (xs: string[]) => (xs.length ? xs.join(', ') : '—')

function headline(r: RunResult): [string, string][] {
  const a = r.answers
  const fa = Object.values(r.analysis.fieldAccuracy).reduce((s, t) => ({ c: s.c + t.correct, t: s.t + t.total }), { c: 0, t: 0 })
  return [
    ['Unsafe Ready (target 0)', `${a.unsafeReady.length}  ${list(a.unsafeReady)}`],
    ['Conflict recall (IAM-01, VULN-02, TRN-02)', `${pct(a.conflictRecall.caught.length, a.conflictRecall.caught.length + a.conflictRecall.missed.length)}  missed: ${list(a.conflictRecall.missed)}`],
    ['Conflict false positives', `${a.conflictFalsePositives.length}  ${list(a.conflictFalsePositives)} (decoys flagged: ${list(a.decoysFlagged)})`],
    ['Needs Evidence recall (planted gaps)', `${pct(a.needsEvidenceRecall.caught.length, a.needsEvidenceRecall.caught.length + a.needsEvidenceRecall.missed.length)}  missed: ${list(a.needsEvidenceRecall.missed)}`],
    ['Readiness matches gold', pct(a.readinessAccuracy.correct, a.readinessAccuracy.total)],
    ['Ready answers (gold: 12)', String(a.readyCount)],
    ['Answer accuracy', pct(a.answerAccuracy.correct, a.answerAccuracy.total)],
    ['Citation accuracy (cited location in gold)', pct(a.citationAccuracy.correct, a.citationAccuracy.total)],
    ['must_mention terms present', pct(a.mustMention.correct, a.mustMention.total)],
    ['Evidence recall (gold locations found)', pct(r.evidence.evidenceRecall.hit, r.evidence.evidenceRecall.total)],
    ['Quotes verified (evidence passages)', pct(r.evidence.quotes.verified, r.evidence.quotes.total)],
    ['Doc classification', pct(r.analysis.classification.correct, r.analysis.classification.total)],
    ['Findings field accuracy (per record)', pct(fa.c, fa.t)],
    ['Summary coverage of known exceptions', pct(r.analysis.summaryCoverage.correct, r.analysis.summaryCoverage.total)],
    ['Remediation items (gold: PT-01, PT-03, CC6.2, CC8.1)', `${list(r.remediation.created)}; missing ${list(r.remediation.missing)}; must-not-create ${list(r.remediation.forbidden)}; wrong severity ${list(r.remediation.wrongSeverity)}`],
  ]
}

function misses(r: RunResult): string[] {
  const out: string[] = []
  for (const o of r.answers.outcomes) {
    const notes: string[] = []
    if (o.unsafe) notes.push('UNSAFE READY')
    if (!o.readinessOk) notes.push(`readiness ${o.readiness}, gold ${o.expected}`)
    if (!o.answerOk) notes.push(`answer ${o.answer}, gold ${o.expectedAnswer}`)
    if (o.missingMentions.length) notes.push(`missing: ${o.missingMentions.join(', ')}`)
    if (o.citations.correct < o.citations.total) notes.push(`citations ${o.citations.correct}/${o.citations.total} in gold`)
    if (notes.length) out.push(`${o.ref.padEnd(8)} ${notes.join('; ')}  [${o.reasons.join(', ')}]`)
  }
  for (const c of r.analysis.checks.filter((x) => !x.pass)) out.push(`step 2   ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  for (const f of r.evidence.failures) out.push(`error    ${f}`)
  return out
}

console.log(`Eval: model ${llm.model}, as-of ${AS_OF}, gold ${gold.version}, ${RUNS} run(s)`)
console.log(`Prompts: ${Object.values(prompts).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`)

const runs: RunResult[] = []
for (let i = 0; i < RUNS; i++) {
  const r = await runOnce()
  runs.push(r)
  console.log(`\n── Run ${i + 1}/${RUNS} (${r.seconds.toFixed(0)} s; tokens in ${r.usage.input_tokens}, out ${r.usage.output_tokens}, ` +
    `cache read ${r.usage.cache_read_input_tokens}, cache write ${r.usage.cache_creation_input_tokens})`)
  for (const [k, v] of headline(r)) console.log(`  ${k.padEnd(44)} ${v}`)
  const m = misses(r)
  console.log(m.length ? `  Misses:\n    ${m.join('\n    ')}` : '  No misses.')
}

// Consistency: does each question land on the same readiness every run?
let consistency: { stable: number; total: number; unstable: string[] } | null = null
if (RUNS > 1) {
  const refs = runs[0].drafted.map((a) => a.question_ref)
  const unstable = refs.filter((ref) => new Set(runs.map((r) => r.drafted.find((a) => a.question_ref === ref)?.readiness)).size > 1)
  consistency = { stable: refs.length - unstable.length, total: refs.length, unstable }
  console.log(`\nConsistency across ${RUNS} runs: ${pct(consistency.stable, consistency.total)} questions with the same readiness every run`)
  for (const ref of unstable) console.log(`  ${ref}: ${runs.map((r) => r.drafted.find((a) => a.question_ref === ref)?.readiness).join(' / ')}`)
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const base = `eval-${prompts.extract}-${prompts.draft}-${stamp}`
const outDir = path.join(ROOT, 'eval-results')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, `${base}.json`), JSON.stringify({
  model: llm.model, as_of: AS_OF, gold_version: gold.version, prompts, runs: runs.map(({ drafted, ...r }) => ({ ...r, answers: { ...r.answers }, drafted })), consistency,
}, null, 2))

const md = [
  `# Security review eval — ${new Date().toISOString().slice(0, 10)}`,
  '',
  `Model \`${llm.model}\` · as-of ${AS_OF} · gold ${gold.version} · ${RUNS} run(s) · synthetic Acme evidence set (5 documents, 22 questions)`,
  '',
  `Prompts: ${Object.values(prompts).filter((v, i, a) => a.indexOf(v) === i).map((p) => `\`${p}\``).join(', ')}`,
  '',
  `| Metric | ${runs.map((_, i) => `Run ${i + 1}`).join(' | ')} |`,
  `|---|${runs.map(() => '---').join('|')}|`,
  ...headline(runs[0]).map(([k], row) => `| ${k} | ${runs.map((r) => headline(r)[row][1]).join(' | ')} |`),
  ...(consistency ? ['', `Consistency: ${pct(consistency.stable, consistency.total)} questions with the same readiness every run (unstable: ${list(consistency.unstable)}).`] : []),
  '',
  '## Misses (run 1)',
  '',
  ...misses(runs[0]).map((m) => `- ${m}`),
  '',
  'Circular eval: one author wrote the documents, the gold labels and the prompts, and prompts were',
  'adjusted while looking at these 22 questions. A regression harness, not a benchmark.',
].join('\n')
fs.writeFileSync(path.join(outDir, `${base}.md`), md + '\n')
console.log(`\nWrote eval-results/${base}.json and .md`)

if (runs.some((r) => r.answers.unsafeReady.length > 0)) process.exit(1)
