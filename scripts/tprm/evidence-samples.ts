// Runs steps 2-3 on the synthetic samples with the real model and the in-memory store:
// analyze documents, then for every questionnaire question gather evidence, check quotes,
// and check for conflicts. Scores step 3 against gold.json. Measures; not a gate.
//
// Usage: ANTHROPIC_API_KEY=... npm run tprm:evidence-samples   (optional: TPRM_MODEL=..., ONLY=IAM-01,VULN-02)

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeRequestDocuments } from '../../src/server/services/tprm/analyze.js'
import { buildEvidenceContext, EVIDENCE_PROMPTS, gatherAllEvidence } from '../../src/server/services/tprm/evidence.js'
import { ingestDocument } from '../../src/server/services/tprm/ingest.js'
import { AnthropicTprmLlm } from '../../src/server/services/tprm/llm.js'
import { MemorySecurityReviewStore } from '../../src/server/services/tprm/memoryStore.js'
import { locatorLabel, parseQuestionnaire } from '../../src/server/services/tprm/parsers.js'
import { GoldEvidence, scoreEvidence } from '../../src/server/services/tprm/scoreEvidence.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = path.join(ROOT, 'test_data/tprm/documents')

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set')
  process.exit(2)
}

const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'test_data/tprm/gold.json'), 'utf-8')) as GoldEvidence
const store = new MemorySecurityReviewStore()
const llm = new AnthropicTprmLlm()
const ctx = { store, supplierId: 'sup-eval', requestId: 'req-eval', userId: null }

for (const file of fs.readdirSync(DOCS).filter((f) => /\.(pdf|xlsx)$/.test(f)).sort()) {
  await ingestDocument(ctx, { filename: file, data: new Uint8Array(fs.readFileSync(path.join(DOCS, file))) })
}
const analysis = await analyzeRequestDocuments({ ...ctx, llm })
if (analysis.some((r) => r.status !== 'analyzed')) console.warn('Some documents failed analysis:', analysis.filter((r) => r.status !== 'analyzed'))

const only = process.env.ONLY?.split(',').map((s) => s.trim())
const questions = (await parseQuestionnaire(fs.readFileSync(path.join(DOCS, 'clearfield_vendor_security_questionnaire.xlsx'))))
  .filter((q) => !only || only.includes(q.ref))
const ev = await buildEvidenceContext(store, ctx.requestId)

const started = Date.now()
const results = await gatherAllEvidence(llm, ev, questions)
const seconds = (Date.now() - started) / 1000
const score = scoreEvidence({ ...gold, questions: gold.questions.filter((q) => !only || only.includes(q.ref)) }, results)

const pct = (c: number, t: number) => `${c}/${t}${t ? ` (${Math.round((100 * c) / t)}%)` : ''}`
const usage = results.flatMap((r) => r.usage)
const sum = (k: keyof (typeof usage)[number]) => usage.reduce((a, u) => a + u[k], 0)

console.log(`\nModel ${llm.model} | prompts ${EVIDENCE_PROMPTS.gather}, ${EVIDENCE_PROMPTS.conflict} | ${questions.length} questions in ${seconds.toFixed(1)}s`)
for (const r of results) {
  const v = r.passages.filter((p) => p.quote_verified).length
  const c = r.conflict.status === 'detected' ? 'CONFLICT' : r.conflict.status
  console.log(`  ${r.ref.padEnd(8)} passages ${String(r.passages.length).padStart(2)} (verified ${v})  ${c}`)
}
console.log(`\nEvidence recall        ${pct(score.evidenceRecall.hit, score.evidenceRecall.total)} gold locations cited with a verified quote`)
console.log(`Conflict recall        ${pct(score.conflictRecall.caught, score.conflictRecall.total)}  ` +
  score.conflictRecall.outcomes.map((o) => `${o.ref}:${o.detected ? (o.pairCorrect ? 'caught' : 'caught, wrong pair') : 'MISSED'}`).join('  '))
console.log(`Optional (TRN-01)      ${score.optionalConflicts.map((o) => `${o.ref}:${o.detected ? 'conflict' : 'no conflict'}`).join('  ')}`)
console.log(`Conflict false pos.    ${score.falsePositives.length}  ${score.falsePositives.map((o) => o.ref).join(', ')}`)
console.log(`Decoys                 ${score.decoys.map((d) => `${d.ref}:${d.detected ? 'FLAGGED' : 'ok'}`).join('  ')}`)
console.log(`Trap support passages  ${score.trapSupports.length ? score.trapSupports.map((t) => `${t.ref} (${t.passages.length})`).join(', ') : 'none'}`)
const relocated = results.flatMap((r) => r.passages).filter((p) => p.relocated_from).length
console.log(`Quotes verified        ${pct(score.quotes.verified, score.quotes.total)} (${relocated} relocated to the page that has them)`)
console.log(`Tokens                 in ${sum('input_tokens')}, out ${sum('output_tokens')}, cache read ${sum('cache_read_input_tokens')}, cache write ${sum('cache_creation_input_tokens')}`)
if (score.failures.length) console.log(`Failures:\n  ${score.failures.join('\n  ')}`)

const weak = score.perQuestionRecall.filter((q) => q.missed.length)
if (weak.length) console.log(`\nMissed gold evidence:\n${weak.map((q) => `  ${q.ref} ${q.hit}/${q.total}: ${q.missed.join('; ')}`).join('\n')}`)
for (const o of [...score.conflictRecall.outcomes, ...score.optionalConflicts, ...score.falsePositives]) {
  console.log(`\n${o.ref} ${o.detected ? 'conflict' : 'no conflict'}: ${o.explanation ?? ''}`)
}
const unverified = results.flatMap((r) => r.passages.filter((p) => !p.quote_verified).map((p) =>
  `  ${r.ref} ${p.filename} ${p.locator ? locatorLabel(p.locator) : '-'} ${p.failure}: "${p.quote.slice(0, 90)}"`))
if (unverified.length) console.log(`\nUnverified quotes:\n${unverified.join('\n')}`)

const outDir = path.join(ROOT, 'eval-results')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `evidence-${EVIDENCE_PROMPTS.gather}-${EVIDENCE_PROMPTS.conflict}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(outFile, JSON.stringify({ model: llm.model, prompts: EVIDENCE_PROMPTS, seconds, score, results }, null, 2))
console.log(`\nWrote ${path.relative(ROOT, outFile)}`)
