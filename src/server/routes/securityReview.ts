import express, { NextFunction, RequestHandler, Response, Router } from 'express'
import fs from 'fs'
import path from 'path'
import type { SecurityDocRole, SecurityDocType } from '../../types/index.js'
import type { AuthRequest } from '../middleware/auth.js'
import { analyzeDocument, analyzeRequestDocuments } from '../services/tprm/analyze.js'
import { todayIso } from '../services/tprm/answer.js'
import { ingestDocument, MAX_UPLOAD_BYTES, UploadRejected } from '../services/tprm/ingest.js'
import { TprmLlm } from '../services/tprm/llm.js'
import { isLowText } from '../services/tprm/parsers.js'
import { reviewAnswer, ReviewRejected } from '../services/tprm/review.js'
import { executeRun, prepareRun, RunEvent, RunRejected } from '../services/tprm/run.js'
import { SecurityReviewStore } from '../services/tprm/store.js'

export interface SecurityReviewDeps {
  store: SecurityReviewStore
  requireAuth: RequestHandler
  // Folder of synthetic sample documents for the "Use sample documents" button
  samplesDir: string
  // null when no API key is configured: analysis routes answer 503, everything else works
  llm: TprmLlm | null
}

interface ScopedRequest extends AuthRequest {
  supplierId?: string
}

const SIGNED_URL_SECONDS = 300

type AsyncHandler = (req: ScopedRequest, res: Response, next: NextFunction) => Promise<void>

// Express 4 does not catch rejected promises; route errors to the router's error handler
const wrap = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  fn(req as ScopedRequest, res, next).catch(next)
}

function parseRole(value: unknown): SecurityDocRole | undefined {
  return value === 'evidence' || value === 'questionnaire' ? value : undefined
}

// Types a vendor may set by hand on an evidence document (questionnaire is a role, not a choice here)
const SETTABLE_DOC_TYPES: SecurityDocType[] = [
  'soc2_report', 'pentest_summary', 'phishing_summary', 'security_policy', 'access_review', 'other',
]

export function createSecurityReviewRouter({ store, requireAuth, samplesDir, llm }: SecurityReviewDeps): Router {
  const router = Router()

  router.use(requireAuth)
  router.use(wrap(async (req, res, next) => {
    const supplierId = req.userId ? await store.getSupplierIdForUser(req.userId) : null
    if (!supplierId) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }
    req.supplierId = supplierId
    next()
  }))

  const requireOwnership = wrap(async (req, res, next) => {
    if (!(await store.requestBelongsToSupplier(req.params.requestId, req.supplierId!))) {
      res.status(404).json({ error: 'Request not found' })
      return
    }
    next()
  })

  // POST /requests/:requestId/documents?filename=report.pdf&role=evidence  (body: raw file bytes)
  router.post(
    '/requests/:requestId/documents',
    requireOwnership,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    wrap(async (req, res) => {
      const filename = typeof req.query.filename === 'string' ? req.query.filename : 'document'
      const data = Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array()
      const result = await ingestDocument(
        { store, supplierId: req.supplierId!, requestId: req.params.requestId, userId: req.userId ?? null },
        { filename, data, role: parseRole(req.query.role) },
      )
      res.status(result.duplicate ? 200 : 201).json(result)
    }),
  )

  // POST /requests/:requestId/documents/samples — load the synthetic demo evidence set
  router.post('/requests/:requestId/documents/samples', requireOwnership, wrap(async (req, res) => {
    const files = fs.readdirSync(samplesDir).filter((f) => /\.(pdf|xlsx)$/i.test(f)).sort()
    const results = []
    for (const file of files) {
      results.push(await ingestDocument(
        { store, supplierId: req.supplierId!, requestId: req.params.requestId, userId: req.userId ?? null },
        { filename: file, data: new Uint8Array(fs.readFileSync(path.join(samplesDir, file))) },
      ))
    }
    res.status(201).json({ results })
  }))

  router.get('/requests/:requestId/documents', requireOwnership, wrap(async (req, res) => {
    res.json({ documents: await store.listDocuments(req.params.requestId) })
  }))

  const requireLlm = wrap(async (_req, res, next) => {
    if (!llm) {
      res.status(503).json({ error: 'AI analysis is not configured' })
      return
    }
    next()
  })

  // POST /requests/:requestId/analyze — classify, extract findings and summarize every evidence document
  router.post('/requests/:requestId/analyze', requireOwnership, requireLlm, wrap(async (req, res) => {
    const results = await analyzeRequestDocuments({
      store, llm: llm!, supplierId: req.supplierId!, requestId: req.params.requestId,
    })
    res.json({ results })
  }))

  // GET /requests/:requestId/findings — structured findings across the request's documents
  router.get('/requests/:requestId/findings', requireOwnership, wrap(async (req, res) => {
    const docs = await store.listDocuments(req.params.requestId)
    res.json({ findings: await store.listFindings(docs.map((d) => d.id)) })
  }))

  // POST /requests/:requestId/runs — answer the questionnaire; progress streams as SSE
  // (data: {type: run_started | analysis | answer | done | error}). The run keeps going and
  // saving answers if the client disconnects.
  router.post('/requests/:requestId/runs', requireOwnership, requireLlm, wrap(async (req, res) => {
    const ctx = { store, llm: llm!, supplierId: req.supplierId!, requestId: req.params.requestId, userId: req.userId ?? null }
    const prepared = await prepareRun(ctx)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    let open = true
    res.on('close', () => { open = false })
    const send = (e: RunEvent) => {
      if (open) res.write(`data: ${JSON.stringify(e)}\n\n`)
    }
    await executeRun(ctx, prepared, { asOf: todayIso(), onEvent: send })
    res.end()
  }))

  router.get('/requests/:requestId/runs', requireOwnership, wrap(async (req, res) => {
    res.json({ runs: await store.listRuns(req.params.requestId) })
  }))

  // GET /runs/:runId — a run and its answers
  router.get('/runs/:runId', wrap(async (req, res) => {
    const run = await store.getRun(req.params.runId, req.supplierId!)
    if (!run) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json({ run, answers: await store.listAnswers(run.id) })
  }))

  // PATCH /answers/:answerId {action: approve | edit | resolve | reject, ...} — human review
  router.patch('/answers/:answerId', wrap(async (req, res) => {
    const answer = await store.getAnswer(req.params.answerId, req.supplierId!)
    const run = answer ? await store.getRun(answer.run_id, req.supplierId!) : null
    if (!answer || !run) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const updated = await reviewAnswer(store, { supplierId: req.supplierId!, requestId: run.request_id, userId: req.userId ?? null }, answer, req.body)
    res.json({ answer: updated })
  }))

  router.get('/requests/:requestId/activity', requireOwnership, wrap(async (req, res) => {
    res.json({ events: await store.listEvents(req.params.requestId) })
  }))

  // GET /documents/:documentId/units/:unitIndex — the extracted text behind a citation
  router.get('/documents/:documentId/units/:unitIndex', wrap(async (req, res) => {
    const doc = await store.getDocument(req.params.documentId, req.supplierId!)
    const unitIndex = Number(req.params.unitIndex)
    const unit = doc && Number.isInteger(unitIndex) ? await store.getUnit(doc.id, unitIndex) : null
    if (!doc || !unit) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json({
      document: { id: doc.id, filename: doc.filename, unit_count: doc.unit_count },
      unit: { unit_index: unit.unit_index, locator: unit.locator, text: unit.text, low_text: isLowText(unit.text) },
    })
  }))

  // POST /documents/:documentId/analyze — (re)analyze one document; replaces its findings and summary
  router.post('/documents/:documentId/analyze', requireLlm, wrap(async (req, res) => {
    const doc = await store.getDocument(req.params.documentId, req.supplierId!)
    if (!doc || !doc.request_id) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const result = await analyzeDocument({ store, llm: llm!, supplierId: req.supplierId!, requestId: doc.request_id }, doc)
    if (result.status === 'skipped') {
      res.status(409).json({ error: 'Only parsed evidence documents can be analyzed', result })
      return
    }
    res.json({ result })
  }))

  // PATCH /documents/:documentId { doc_type } — vendor corrects the classification; kept on re-analysis
  router.patch('/documents/:documentId', wrap(async (req, res) => {
    const doc = await store.getDocument(req.params.documentId, req.supplierId!)
    if (!doc) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    const docType = (req.body as { doc_type?: unknown } | undefined)?.doc_type
    if (doc.role !== 'evidence' || !SETTABLE_DOC_TYPES.includes(docType as SecurityDocType)) {
      res.status(400).json({ error: `doc_type must be one of: ${SETTABLE_DOC_TYPES.join(', ')}` })
      return
    }
    await store.updateDocument(doc.id, { doc_type: docType as SecurityDocType, doc_type_source: 'user' })
    await store.logEvent({
      supplier_id: req.supplierId!, request_id: doc.request_id, actor: 'user', actor_id: req.userId ?? null,
      event_type: 'document_type_set', entity_type: 'security_document', entity_id: doc.id,
      payload: { from: doc.doc_type, to: docType },
    })
    res.json({ document: await store.getDocument(doc.id, req.supplierId!) })
  }))

  // GET /documents/:documentId/unit?page=3 | ?sheet=Q2&row=27 — the unit behind a citation locator
  router.get('/documents/:documentId/unit', wrap(async (req, res) => {
    const doc = await store.getDocument(req.params.documentId, req.supplierId!)
    const page = Number(req.query.page)
    const row = Number(req.query.row)
    const sheet = typeof req.query.sheet === 'string' ? req.query.sheet : null
    const unit = doc ? (await store.listUnits(doc.id)).find((u) => 'page' in u.locator
      ? u.locator.page === page
      : u.locator.sheet === sheet && row >= u.locator.row_start && row <= u.locator.row_end) : undefined
    if (!doc || !unit) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.json({
      document: { id: doc.id, filename: doc.filename, unit_count: doc.unit_count, has_original: Boolean(doc.storage_path) },
      unit: { unit_index: unit.unit_index, locator: unit.locator, text: unit.text, low_text: isLowText(unit.text) },
    })
  }))

  // GET /documents/:documentId/original — short-lived link to the uploaded file
  router.get('/documents/:documentId/original', wrap(async (req, res) => {
    const doc = await store.getDocument(req.params.documentId, req.supplierId!)
    if (!doc || !doc.storage_path) {
      res.status(404).json({ error: 'Original file not available' })
      return
    }
    res.json({ url: await store.signedUrl(doc.storage_path, SIGNED_URL_SECONDS), expires_in: SIGNED_URL_SECONDS })
  }))

  router.use((err: Error & { status?: number; type?: string }, _req: ScopedRequest, res: Response, _next: NextFunction) => {
    if (err instanceof UploadRejected || err instanceof RunRejected || err instanceof ReviewRejected) {
      res.status(err.status).json({ error: err.message })
      return
    }
    if (err.type === 'entity.too.large') {
      res.status(413).json({ error: 'File is larger than 10 MB' })
      return
    }
    console.error(err.stack)
    res.status(500).json({ error: 'Internal server error' })
  })

  return router
}
