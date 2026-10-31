import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, Loader2, Wrench } from 'lucide-react'
import { RemediationRow, securityReviewApi } from '@/lib/securityReviewApi'
import type { RemediationSeverity, RemediationStatus } from '../../../types'
import { STATUS_LABEL } from './labels'

const SEVERITY_CLASS: Record<RemediationSeverity, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-amber-50 text-amber-800 border-amber-200',
  medium: 'bg-slate-50 text-slate-700 border-slate-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
}
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#0369A1] focus-visible:outline-none'

function ItemCard({ item, onUpdate, busy }: {
  item: RemediationRow; onUpdate: (p: { status?: RemediationStatus; external_key?: string | null }) => void; busy: boolean
}) {
  const [key, setKey] = useState(item.external_key ?? '')
  return (
    <li data-testid="remediation-item" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${SEVERITY_CLASS[item.severity]}`}>{item.severity}</span>
        {item.overdue && <span className="rounded-full border border-red-300 bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Overdue</span>}
        <span className="text-xs text-slate-500">{item.due_date ? `Due ${item.due_date}` : 'No due date'}</span>
      </div>
      <p className="text-sm font-semibold text-[#0F172A] break-words">{item.title}</p>
      {item.description && <p className="text-xs text-slate-600 whitespace-pre-wrap break-words leading-relaxed">{item.description}</p>}
      <div className="flex flex-col sm:flex-row sm:items-end gap-2 pt-1">
        <label className="text-xs font-semibold text-slate-600">
          Status
          <select
            value={item.status}
            disabled={busy}
            onChange={(e) => onUpdate({ status: e.target.value as RemediationStatus })}
            className="mt-1 block w-full sm:w-40 rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-[#0F172A] cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none"
          >
            {(Object.keys(STATUS_LABEL) as RemediationStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 flex-1">
          Jira key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => key !== (item.external_key ?? '') && onUpdate({ external_key: key.trim() || null })}
            placeholder="e.g. SEC-42"
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-[#0F172A] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </label>
        <p className="text-xs text-slate-500 sm:pb-2">Owner: {item.owner_name ?? 'unassigned'}</p>
      </div>
    </li>
  )
}

export default function RemediationTab({ requestId }: { requestId: string }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['sr-remediation', requestId], queryFn: () => securityReviewApi.remediation(requestId) })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sr-remediation', requestId] })
    qc.invalidateQueries({ queryKey: ['sr-activity', requestId] })
  }
  const generate = useMutation({
    mutationFn: () => securityReviewApi.generateRemediation(requestId),
    onSuccess: (r) => {
      setNote(`${r.result.created} item${r.result.created === 1 ? '' : 's'} created${r.result.kept ? `, ${r.result.kept} kept` : ''}. ` +
        (r.result.sla.basis === 'policy' ? 'Due dates use your policy SLA.' : 'No SLA found in your policy; default SLA used.'))
      refresh()
    },
    onError: (e: Error) => setError(e.message),
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { status?: RemediationStatus; external_key?: string | null } }) =>
      securityReviewApi.updateRemediation(id, patch),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  })
  const items = data?.items ?? []
  const download = async (format: 'csv' | 'json') => {
    setError(null)
    // The Jira CSV leaves out items that already have a Jira key, so a re-import makes no duplicates
    const inJira = format === 'csv' ? items.filter((i) => i.external_key) : []
    if (format === 'csv' && inJira.length === items.length) {
      setNote('Nothing to export: every item already has a Jira key.')
      return
    }
    try {
      await securityReviewApi.downloadRemediation(requestId, format)
      if (format === 'csv') {
        setNote(`${items.length - inJira.length} exported to the Jira CSV` +
          (inJira.length ? `; ${inJira.length} already in Jira (${inJira.map((i) => i.external_key).join(', ')}) skipped.` : '.'))
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const overdue = items.filter((i) => i.overdue).length
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Generated by rule from your findings: open Critical and High pen test findings, and every SOC 2 exception.
        Due dates come from your own remediation SLA.
      </p>
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <button className={`${btn} bg-[#0369A1] text-white hover:bg-[#075985]`} disabled={generate.isPending} onClick={() => { setError(null); generate.mutate() }}>
          {generate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          {items.length ? 'Regenerate from findings' : 'Generate from findings'}
        </button>
        {items.length > 0 && (
          <>
            <button className={`${btn} border border-slate-300 bg-white text-[#0F172A] hover:bg-slate-50`} onClick={() => download('csv')}>
              <Download className="w-4 h-4" /> Jira CSV
            </button>
            <button className={`${btn} border border-slate-300 bg-white text-[#0F172A] hover:bg-slate-50`} onClick={() => download('json')}>
              <Download className="w-4 h-4" /> JSON
            </button>
          </>
        )}
      </div>
      {note && <p role="status" className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{note}</p>}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}
      {items.length > 0 && (
        <p className="text-xs text-slate-500">{items.length} item{items.length === 1 ? '' : 's'}{overdue ? ` · ${overdue} overdue as of ${data?.as_of}` : ''}</p>
      )}
      {isLoading ? <p className="text-sm text-slate-500">Loading…</p> : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No remediation items yet. Analyze your documents first, then generate items from the findings.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((i) => <ItemCard key={i.id} item={i} busy={update.isPending} onUpdate={(patch) => update.mutate({ id: i.id, patch })} />)}
        </ul>
      )}
    </div>
  )
}
