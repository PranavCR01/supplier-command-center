import { SupabaseClient } from '@supabase/supabase-js'
import type {
  ActivityActor,
  ActivityEvent,
  DocumentFinding,
  DocumentUnitRow,
  Locator,
  SecurityDocRole,
  SecurityDocType,
  SecurityDocument,
} from '../../../types/index.js'

export const SECURITY_DOCS_BUCKET = 'security-docs'

export interface NewSecurityDocument {
  supplier_id: string
  request_id: string
  filename: string
  mime_type: string
  sha256: string
  role: SecurityDocRole
  doc_type: SecurityDocType | null
  doc_type_source: 'ai' | 'user' | null
}

export interface NewUnit {
  unit_index: number
  locator: Locator
  text: string
}

export type NewFinding = Omit<DocumentFinding, 'id' | 'supplier_id' | 'document_id' | 'created_at'>

export interface NewActivityEvent {
  supplier_id: string
  request_id: string | null
  actor: ActivityActor
  actor_id?: string | null
  event_type: string
  entity_type?: string | null
  entity_id?: string | null
  payload?: Record<string, unknown>
}

// Everything the security review needs from persistence. The Supabase implementation
// is used in the app; tests use an in-memory implementation of the same interface.
export interface SecurityReviewStore {
  getSupplierIdForUser(userId: string): Promise<string | null>
  requestBelongsToSupplier(requestId: string, supplierId: string): Promise<boolean>

  findDocumentBySha(requestId: string, sha256: string): Promise<SecurityDocument | null>
  insertDocument(doc: NewSecurityDocument): Promise<SecurityDocument>
  updateDocument(id: string, patch: Partial<SecurityDocument>): Promise<void>
  listDocuments(requestId: string): Promise<SecurityDocument[]>
  getDocument(id: string, supplierId: string): Promise<SecurityDocument | null>

  insertUnits(supplierId: string, documentId: string, units: NewUnit[]): Promise<void>
  getUnit(documentId: string, unitIndex: number): Promise<DocumentUnitRow | null>
  listUnits(documentId: string): Promise<DocumentUnitRow[]>

  // Re-analysis replaces a document's findings rather than appending to them
  replaceFindings(supplierId: string, documentId: string, findings: NewFinding[]): Promise<void>
  listFindings(documentIds: string[]): Promise<DocumentFinding[]>

  uploadOriginal(path: string, data: Uint8Array, mimeType: string): Promise<void>
  signedUrl(path: string, expiresInSeconds: number): Promise<string>

  logEvent(event: NewActivityEvent): Promise<void>
  listEvents(requestId: string): Promise<ActivityEvent[]>
}

export class SupabaseSecurityReviewStore implements SecurityReviewStore {
  constructor(private readonly db: SupabaseClient) {}

  async getSupplierIdForUser(userId: string): Promise<string | null> {
    const { data } = await this.db.from('suppliers').select('id').eq('user_id', userId).single()
    return data?.id ?? null
  }

  async requestBelongsToSupplier(requestId: string, supplierId: string): Promise<boolean> {
    const { data } = await this.db
      .from('inbox_requests').select('id').eq('id', requestId).eq('supplier_id', supplierId).maybeSingle()
    return Boolean(data)
  }

  async findDocumentBySha(requestId: string, sha256: string): Promise<SecurityDocument | null> {
    const { data } = await this.db
      .from('security_documents').select('*').eq('request_id', requestId).eq('sha256', sha256).maybeSingle()
    return (data as SecurityDocument | null) ?? null
  }

  async insertDocument(doc: NewSecurityDocument): Promise<SecurityDocument> {
    const { data, error } = await this.db.from('security_documents').insert(doc).select('*').single()
    if (error || !data) throw new Error(`insert security_documents failed: ${error?.message}`)
    return data as SecurityDocument
  }

  async updateDocument(id: string, patch: Partial<SecurityDocument>): Promise<void> {
    const { error } = await this.db.from('security_documents').update(patch).eq('id', id)
    if (error) throw new Error(`update security_documents failed: ${error.message}`)
  }

  async listDocuments(requestId: string): Promise<SecurityDocument[]> {
    const { data, error } = await this.db
      .from('security_documents').select('*').eq('request_id', requestId).order('created_at')
    if (error) throw new Error(`list security_documents failed: ${error.message}`)
    return (data ?? []) as SecurityDocument[]
  }

  async getDocument(id: string, supplierId: string): Promise<SecurityDocument | null> {
    const { data } = await this.db
      .from('security_documents').select('*').eq('id', id).eq('supplier_id', supplierId).maybeSingle()
    return (data as SecurityDocument | null) ?? null
  }

  async insertUnits(supplierId: string, documentId: string, units: NewUnit[]): Promise<void> {
    if (units.length === 0) return
    const rows = units.map((u) => ({ ...u, supplier_id: supplierId, document_id: documentId }))
    const { error } = await this.db.from('document_units').insert(rows)
    if (error) throw new Error(`insert document_units failed: ${error.message}`)
  }

  async getUnit(documentId: string, unitIndex: number): Promise<DocumentUnitRow | null> {
    const { data } = await this.db
      .from('document_units').select('*').eq('document_id', documentId).eq('unit_index', unitIndex).maybeSingle()
    return (data as DocumentUnitRow | null) ?? null
  }

  async listUnits(documentId: string): Promise<DocumentUnitRow[]> {
    const { data, error } = await this.db
      .from('document_units').select('*').eq('document_id', documentId).order('unit_index')
    if (error) throw new Error(`list document_units failed: ${error.message}`)
    return (data ?? []) as DocumentUnitRow[]
  }

  async replaceFindings(supplierId: string, documentId: string, findings: NewFinding[]): Promise<void> {
    const del = await this.db.from('document_findings').delete().eq('document_id', documentId)
    if (del.error) throw new Error(`delete document_findings failed: ${del.error.message}`)
    if (findings.length === 0) return
    const rows = findings.map((f) => ({ ...f, supplier_id: supplierId, document_id: documentId }))
    const { error } = await this.db.from('document_findings').insert(rows)
    if (error) throw new Error(`insert document_findings failed: ${error.message}`)
  }

  async listFindings(documentIds: string[]): Promise<DocumentFinding[]> {
    if (documentIds.length === 0) return []
    const { data, error } = await this.db
      .from('document_findings').select('*').in('document_id', documentIds).order('created_at')
    if (error) throw new Error(`list document_findings failed: ${error.message}`)
    return (data ?? []) as DocumentFinding[]
  }

  async uploadOriginal(path: string, data: Uint8Array, mimeType: string): Promise<void> {
    const { error } = await this.db.storage
      .from(SECURITY_DOCS_BUCKET).upload(path, data, { contentType: mimeType, upsert: true })
    if (error) throw new Error(`storage upload failed: ${error.message}`)
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.db.storage
      .from(SECURITY_DOCS_BUCKET).createSignedUrl(path, expiresInSeconds)
    if (error || !data) throw new Error(`signed url failed: ${error?.message}`)
    return data.signedUrl
  }

  async logEvent(event: NewActivityEvent): Promise<void> {
    // The timeline must never break the main flow: log and continue on failure
    const { error } = await this.db.from('activity_events').insert({ payload: {}, ...event })
    if (error) console.error(`activity_events insert failed: ${error.message}`)
  }

  async listEvents(requestId: string): Promise<ActivityEvent[]> {
    const { data, error } = await this.db
      .from('activity_events').select('*').eq('request_id', requestId).order('created_at', { ascending: false })
    if (error) throw new Error(`list activity_events failed: ${error.message}`)
    return (data ?? []) as ActivityEvent[]
  }
}
