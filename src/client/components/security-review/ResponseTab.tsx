import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Download, FileSpreadsheet } from 'lucide-react'
import { ApiError, securityReviewApi } from '@/lib/securityReviewApi'
import { REASON_LABEL } from './labels'

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#0369A1] focus-visible:outline-none'
const WHY = { rejected: 'Rejected', needs_evidence: 'Needs evidence', conflict: 'Unresolved conflict' } as const

export default function ResponseTab({ requestId, onGoToAnswers }: { requestId: string; onGoToAnswers: () => void }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['sr-response', requestId],
    queryFn: () => securityReviewApi.response(requestId),
    retry: false,
    refetchOnMount: 'always',
  })
  const save = (format: 'xlsx' | 'md') => {
    setError(null)
    securityReviewApi.downloadResponse(requestId, format)
      .then(() => qc.invalidateQueries({ queryKey: ['sr-activity', requestId] }))
      .catch((e: Error) => setError(e.message))
  }

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>
  if (loadError instanceof ApiError && loadError.status === 404) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        Answer the questionnaire first. The response is built from answers that are Ready or that you approved.
      </div>
    )
  }
  if (!data) return <p className="text-sm text-red-700">Could not load the response.</p>

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <p data-testid="response-summary" className="text-sm text-[#0F172A]">
          <span className="font-semibold">{data.included.length} of {data.total}</span> answers go to the buyer.
          {data.withheld.length > 0 && <> <span className="font-semibold text-amber-800">{data.withheld.length} withheld</span> until you review them.</>}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Only answers you approved, or that passed every check and were not rejected, are included. Withheld rows stay blank in the questionnaire.
        </p>
        <div className="mt-3 flex flex-col sm:flex-row gap-2">
          <button className={`${btn} bg-[#0369A1] text-white hover:bg-[#075985]`} onClick={() => save('xlsx')}>
            <FileSpreadsheet className="w-4 h-4" /> Download completed questionnaire
          </button>
          <button className={`${btn} border border-slate-300 bg-white text-[#0F172A] hover:bg-slate-50`} onClick={() => save('md')}>
            <Download className="w-4 h-4" /> Markdown
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-sm text-red-700"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</p>
        )}
      </div>

      {data.withheld.length > 0 && (
        <section aria-labelledby="withheld-h" className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 id="withheld-h" className="text-sm font-semibold text-amber-900">Withheld</h2>
          <ul className="mt-2 space-y-1.5">
            {data.withheld.map((w) => (
              <li key={w.ref} data-testid="withheld-entry" className="text-sm text-amber-900">
                <span className="font-mono font-semibold">{w.ref}</span> · {WHY[w.why]}
                {w.why !== 'rejected' && w.reasons.filter((r) => r !== 'CONFLICT').length > 0 && (
                  <span className="text-xs"> — {w.reasons.filter((r) => r !== 'CONFLICT').map((r) => REASON_LABEL[r]).join('; ')}</span>
                )}
              </li>
            ))}
          </ul>
          <button onClick={onGoToAnswers} className="mt-2 text-sm font-semibold text-[#0369A1] hover:underline cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none rounded">
            Review them on the Answers tab
          </button>
        </section>
      )}

      <ol className="space-y-2" aria-label="Answers in the response">
        {data.included.map((e) => (
          <li key={e.ref} data-testid="response-entry" className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
            <p className="text-sm">
              <span className="font-mono text-xs font-semibold text-[#0F172A]">{e.ref}</span>{' '}
              <span className="font-semibold text-[#0F172A]">{e.response || 'See explanation'}</span>
              <span className="text-xs text-slate-500"> · {e.signed_off === 'human' ? 'approved by you' : 'passed all checks'}</span>
            </p>
            <p className="mt-1 text-sm text-slate-600">{e.question}</p>
            <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap">{e.explanation}</p>
            {e.evidence_reference && <p className="mt-1 text-xs text-slate-500 break-words">Evidence: {e.evidence_reference}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}
