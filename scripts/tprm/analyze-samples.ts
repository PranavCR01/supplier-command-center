// Runs step 2 (classify, extract findings, summary cards) on the synthetic sample documents
// with the real model and the in-memory store, then scores the output against gold.json.
// This measures; it is not a pass/fail gate (exit 1 only if a document fails to analyze).
//
// Usage: ANTHROPIC_API_KEY=... npm run tprm:analyze-samples   (optional: TPRM_MODEL=...)
// Writes eval-results/analysis-<prompt versions>-<timestamp>.json

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeRequestDocuments, PROMPTS } from '../../src/server/services/tprm/analyze.js'
import { ingestDocument } from '../../src/server/services/tprm/ingest.js'
import { AnthropicTprmLlm } from '../../src/server/services/tprm/llm.js'
import { MemorySecurityReviewStore } from '../../src/server/services/tprm/memoryStore.js'
import { AnalyzedDoc, GoldAnalysis, scoreAnalysis } from '../../src/server/services/tprm/scoreAnalysis.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = path.join(ROOT, 'test_data/tprm/documents')

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set')
  process.exit(2)
}

const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'test_data/tprm/gold.json'), 'utf-8')) as GoldAnalysis
const store = new MemorySecurityReviewStore()
const llm = new AnthropicTprmLlm()
const ctx = { store, supplierId: 'sup-eval', requestId: 'req-eval', userId: null }

for (const file of fs.readdirSync(DOCS).filter((f) => /\.(pdf|xlsx)$/.test(f)).sort()) {
  await ingestDocument(ctx, { filename: file, data: new Uint8Array(fs.readFileSync(path.join(DOCS, file))) })
}

const started = Date.now()
const results = await analyzeRequestDocuments({ ...ctx, llm })
const seconds = (Date.now() - started) / 1000

const keyForFile = new Map(Object.entries(gold.documents).map(([key, d]) => [d.file, key]))
const docs: AnalyzedDoc[] = []
for (const doc of await store.listDocuments(ctx.requestId)) {
  const key = keyForFile.get(doc.filename)
  if (!key || doc.role !== 'evidence') continue
  docs.push({ key, docType: doc.doc_type, findings: await store.listFindings([doc.id]), summary: doc.summary })
}
const score = scoreAnalysis(gold, docs)

const pct = (c: number, t: number) => `${c}/${t}${t ? ` (${Math.round((100 * c) / t)}%)` : ''}`
const usage = results.flatMap((r) => r.usage)
const sum = (k: keyof (typeof usage)[number]) => usage.reduce((a, u) => a + u[k], 0)

console.log(`\nModel ${llm.model} | prompts ${PROMPTS.extract}, ${PROMPTS.summarize} | ${seconds.toFixed(1)}s`)
for (const r of results) {
  console.log(`  ${r.status.padEnd(8)} ${r.filename.padEnd(46)} ${String(r.docType).padEnd(16)} ` +
    (r.findings ? `kept ${r.findings.kept}/${r.findings.extracted}, quotes ok ${r.findings.quote_verified}` : r.error ?? ''))
}
console.log(`\nClassification     ${pct(score.classification.correct, score.classification.total)}`)
for (const [group, t] of Object.entries(score.fieldAccuracy)) console.log(`Field accuracy     ${group.padEnd(14)} ${pct(t.correct, t.total)}`)
console.log(`Summary coverage   ${pct(score.summaryCoverage.correct, score.summaryCoverage.total)}`)
console.log(`Quotes verified    findings ${pct(score.quoteVerification.findings.verified, score.quoteVerification.findings.total)}, ` +
  `summary items ${pct(score.quoteVerification.summaryItems.verified, score.quoteVerification.summaryItems.total)}`)
const items = docs.flatMap((d) => (d.summary ? [...d.summary.top_findings, ...d.summary.key_exceptions, ...d.summary.takeaways] : []))
const numberFlags = items.filter((i) => i.unsupported_numbers.length > 0)
console.log(`Unsupported nums   ${numberFlags.length} summary item(s)${numberFlags.map((i) => `\n  ! [${i.unsupported_numbers.join(', ')}] ${i.text}`).join('')}`)
console.log(`Tokens             in ${sum('input_tokens')}, out ${sum('output_tokens')}, cache read ${sum('cache_read_input_tokens')}, cache write ${sum('cache_creation_input_tokens')}`)

const misses = score.checks.filter((c) => !c.pass)
console.log(misses.length ? `\nMisses (${misses.length}):` : '\nNo misses.')
for (const m of misses) console.log(`  ✗ ${m.name}${m.detail ? `  — ${m.detail}` : ''}`)

const outDir = path.join(ROOT, 'eval-results')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, `analysis-${PROMPTS.extract}-${PROMPTS.summarize}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
fs.writeFileSync(outFile, JSON.stringify({
  model: llm.model, prompts: PROMPTS, seconds, results, score,
  documents: docs.map((d) => ({ ...d, findings: d.findings.map(({ id, supplier_id, document_id, created_at, ...f }) => f) })),
}, null, 2))
console.log(`\nWrote ${path.relative(ROOT, outFile)}`)

if (results.some((r) => r.status === 'failed')) process.exit(1)
