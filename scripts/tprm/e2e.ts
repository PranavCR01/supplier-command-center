// End-to-end run through the HTTP API with the real model: sample upload, analysis, the SSE
// questionnaire run, a conflict resolution, remediation and the filled questionnaire export.
// In-memory store, so no Supabase needed. Scores the answers against gold.json. Exit 1 on any
// unsafe Ready or a broken step.
//
// Usage (ANTHROPIC_API_KEY from the environment or .env): npm run tprm:e2e   (~3 minutes, a few cents)

import 'dotenv/config'
import ExcelJS from 'exceljs'
import express, { RequestHandler } from 'express'
import fs from 'fs'
import { AddressInfo } from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import type { QuestionnaireAnswerRow, RemediationItem } from '../../src/types/index.js'
import type { AuthRequest } from '../../src/server/middleware/auth.js'
import { createSecurityReviewRouter } from '../../src/server/routes/securityReview.js'
import { AnthropicTprmLlm } from '../../src/server/services/tprm/llm.js'
import { MemorySecurityReviewStore } from '../../src/server/services/tprm/memoryStore.js'
import { GoldAnswers, scoreAnswers } from '../../src/server/services/tprm/scoreAnswers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set')
  process.exit(2)
}

const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'test_data/tprm/gold.json'), 'utf-8')) as GoldAnswers & {
  remediation: { required: { ref: string }[]; must_not_create: string[] }
}
const store = new MemorySecurityReviewStore()
store.suppliers.set('user-1', 'sup-1')
store.requests.set('req-1', 'sup-1')
store.contacts.set('sup-1', { id: 'contact-1', name: 'Daniel Ortiz' })
const auth: RequestHandler = (req, _res, next) => {
  ;(req as AuthRequest).userId = 'user-1'
  next()
}

const app = express()
app.use(express.json())
app.use('/api/security-review', createSecurityReviewRouter({
  store, requireAuth: auth, samplesDir: path.join(ROOT, 'test_data/tprm/documents'), llm: new AnthropicTprmLlm(),
}))
const server = app.listen(0)
await new Promise((r) => server.once('listening', r))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/security-review`

let failures = 0
const check = (cond: boolean, m: string) => {
  console.log(`${cond ? '✓' : '✗'} ${m}`)
  if (!cond) failures++
}
const api = async <T>(p: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${base}${p}`, init)
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${p} → ${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}
const started = Date.now()
const t = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

try {
  await api('/requests/req-1/documents/samples', { method: 'POST' })
  check(store.documents.length === 6, `samples uploaded and parsed (${t()})`)

  const analysis = await api<{ results: { status: string }[] }>('/requests/req-1/analyze', { method: 'POST' })
  check(analysis.results.every((r) => r.status === 'analyzed'), `5 documents analyzed (${t()})`)

  // The run streams SSE; count events as they arrive
  const res = await fetch(`${base}/requests/req-1/runs`, { method: 'POST' })
  const text = await res.text()
  const events = text.split('\n\n').filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6)) as { type: string })
  check(events.filter((e) => e.type === 'answer').length === 22 && events.at(-1)?.type === 'done', `SSE run streamed 22 answers then done (${t()})`)

  const runId = store.runs[0].id
  const { answers } = await api<{ answers: QuestionnaireAnswerRow[] }>(`/runs/${runId}`)
  const score = scoreAnswers(gold, answers)
  check(score.unsafeReady.length === 0, `unsafe Ready: ${score.unsafeReady.length} ${score.unsafeReady.join(', ')}`)
  check(score.conflictRecall.missed.length === 0, `conflicts caught: ${score.conflictRecall.caught.join(', ')}${score.conflictRecall.missed.length ? `; missed ${score.conflictRecall.missed.join(', ')}` : ''}`)
  console.log(`  readiness ${score.readinessAccuracy.correct}/22 · answers ${score.answerAccuracy.correct}/22 · ready ${score.readyCount} · false conflicts: ${score.conflictFalsePositives.join(', ') || 'none'}`)

  // A person resolves one conflict; it then belongs in the response
  const conflict = answers.find((a) => a.readiness === 'conflict')!
  await api(`/answers/${conflict.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', choice: 'b', final_text: conflict.response_text ?? 'Partial.', note: 'evidence is current' }),
  })

  const rem = await api<{ items: (RemediationItem & { overdue: boolean })[] }>('/requests/req-1/remediation/generate', { method: 'POST' })
  const refs = rem.items.map((i) => i.title.split(':')[0])
  const missing = gold.remediation.required.map((r) => r.ref).filter((r) => !refs.includes(r))
  const forbidden = gold.remediation.must_not_create.filter((r) => refs.includes(r))
  check(missing.length === 0 && forbidden.length === 0, `remediation items ${refs.join(', ')}${missing.length ? `; missing ${missing.join(', ')}` : ''}${forbidden.length ? `; should not exist ${forbidden.join(', ')}` : ''}`)
  check(rem.items.find((i) => i.title.startsWith('PT-01'))?.overdue === true, 'PT-01 remediation overdue')

  const response = await api<{ included: { ref: string }[]; withheld: { ref: string }[] }>('/requests/req-1/response')
  const released = new Set(response.included.map((e) => e.ref))
  const leaked = answers.filter((a) => released.has(a.question_ref) && a.readiness !== 'ready' && a.id !== conflict.id)
  check(leaked.length === 0, `response: ${response.included.length} released, ${response.withheld.length} withheld; nothing unreviewed leaked`)
  check(released.has(conflict.question_ref), `resolved conflict ${conflict.question_ref} released`)

  const xlsx = await fetch(`${base}/requests/req-1/response/export?format=xlsx`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as unknown as ExcelJS.Buffer)
  let filled = 0
  wb.getWorksheet('Questionnaire')!.eachRow((row, n) => { if (n > 1 && row.getCell(4).value) filled++ })
  check(filled === response.included.length, `filled questionnaire has ${filled} answered rows`)

  const outDir = path.join(ROOT, 'eval-results')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ score, remediation: rem.items, response }, null, 2))
} catch (err) {
  failures++
  console.log(`✗ ${err instanceof Error ? err.message : String(err)}`)
} finally {
  server.close()
}
console.log(failures ? `\n${failures} check(s) failed (${t()})` : `\nEnd-to-end run passed (${t()})`)
process.exit(failures ? 1 : 0)
