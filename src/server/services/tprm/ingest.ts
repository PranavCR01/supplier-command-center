import { createHash } from 'crypto'
import path from 'path'
import type { SecurityDocRole, SecurityDocument } from '../../../types/index.js'
import { DocumentUnit, parsePdf, parseQuestionnaire, parseXlsx } from './parsers.js'
import { SecurityReviewStore } from './store.js'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const PDF_MIME = 'application/pdf'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export class UploadRejected extends Error {
  constructor(message: string, readonly status: 400 | 413 | 415) {
    super(message)
  }
}

type FileKind = 'pdf' | 'xlsx'

// Trust the bytes, not the filename or Content-Type header
export function sniffKind(data: Uint8Array): FileKind | null {
  const head = Buffer.from(data.subarray(0, 5)).toString('latin1')
  if (head === '%PDF-') return 'pdf'
  if (head.startsWith('PK\x03\x04')) return 'xlsx'
  return null
}

export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return (base || 'document').slice(0, 120)
}

export interface IngestContext {
  store: SecurityReviewStore
  supplierId: string
  requestId: string
  userId: string | null
}

export interface IngestResult {
  document: SecurityDocument
  duplicate: boolean
  units: number
  lowTextUnits: number
  questions: number | null
}

export async function ingestDocument(
  ctx: IngestContext,
  file: { filename: string; data: Uint8Array; role?: SecurityDocRole },
): Promise<IngestResult> {
  const { store, supplierId, requestId, userId } = ctx

  if (file.data.byteLength === 0) throw new UploadRejected('File is empty', 400)
  if (file.data.byteLength > MAX_UPLOAD_BYTES) throw new UploadRejected('File is larger than 10 MB', 413)
  const kind = sniffKind(file.data)
  if (!kind) throw new UploadRejected('Only PDF and XLSX files are supported', 415)

  const filename = safeFilename(file.filename)
  const sha256 = createHash('sha256').update(file.data).digest('hex')

  const existing = await store.findDocumentBySha(requestId, sha256)
  if (existing) {
    return { document: existing, duplicate: true, units: existing.unit_count ?? 0, lowTextUnits: 0, questions: null }
  }

  // A spreadsheet with a "Question" column is the questionnaire unless the caller says otherwise
  let questions: number | null = null
  let role: SecurityDocRole = file.role ?? 'evidence'
  if (kind === 'xlsx' && file.role !== 'evidence') {
    try {
      questions = (await parseQuestionnaire(file.data)).length
      role = 'questionnaire'
    } catch {
      if (file.role === 'questionnaire') throw new UploadRejected('No "Question" column found in the spreadsheet', 400)
    }
  }

  const document = await store.insertDocument({
    supplier_id: supplierId,
    request_id: requestId,
    filename,
    mime_type: kind === 'pdf' ? PDF_MIME : XLSX_MIME,
    sha256,
    role,
    doc_type: role === 'questionnaire' ? 'questionnaire' : null,
    doc_type_source: null,
  })

  await store.logEvent({
    supplier_id: supplierId, request_id: requestId, actor: 'user', actor_id: userId,
    event_type: 'document_uploaded', entity_type: 'security_document', entity_id: document.id,
    payload: { filename, bytes: file.data.byteLength, role },
  })

  // The original is only needed for "open original"; parsed text still works without it
  const storagePath = `${supplierId}/${requestId}/${document.id}/${filename}`
  try {
    await store.uploadOriginal(storagePath, file.data, document.mime_type)
    document.storage_path = storagePath
  } catch (err) {
    await store.logEvent({
      supplier_id: supplierId, request_id: requestId, actor: 'system',
      event_type: 'document_storage_failed', entity_type: 'security_document', entity_id: document.id,
      payload: { error: err instanceof Error ? err.message : String(err) },
    })
  }

  let units: DocumentUnit[] = []
  try {
    units = kind === 'pdf' ? await parsePdf(file.data) : await parseXlsx(file.data)
    await store.insertUnits(supplierId, document.id, units.map(({ unitIndex, locator, text }) => ({
      unit_index: unitIndex, locator, text,
    })))
    Object.assign(document, { parse_status: 'parsed', unit_count: units.length, parse_error: null })
  } catch (err) {
    Object.assign(document, {
      parse_status: 'failed',
      parse_error: err instanceof Error ? err.message : String(err),
    })
  }

  await store.updateDocument(document.id, {
    storage_path: document.storage_path,
    parse_status: document.parse_status,
    unit_count: document.unit_count,
    parse_error: document.parse_error,
  })

  const lowTextUnits = units.filter((u) => u.lowText).length
  await store.logEvent({
    supplier_id: supplierId, request_id: requestId, actor: 'system',
    event_type: document.parse_status === 'parsed' ? 'document_parsed' : 'document_parse_failed',
    entity_type: 'security_document', entity_id: document.id,
    payload: document.parse_status === 'parsed'
      ? { units: units.length, low_text_units: lowTextUnits, questions }
      : { error: document.parse_error },
  })

  return { document, duplicate: false, units: units.length, lowTextUnits, questions }
}
