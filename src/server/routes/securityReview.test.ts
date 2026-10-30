import { after, before, beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import express, { RequestHandler } from 'express'
import fs from 'fs'
import { AddressInfo } from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AuthRequest } from '../middleware/auth.js'
import { MemorySecurityReviewStore } from '../services/tprm/memoryStore.js'
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
let base = ''
let close: () => void

before(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/security-review', (req, res, next) =>
    createSecurityReviewRouter({ store, requireAuth: fakeAuth, samplesDir: SAMPLES })(req, res, next))
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
