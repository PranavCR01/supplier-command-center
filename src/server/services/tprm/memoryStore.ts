import { randomUUID } from 'crypto'
import type { ActivityEvent, DocumentFinding, DocumentUnitRow, SecurityDocument } from '../../../types/index.js'
import { NewActivityEvent, NewFinding, NewSecurityDocument, NewUnit, SecurityReviewStore } from './store.js'

// In-memory SecurityReviewStore for tests and for running the pipeline/evals without a database.
export class MemorySecurityReviewStore implements SecurityReviewStore {
  suppliers = new Map<string, string>()          // userId -> supplierId
  requests = new Map<string, string>()           // requestId -> supplierId
  documents: SecurityDocument[] = []
  units: DocumentUnitRow[] = []
  findings: DocumentFinding[] = []
  files = new Map<string, Uint8Array>()
  events: ActivityEvent[] = []
  failUploads = false

  async getSupplierIdForUser(userId: string) {
    return this.suppliers.get(userId) ?? null
  }

  async requestBelongsToSupplier(requestId: string, supplierId: string) {
    return this.requests.get(requestId) === supplierId
  }

  async findDocumentBySha(requestId: string, sha256: string) {
    return this.documents.find((d) => d.request_id === requestId && d.sha256 === sha256) ?? null
  }

  async insertDocument(doc: NewSecurityDocument) {
    const row: SecurityDocument = {
      ...doc,
      id: randomUUID(),
      storage_path: null,
      parse_status: 'pending',
      parse_error: null,
      unit_count: null,
      summary: null,
      summary_prompt_version: null,
      analysis_status: 'pending',
      analysis_error: null,
      created_at: new Date().toISOString(),
    }
    this.documents.push(row)
    return { ...row }
  }

  async updateDocument(id: string, patch: Partial<SecurityDocument>) {
    const row = this.documents.find((d) => d.id === id)
    if (!row) throw new Error(`document ${id} not found`)
    Object.assign(row, patch)
  }

  async listDocuments(requestId: string) {
    return this.documents.filter((d) => d.request_id === requestId).map((d) => ({ ...d }))
  }

  async getDocument(id: string, supplierId: string) {
    const row = this.documents.find((d) => d.id === id && d.supplier_id === supplierId)
    return row ? { ...row } : null
  }

  async insertUnits(supplierId: string, documentId: string, units: NewUnit[]) {
    for (const u of units) {
      if (this.units.some((x) => x.document_id === documentId && x.unit_index === u.unit_index)) {
        throw new Error('duplicate unit')
      }
      this.units.push({ ...u, id: randomUUID(), supplier_id: supplierId, document_id: documentId })
    }
  }

  async getUnit(documentId: string, unitIndex: number) {
    return this.units.find((u) => u.document_id === documentId && u.unit_index === unitIndex) ?? null
  }

  async listUnits(documentId: string) {
    return this.units.filter((u) => u.document_id === documentId).sort((a, b) => a.unit_index - b.unit_index)
  }

  async replaceFindings(supplierId: string, documentId: string, findings: NewFinding[]) {
    this.findings = this.findings.filter((f) => f.document_id !== documentId)
    for (const f of findings) {
      this.findings.push({
        ...f, id: randomUUID(), supplier_id: supplierId, document_id: documentId, created_at: new Date().toISOString(),
      })
    }
  }

  async listFindings(documentIds: string[]) {
    return this.findings.filter((f) => documentIds.includes(f.document_id)).map((f) => ({ ...f }))
  }

  async uploadOriginal(path: string, data: Uint8Array) {
    if (this.failUploads) throw new Error('storage unavailable')
    this.files.set(path, data)
  }

  async signedUrl(path: string, expiresInSeconds: number) {
    return `memory://${path}?expires=${expiresInSeconds}`
  }

  async logEvent(event: NewActivityEvent) {
    this.events.push({
      id: randomUUID(),
      actor_id: null,
      entity_type: null,
      entity_id: null,
      payload: {},
      ...event,
      created_at: new Date().toISOString(),
    } as ActivityEvent)
  }

  async listEvents(requestId: string) {
    return this.events.filter((e) => e.request_id === requestId).slice().reverse()
  }
}
