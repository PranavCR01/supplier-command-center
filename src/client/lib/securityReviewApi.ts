import { supabase } from './supabase'
import type {
  ActivityEvent,
  DocumentFinding,
  Locator,
  QuestionnaireAnswerRow,
  QuestionnaireRun,
  RemediationItem,
  RemediationStatus,
  SecurityDocType,
  SecurityDocument,
} from '../../types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'
const BASE = `${API_BASE}/api/security-review`

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(await authHeaders()), ...init.headers } })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status)
  }
  return res.json() as Promise<T>
}

const json = (method: string, body: unknown): RequestInit =>
  ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export interface UnitView {
  document: { id: string; filename: string; unit_count: number | null; has_original: boolean }
  unit: { unit_index: number; locator: Locator; text: string; low_text: boolean }
}

export type RunEvent =
  | { type: 'run_started'; run_id: string; questions: number }
  | { type: 'analysis'; document_id: string; filename: string; status: string }
  | { type: 'answer'; answer: QuestionnaireAnswerRow; done: number; total: number }
  | { type: 'done'; run: QuestionnaireRun }
  | { type: 'error'; message: string }

export type ReviewBody =
  | { action: 'approve' }
  | { action: 'edit'; final_text: string }
  | { action: 'resolve'; choice: 'a' | 'b' | 'custom'; final_text: string; note?: string }
  | { action: 'reject'; note?: string }

export type RemediationRow = RemediationItem & { overdue: boolean }

export const securityReviewApi = {
  listDocuments: (requestId: string) =>
    call<{ documents: SecurityDocument[] }>(`/requests/${requestId}/documents`).then((r) => r.documents),

  uploadDocument: async (requestId: string, file: File) =>
    call<{ document: SecurityDocument; duplicate: boolean }>(
      `/requests/${requestId}/documents?filename=${encodeURIComponent(file.name)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await file.arrayBuffer() },
    ),

  loadSamples: (requestId: string) =>
    call<{ results: unknown[] }>(`/requests/${requestId}/documents/samples`, { method: 'POST' }),

  analyze: (requestId: string) =>
    call<{ results: { filename: string; status: string; error: string | null }[] }>(`/requests/${requestId}/analyze`, { method: 'POST' }),

  setDocType: (documentId: string, docType: SecurityDocType) =>
    call<{ document: SecurityDocument }>(`/documents/${documentId}`, json('PATCH', { doc_type: docType })),

  findings: (requestId: string) =>
    call<{ findings: DocumentFinding[] }>(`/requests/${requestId}/findings`).then((r) => r.findings),

  unit: (documentId: string, locator: Locator) => {
    const q = 'page' in locator
      ? `page=${locator.page}`
      : `sheet=${encodeURIComponent(locator.sheet)}&row=${locator.row_start}`
    return call<UnitView>(`/documents/${documentId}/unit?${q}`)
  },

  originalUrl: (documentId: string) =>
    call<{ url: string }>(`/documents/${documentId}/original`).then((r) => r.url),

  listRuns: (requestId: string) =>
    call<{ runs: QuestionnaireRun[] }>(`/requests/${requestId}/runs`).then((r) => r.runs),

  getRun: (runId: string) =>
    call<{ run: QuestionnaireRun; answers: QuestionnaireAnswerRow[] }>(`/runs/${runId}`),

  review: (answerId: string, body: ReviewBody) =>
    call<{ answer: QuestionnaireAnswerRow }>(`/answers/${answerId}`, json('PATCH', body)).then((r) => r.answer),

  remediation: (requestId: string) =>
    call<{ as_of: string; items: RemediationRow[] }>(`/requests/${requestId}/remediation`),

  generateRemediation: (requestId: string) =>
    call<{ result: { created: number; kept: number; sla: { basis: 'policy' | 'default' } }; items: RemediationRow[] }>(
      `/requests/${requestId}/remediation/generate`, { method: 'POST' }),

  updateRemediation: (id: string, patch: { status?: RemediationStatus; external_key?: string | null }) =>
    call<{ item: RemediationRow }>(`/remediation/${id}`, json('PATCH', patch)).then((r) => r.item),

  // Downloads need the auth header, so fetch the file and save it from a blob URL
  downloadRemediation: async (requestId: string, format: 'csv' | 'json') => {
    const res = await fetch(`${BASE}/requests/${requestId}/remediation/export?format=${format}`, { headers: await authHeaders() })
    if (!res.ok) throw new ApiError(`Export failed (${res.status})`, res.status)
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `remediation.${format}`
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  },

  activity: (requestId: string) =>
    call<{ events: ActivityEvent[] }>(`/requests/${requestId}/activity`).then((r) => r.events),

  // POST /runs streams SSE over fetch (EventSource can't send the Authorization header)
  streamRun: async (requestId: string, onEvent: (e: RunEvent) => void, signal?: AbortSignal): Promise<void> => {
    const res = await fetch(`${BASE}/requests/${requestId}/runs`, { method: 'POST', headers: await authHeaders(), signal })
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new ApiError(body.error ?? `Run failed to start (${res.status})`, res.status)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const messages = buffer.split('\n\n')
      buffer = messages.pop() ?? ''
      for (const msg of messages) {
        const line = msg.trim()
        if (!line.startsWith('data: ')) continue
        try {
          onEvent(JSON.parse(line.slice(6)) as RunEvent)
        } catch {
          // ignore a malformed event rather than abort the whole stream
        }
      }
    }
  },
}
