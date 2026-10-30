import express, { NextFunction, RequestHandler, Response, Router } from 'express'
import fs from 'fs'
import path from 'path'
import type { SecurityDocRole } from '../../types/index.js'
import type { AuthRequest } from '../middleware/auth.js'
import { ingestDocument, MAX_UPLOAD_BYTES, UploadRejected } from '../services/tprm/ingest.js'
import { isLowText } from '../services/tprm/parsers.js'
import { SecurityReviewStore } from '../services/tprm/store.js'

export interface SecurityReviewDeps {
  store: SecurityReviewStore
  requireAuth: RequestHandler
  // Folder of synthetic sample documents for the "Use sample documents" button
  samplesDir: string
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

export function createSecurityReviewRouter({ store, requireAuth, samplesDir }: SecurityReviewDeps): Router {
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
    if (err instanceof UploadRejected) {
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
