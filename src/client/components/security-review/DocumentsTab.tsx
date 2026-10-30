import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Loader2, Sparkles, Upload } from 'lucide-react'
import { securityReviewApi } from '@/lib/securityReviewApi'
import type { SecurityDocType, SecurityDocument, SummaryItem } from '../../../types'
import type { EvidenceTarget } from './EvidenceDrawer'
import { DOC_TYPE_LABEL, locatorLabel, SETTABLE_DOC_TYPES } from './labels'

interface Props {
  requestId: string
  onOpenEvidence: (t: EvidenceTarget) => void
}

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0369A1] focus-visible:outline-none'
const btnSecondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-[#0F172A] transition-colors duration-200 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0369A1] focus-visible:outline-none'

function SummaryList({ title, items, tone, doc, onOpenEvidence }: {
  title: string; items: SummaryItem[]; tone: 'neutral' | 'warn'; doc: SecurityDocument; onOpenEvidence: Props['onOpenEvidence']
}) {
  if (items.length === 0) return null
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${tone === 'warn' ? 'text-red-700' : 'text-slate-500'}`}>{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-slate-700 leading-snug">
            <span>{item.text}</span>{' '}
            {item.locator && (
              <button
                onClick={() => onOpenEvidence({ documentId: doc.id, filename: doc.filename, locator: item.locator!, quote: item.quote, verified: item.quote_verified })}
                className="inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-[#0369A1] hover:bg-blue-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none"
              >
                {locatorLabel(item.locator)}
              </button>
            )}
            {!item.quote_verified && (
              <span className="ml-1 text-xs text-amber-800">· quote not verified</span>
            )}
            {item.unsupported_numbers.length > 0 && (
              <span className="ml-1 text-xs text-amber-800">· {item.unsupported_numbers.join(', ')} not on cited page</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DocumentCard({ doc, onOpenEvidence, onSetType }: {
  doc: SecurityDocument; onOpenEvidence: Props['onOpenEvidence']; onSetType: (t: SecurityDocType) => void
}) {
  const Icon = doc.mime_type === 'application/pdf' ? FileText : FileSpreadsheet
  const s = doc.summary
  return (
    <li data-testid="document-card" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-[#0F172A] text-sm min-w-0">
          <Icon className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="truncate">{doc.filename}</span>
        </p>
        <div className="flex items-center gap-2 text-xs">
          {doc.role === 'questionnaire' ? (
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-medium text-[#0369A1]">Questionnaire</span>
          ) : (
            <label className="flex items-center gap-1 text-slate-500">
              <span className="sr-only">Document type</span>
              <select
                value={doc.doc_type ?? ''}
                onChange={(e) => onSetType(e.target.value as SecurityDocType)}
                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-[#0F172A] cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none"
              >
                {!doc.doc_type && <option value="">Type not set</option>}
                {SETTABLE_DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
              </select>
              {doc.doc_type_source === 'user' && <span>(set by you)</span>}
            </label>
          )}
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-500">
        {doc.parse_status === 'parsed' ? `${doc.unit_count} ${doc.mime_type === 'application/pdf' ? 'pages' : 'row ranges'}` : doc.parse_status === 'failed' ? 'Could not be read' : 'Parsing…'}
        {doc.role === 'evidence' && doc.analysis_status === 'running' && ' · analyzing…'}
        {doc.role === 'evidence' && doc.analysis_status === 'failed' && ' · analysis failed'}
      </p>
      {doc.parse_status === 'failed' && <p className="mt-2 text-xs text-red-700">{doc.parse_error}</p>}

      {s && (
        <div data-testid="summary-card" className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-[#0F172A]">{s.headline}</p>
          <SummaryList title="Exceptions and open issues" items={s.key_exceptions} tone="warn" doc={doc} onOpenEvidence={onOpenEvidence} />
          <SummaryList title="Key findings" items={s.top_findings} tone="neutral" doc={doc} onOpenEvidence={onOpenEvidence} />
          <SummaryList title="Act on or disclose" items={s.takeaways} tone="neutral" doc={doc} onOpenEvidence={onOpenEvidence} />
        </div>
      )}
    </li>
  )
}

export default function DocumentsTab({ requestId, onOpenEvidence }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['sr-docs', requestId],
    queryFn: () => securityReviewApi.listDocuments(requestId),
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['sr-docs', requestId] })
  const fail = (e: Error) => setMessage({ tone: 'error', text: e.message })

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await securityReviewApi.uploadDocument(requestId, f)
    },
    onSuccess: refresh, onError: fail,
  })
  const samples = useMutation({ mutationFn: () => securityReviewApi.loadSamples(requestId), onSuccess: refresh, onError: fail })
  const analyze = useMutation({
    mutationFn: () => securityReviewApi.analyze(requestId),
    onSuccess: (r) => {
      const failed = r.results.filter((x) => x.status === 'failed')
      setMessage(failed.length
        ? { tone: 'error', text: `Analysis failed for ${failed.map((f) => f.filename).join(', ')}. You can retry.` }
        : { tone: 'info', text: `Analyzed ${r.results.length} documents.` })
      refresh()
      qc.invalidateQueries({ queryKey: ['sr-activity', requestId] })
    },
    onError: fail,
  })
  const setType = useMutation({
    mutationFn: ({ id, t }: { id: string; t: SecurityDocType }) => securityReviewApi.setDocType(id, t),
    onSuccess: refresh, onError: fail,
  })

  const evidence = docs.filter((d) => d.role === 'evidence')
  const pending = evidence.filter((d) => d.parse_status === 'parsed' && d.analysis_status !== 'analyzed')
  const busy = upload.isPending || samples.isPending || analyze.isPending

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) upload.mutate(files)
            e.target.value = ''
          }}
        />
        <button className={btnSecondary} disabled={busy} onClick={() => fileRef.current?.click()}>
          {upload.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload PDF or XLSX
        </button>
        <button className={btnSecondary} disabled={busy} onClick={() => samples.mutate()}>
          {samples.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Use sample documents
        </button>
        {evidence.length > 0 && (
          <button className={btnPrimary} disabled={busy || pending.length === 0} onClick={() => { setMessage(null); analyze.mutate() }}>
            {analyze.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {analyze.isPending ? 'Analyzing… (about a minute)' : pending.length ? `Analyze ${pending.length} document${pending.length > 1 ? 's' : ''}` : 'All documents analyzed'}
          </button>
        )}
      </div>

      {message && (
        <p role="status" className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${message.tone === 'error' ? 'text-red-700 bg-red-50 border-red-200' : 'text-emerald-800 bg-emerald-50 border-emerald-200'}`}>
          {message.tone === 'error' ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
          {message.text}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading documents…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Upload the buyer's questionnaire and your evidence (SOC 2 report, pen test, policies, access reviews),
          or load the sample set to try it.
        </div>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => (
            <DocumentCard key={d.id} doc={d} onOpenEvidence={onOpenEvidence} onSetType={(t) => setType.mutate({ id: d.id, t })} />
          ))}
        </ul>
      )}
    </div>
  )
}
