import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import express, { RequestHandler } from 'express'
import fs from 'fs'
import { AddressInfo } from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AuthRequest } from '../middleware/auth.js'
import { PROMPTS } from '../services/tprm/analyze.js'
import { ANSWER_PROMPTS } from '../services/tprm/answer.js'
import { TprmLlm } from '../services/tprm/llm.js'
import { MemorySecurityReviewStore } from '../services/tprm/memoryStore.js'
import { fakePipelineLlm, FakeTprmLlm } from '../services/tprm/testing/fakeLlm.js'
import { createSecurityReviewRouter } from './securityReview.js'

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../test_data/tprm/documents')
const sample = (name: string) => fs.readFileSync(path.join(SAMPLES, name))

// Stand-in for requireAuth: the user id comes from a test header
const fakeAuth: RequestHandler = (req, res, next) => {
  const user = req.header('x-test-user')
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  ;(req as AuthRequest).userId = user
  next()
}

let store: MemorySecurityReviewStore
let llm: TprmLlm | null
let base = ''
let close: () => void

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/security-review', (req, res, next) =>
    createSecurityReviewRouter({ store, requireAuth: fakeAuth, samplesDir: SAMPLES, llm })(req, res, next))
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/security-review`
  close = () => server.close()
})

after(() => close())

beforeEach(() => {
  store = new MemorySecurityReviewStore()
  store.suppliers.set('user-acme', 'sup-acme')
  store.suppliers.set('user-other', 'sup-other')
  store.requests.set('req-1', 'sup-acme')
  store.requests.set('req-other', 'sup-other')
  llm = null
})

function upload(file: Uint8Array | string, filename: string, opts: { user?: string; request?: string; role?: string } = {}) {
  const qs = new URLSearchParams({ filename, ...(opts.role ? { role: opts.role } : {}) })
  return fetch(`${base}/requests/${opts.request ?? 'req-1'}/documents?${qs}`, {
    method: 'POST',
    headers: { 'x-test-user': opts.user ?? 'user-acme', 'content-type': 'application/octet-stream' },
    body: typeof file === 'string' ? file : Buffer.from(file),
  })
}

const get = (p: string, user = 'user-acme') => fetch(`${base}${p}`, { headers: { 'x-test-user': user } })

describe('access control', () => {
  test('401 without a user', async () => {
    assert.equal((await fetch(`${base}/requests/req-1/documents`)).status, 401)
  })

  test('404 when the user has no supplier profile', async () => {
    assert.equal((await get('/requests/req-1/documents', 'user-nobody')).status, 404)
  })

  test('404 when the request belongs to another supplier', async () => {
    assert.equal((await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf', { request: 'req-other' })).status, 404)
    assert.equal(store.documents.length, 0)
  })

  test("cannot read another supplier's document page", async () => {
    await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf')
    const doc = store.documents[0]
    assert.equal((await get(`/documents/${doc.id}/units/10`, 'user-other')).status, 404)
  })
})

describe('upload and parse', () => {
  test('PDF is stored, parsed into pages and logged', async () => {
    const res = await upload(sample('acme_soc2_type2_2026.pdf'), 'SOC 2 report (final).pdf')
    assert.equal(res.status, 201)
    const body = await res.json() as { units: number; document: { parse_status: string; role: string; filename: string; storage_path: string } }
    assert.equal(body.units, 16)
    assert.equal(body.document.parse_status, 'parsed')
    assert.equal(body.document.role, 'evidence')
    assert.equal(body.document.filename, 'SOC_2_report_final_.pdf')
    assert.ok(store.files.has(body.document.storage_path))
    assert.equal(store.units.length, 16)
    assert.deepEqual(store.events.map((e) => e.event_type), ['document_uploaded', 'document_parsed'])
    assert.equal(store.events[0].actor, 'user')
  })

  test('re-uploading the same file is a no-op', async () => {
    await upload(sample('acme_pentest_summary_2026.pdf'), 'pt.pdf')
    const res = await upload(sample('acme_pentest_summary_2026.pdf'), 'pt-copy.pdf')
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { duplicate: boolean }).duplicate, true)
    assert.equal(store.documents.length, 1)
  })

  test('questionnaire spreadsheet is detected', async () => {
    const res = await upload(sample('clearfield_vendor_security_questionnaire.xlsx'), 'q.xlsx')
    const body = await res.json() as { questions: number; document: { role: string; doc_type: string } }
    assert.equal(body.questions, 22)
    assert.equal(body.document.role, 'questionnaire')
    assert.equal(body.document.doc_type, 'questionnaire')
  })

  test('evidence spreadsheet is not mistaken for a questionnaire', async () => {
    const body = await (await upload(sample('acme_access_review_q2_2026.xlsx'), 'ar.xlsx')).json() as { document: { role: string; parse_status: string } }
    assert.equal(body.document.role, 'evidence')
    assert.equal(body.document.parse_status, 'parsed')
  })

  test('rejects files that are not PDF or XLSX, judged by content', async () => {
    const res = await upload('just some text pretending to be a pdf', 'fake.pdf')
    assert.equal(res.status, 415)
    assert.equal(store.documents.length, 0)
  })

  test('rejects empty and oversized files', async () => {
    assert.equal((await upload(new Uint8Array(), 'empty.pdf')).status, 400)
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    big.set(Buffer.from('%PDF-'))
    assert.equal((await upload(big, 'big.pdf')).status, 413)
  })

  test('a corrupt PDF is recorded as failed, not crashed', async () => {
    const res = await upload(Buffer.from('%PDF-1.7\nthis is not really a pdf'), 'broken.pdf')
    assert.equal(res.status, 201)
    const body = await res.json() as { document: { parse_status: string; parse_error: string | null } }
    assert.equal(body.document.parse_status, 'failed')
    assert.ok(body.document.parse_error)
    assert.equal(store.events.at(-1)?.event_type, 'document_parse_failed')
  })

  test('storage outage still parses; original link is unavailable', async () => {
    store.failUploads = true
    const body = await (await upload(sample('acme_phishing_simulation_summary_2026.pdf'), 'ph.pdf')).json() as { document: { id: string; parse_status: string; storage_path: string | null } }
    assert.equal(body.document.parse_status, 'parsed')
    assert.equal(body.document.storage_path, null)
    assert.ok(store.events.some((e) => e.event_type === 'document_storage_failed'))
    assert.equal((await get(`/documents/${body.document.id}/original`)).status, 404)
  })
})

describe('reading evidence', () => {
  test('page text behind a citation', async () => {
    await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf')
    const doc = store.documents[0]
    const res = await get(`/documents/${doc.id}/units/10`)
    const body = await res.json() as { unit: { locator: { page: number }; text: string; low_text: boolean } }
    assert.equal(body.unit.locator.page, 11)
    assert.match(body.unit.text, /41 days after review/)
    assert.equal(body.unit.low_text, false)
    assert.equal((await get(`/documents/${doc.id}/units/99`)).status, 404)
  })

  test('unit behind a citation locator, for PDFs and spreadsheet rows', async () => {
    await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf')
    await upload(sample('acme_access_review_q2_2026.xlsx'), 'ar.xlsx')
    const [pdf, xlsx] = store.documents
    const page = await (await get(`/documents/${pdf.id}/unit?page=11`)).json() as { unit: { text: string } }
    assert.match(page.unit.text, /41 days after review/)
    const rows = await (await get(`/documents/${xlsx.id}/unit?sheet=Q2-2026%20Review&row=27`)).json() as { unit: { locator: { row_start: number } } }
    assert.equal(rows.unit.locator.row_start, 27)
    assert.equal((await get(`/documents/${pdf.id}/unit?page=40`)).status, 404)
    assert.equal((await get(`/documents/${pdf.id}/unit?page=11`, 'user-other')).status, 404)
  })

  test('signed link to the original', async () => {
    await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf')
    const body = await (await get(`/documents/${store.documents[0].id}/original`)).json() as { url: string }
    assert.match(body.url, /^memory:\/\/sup-acme\/req-1\//)
  })

  test('sample documents load in one call', async () => {
    const res = await fetch(`${base}/requests/req-1/documents/samples`, { method: 'POST', headers: { 'x-test-user': 'user-acme' } })
    assert.equal(res.status, 201)
    const docs = await (await get('/requests/req-1/documents')).json() as { documents: { role: string; parse_status: string }[] }
    assert.equal(docs.documents.length, 6)
    assert.equal(docs.documents.filter((d) => d.role === 'questionnaire').length, 1)
    assert.ok(docs.documents.every((d) => d.parse_status === 'parsed'))
  })

  test('activity timeline lists newest first', async () => {
    await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf')
    const body = await (await get('/requests/req-1/activity')).json() as { events: { event_type: string }[] }
    assert.deepEqual(body.events.map((e) => e.event_type), ['document_parsed', 'document_uploaded'])
  })
})

describe('document analysis', () => {
  const post = (p: string, user = 'user-acme') => fetch(`${base}${p}`, { method: 'POST', headers: { 'x-test-user': user } })
  const patch = (p: string, body: unknown, user = 'user-acme') => fetch(`${base}${p}`, {
    method: 'PATCH', headers: { 'x-test-user': user, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const phishingLlm = () => new FakeTprmLlm({
    [PROMPTS.extract]: { json: { doc_type: 'phishing_summary', doc_type_reason: 'Phishing results.', findings: [
      { kind: 'phishing_metric', ref: 'training_completion', title: 'Training completion', stated_severity: null, status: null,
        detail: '87%', location: { page: 1, sheet: null, row: null }, quote: '124 of 142 employees (87%)' },
    ] } },
    [PROMPTS.summarize]: { json: { headline: 'Phishing summary.', top_findings: [], key_exceptions: [], takeaways: [] } },
  })

  test('503 when no model is configured; upload still works', async () => {
    await upload(sample('acme_phishing_simulation_summary_2026.pdf'), 'ph.pdf')
    assert.equal((await post('/requests/req-1/analyze')).status, 503)
    assert.equal((await post(`/documents/${store.documents[0].id}/analyze`)).status, 503)
  })

  test("analyze a request, then read its findings; other suppliers can't", async () => {
    llm = phishingLlm()
    await upload(sample('acme_phishing_simulation_summary_2026.pdf'), 'ph.pdf')
    const res = await post('/requests/req-1/analyze')
    assert.equal(res.status, 200)
    const body = await res.json() as { results: { status: string; docType: string }[] }
    assert.deepEqual(body.results.map((r) => [r.status, r.docType]), [['analyzed', 'phishing_summary']])

    const findings = await (await get('/requests/req-1/findings')).json() as { findings: { ref: string; quote_verified: boolean }[] }
    assert.deepEqual(findings.findings.map((f) => [f.ref, f.quote_verified]), [['training_completion', true]])

    assert.equal((await post('/requests/req-1/analyze', 'user-other')).status, 404)
    assert.equal((await get('/requests/req-1/findings', 'user-other')).status, 404)
    assert.equal((await post(`/documents/${store.documents[0].id}/analyze`, 'user-other')).status, 404)
  })

  test('a questionnaire cannot be analyzed as evidence', async () => {
    llm = phishingLlm()
    await upload(sample('clearfield_vendor_security_questionnaire.xlsx'), 'q.xlsx')
    assert.equal((await post(`/documents/${store.documents[0].id}/analyze`)).status, 409)
  })

  test('vendor can correct the document type; it is validated, owned and logged', async () => {
    await upload(sample('acme_phishing_simulation_summary_2026.pdf'), 'ph.pdf')
    const id = store.documents[0].id
    assert.equal((await patch(`/documents/${id}`, { doc_type: 'questionnaire' })).status, 400)
    assert.equal((await patch(`/documents/${id}`, { doc_type: 'nonsense' })).status, 400)
    assert.equal((await patch(`/documents/${id}`, { doc_type: 'phishing_summary' }, 'user-other')).status, 404)
    const res = await patch(`/documents/${id}`, { doc_type: 'phishing_summary' })
    assert.equal(res.status, 200)
    assert.equal(store.documents[0].doc_type_source, 'user')
    assert.equal(store.events.at(-1)?.event_type, 'document_type_set')
  })
})

describe('questionnaire runs', () => {
  const pipelineLlm = fakePipelineLlm

  const loadSamples = () => fetch(`${base}/requests/req-1/documents/samples`, { method: 'POST', headers: { 'x-test-user': 'user-acme' } })
  const startRun = (signal?: AbortSignal) => fetch(`${base}/requests/req-1/runs`, { method: 'POST', headers: { 'x-test-user': 'user-acme' }, signal })
  const events = (body: string) => body.split('\n\n').filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice(6)) as { type: string } & Record<string, unknown>)

  test('streams progress, persists every answer, logs the run and the conflict', async () => {
    llm = pipelineLlm()
    await loadSamples()
    const res = await startRun()
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/)
    const evs = events(await res.text())

    assert.equal(evs[0].type, 'run_started')
    assert.equal(evs[0].questions, 22)
    assert.equal(evs.filter((e) => e.type === 'analysis').length, 5)
    assert.equal(evs.filter((e) => e.type === 'answer').length, 22)
    const done = evs.at(-1) as { type: string; run: { status: string; stats: { ready: number; conflict: number } } }
    assert.equal(done.type, 'done')
    assert.equal(done.run.status, 'completed')
    assert.deepEqual([done.run.stats.ready, done.run.stats.conflict], [21, 1])

    const run = store.runs[0]
    assert.equal(run.status, 'completed')
    assert.equal(run.prompt_versions.draft, ANSWER_PROMPTS.draft)
    assert.match(run.as_of ?? '', /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(store.answers.length, 22)
    const iam01 = store.answers.find((a) => a.question_ref === 'IAM-01')!
    assert.equal(iam01.readiness, 'conflict')
    assert.equal(iam01.conflict?.b?.filename, 'acme_pentest_summary_2026.pdf')
    const types = store.events.map((e) => e.event_type)
    assert.ok(types.includes('questionnaire_run_started'))
    assert.equal(types.filter((t) => t === 'answer_conflict_detected').length, 1)
    assert.ok(types.includes('questionnaire_run_completed'))

    const got = await (await get(`/runs/${run.id}`)).json() as { answers: { question_ref: string }[] }
    assert.equal(got.answers.length, 22)
    assert.deepEqual(got.answers.slice(0, 4).map((a) => a.question_ref), ['GOV-01', 'GOV-02', 'GOV-03', 'IAM-01'], 'questionnaire order')
    assert.equal((await get(`/runs/${run.id}`, 'user-other')).status, 404)
    const runs = await (await get('/requests/req-1/runs')).json() as { runs: { id: string }[] }
    assert.deepEqual(runs.runs.map((r) => r.id), [run.id])
  })

  test('a second run reuses document analysis', async () => {
    llm = pipelineLlm()
    await loadSamples()
    await (await startRun()).text()
    const fake = pipelineLlm()
    llm = fake
    await (await startRun()).text()
    assert.equal(fake.calls.filter((c) => c.task === PROMPTS.extract).length, 0)
    assert.equal(store.runs.length, 2)
  })

  test('rejections come back as JSON before streaming starts', async () => {
    llm = pipelineLlm()
    assert.equal((await startRun()).status, 409, 'nothing uploaded')
    await upload(sample('acme_soc2_type2_2026.pdf'), 'soc2.pdf')
    const noQuestionnaire = await startRun()
    assert.equal(noQuestionnaire.status, 409)
    assert.match(((await noQuestionnaire.json()) as { error: string }).error, /questionnaire/)

    await upload(sample('clearfield_vendor_security_questionnaire.xlsx'), 'q.xlsx')
    store.runs.push({ id: 'r0', supplier_id: 'sup-acme', request_id: 'req-1', questionnaire_doc_id: 'q', status: 'running',
      model: 'm', prompt_versions: {}, stats: null, error: null, as_of: null, created_at: new Date().toISOString(), completed_at: null })
    assert.match(((await (await startRun()).json()) as { error: string }).error, /already in progress/)

    store.runs[0].created_at = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    assert.equal((await startRun()).status, 200, 'a stale running run does not block')
    assert.equal((await fetch(`${base}/requests/req-other/runs`, { method: 'POST', headers: { 'x-test-user': 'user-acme' } })).status, 404)
  })

  test('503 without a model', async () => {
    await loadSamples()
    assert.equal((await startRun()).status, 503)
  })

  test('the run finishes and saves answers after the client disconnects', async () => {
    llm = pipelineLlm({}, 15)   // slow enough that the disconnect lands mid-run
    await loadSamples()
    const controller = new AbortController()
    const res = await startRun(controller.signal)
    const reader = res.body!.getReader()
    await reader.read()
    controller.abort()
    assert.equal(store.runs[0].status, 'running', 'disconnected before the run finished')
    for (let i = 0; i < 100 && store.runs[0]?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 50))
    assert.equal(store.runs[0].status, 'completed')
    assert.equal(store.answers.length, 22)
  })

  test('model failures hold answers back; a storage failure fails the run cleanly', async () => {
    llm = pipelineLlm({ [ANSWER_PROMPTS.draft]: { apiError: 'overloaded' } })
    await loadSamples()
    await (await startRun()).text()
    assert.equal(store.runs[0].status, 'completed')
    assert.ok(store.answers.every((a) => a.readiness !== 'ready' && a.reasons.includes('SCHEMA_INVALID')))

    llm = pipelineLlm()
    store.saveAnswer = async () => { throw new Error('db down') }
    const evs = events(await (await startRun()).text())
    assert.equal(evs.at(-1)?.type, 'error')
    assert.equal(store.runs.at(-1)?.status, 'failed')
    assert.equal(store.runs.at(-1)?.error, 'db down')
    assert.equal(store.events.at(-1)?.event_type, 'questionnaire_run_failed')
  })
})

describe('human review', () => {
  const patchAnswer = (id: string, body: unknown, user = 'user-acme') => fetch(`${base}/answers/${id}`, {
    method: 'PATCH', headers: { 'x-test-user': user, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

  async function completedRun() {
    llm = fakePipelineLlm()
    await fetch(`${base}/requests/req-1/documents/samples`, { method: 'POST', headers: { 'x-test-user': 'user-acme' } })
    await (await fetch(`${base}/requests/req-1/runs`, { method: 'POST', headers: { 'x-test-user': 'user-acme' } })).text()
    return {
      ready: store.answers.find((a) => a.readiness === 'ready')!,
      conflict: store.answers.find((a) => a.readiness === 'conflict')!,
    }
  }

  test('approve, edit and reject are saved and logged with the AI readiness', async () => {
    const { ready } = await completedRun()
    const res = await patchAnswer(ready.id, { action: 'approve' })
    assert.equal(res.status, 200)
    assert.equal(store.answers.find((a) => a.id === ready.id)!.review_status, 'approved')
    const ev = store.events.at(-1)!
    assert.equal(ev.event_type, 'answer_approved')
    assert.equal(ev.actor, 'user')
    assert.equal(ev.payload.ai_readiness, 'ready')

    await patchAnswer(ready.id, { action: 'edit', final_text: '  Yes. MFA is required for VPN.  ' })
    const edited = store.answers.find((a) => a.id === ready.id)!
    assert.deepEqual([edited.review_status, edited.final_text], ['edited', 'Yes. MFA is required for VPN.'])

    await patchAnswer(ready.id, { action: 'reject', note: 'wrong scope' })
    assert.equal(store.answers.find((a) => a.id === ready.id)!.review_status, 'rejected')
    assert.equal(store.events.at(-1)!.payload.note, 'wrong scope')
  })

  test('a conflict must be resolved, not approved', async () => {
    const { conflict, ready } = await completedRun()
    assert.equal((await patchAnswer(conflict.id, { action: 'approve' })).status, 409)
    assert.equal((await patchAnswer(conflict.id, { action: 'edit', final_text: 'x' })).status, 409)
    assert.equal((await patchAnswer(ready.id, { action: 'resolve', choice: 'a', final_text: 'x' })).status, 409)

    const res = await patchAnswer(conflict.id, { action: 'resolve', choice: 'b', final_text: 'Partial: the admin portal lacks MFA until Q4.', note: 'pen test is current' })
    assert.equal(res.status, 200)
    const row = store.answers.find((a) => a.id === conflict.id)!
    assert.equal(row.review_status, 'edited')
    assert.equal(row.readiness, 'conflict', 'the AI readiness is kept for the record')
    assert.deepEqual([store.events.at(-1)!.event_type, store.events.at(-1)!.payload.choice], ['conflict_resolved', 'b'])
  })

  test('bad input and other suppliers are refused', async () => {
    const { ready } = await completedRun()
    assert.equal((await patchAnswer(ready.id, { action: 'edit', final_text: '   ' })).status, 400)
    assert.equal((await patchAnswer(ready.id, { action: 'publish' })).status, 400)
    assert.equal((await patchAnswer(ready.id, { action: 'approve' }, 'user-other')).status, 404)
    assert.equal((await patchAnswer('nope', { action: 'approve' })).status, 404)
    assert.equal(store.answers.find((a) => a.id === ready.id)!.review_status, 'pending')
  })
})
