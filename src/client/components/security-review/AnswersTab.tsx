import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, Pencil, Play, X } from 'lucide-react'
import { ReviewBody, securityReviewApi } from '@/lib/securityReviewApi'
import type { ActivityEvent, EvidencePassage, FinalAnswer, QuestionnaireAnswerRow, QuestionnaireRun, Readiness } from '../../../types'
import type { EvidenceTarget } from './EvidenceDrawer'
import { ANSWER_LABEL, FINAL_ANSWER_LABEL, locatorLabel, READINESS_CLASS, READINESS_LABEL, REASON_LABEL, REVIEW_LABEL, shortName } from './labels'
import { namePassages, uniqueByLocation } from './text'

interface Props {
  requestId: string
  onOpenEvidence: (t: EvidenceTarget) => void
}

type Filter = 'all' | Readiness

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#0369A1] focus-visible:outline-none'
const btnPrimary = `${btn} bg-[#0369A1] text-white hover:bg-[#075985]`
const btnGhost = `${btn} border border-slate-300 bg-white text-[#0F172A] hover:bg-slate-50`

const toTarget = (p: EvidencePassage): EvidenceTarget | null => p.locator && p.document_id
  ? { documentId: p.document_id, filename: p.filename, locator: p.locator, quote: p.quote, verified: p.quote_verified }
  : null

function PassageChip({ p, onOpen }: { p: EvidencePassage; onOpen: Props['onOpenEvidence'] }) {
  const target = toTarget(p)
  return (
    <button
      disabled={!target}
      onClick={() => target && onOpen(target)}
      className="inline-flex max-w-full items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-[#0369A1] hover:bg-blue-50 transition-colors cursor-pointer disabled:cursor-default disabled:text-slate-400 focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none"
    >
      <span className="truncate">{shortName(p.filename)}</span>
      <span className="shrink-0">· {locatorLabel(p.locator)}</span>
    </button>
  )
}

const CHOICE_LABEL = { a: 'A (commitment)', b: 'B (evidence against)', custom: 'neither — own wording' } as const
type Choice = keyof typeof CHOICE_LABEL

function ConflictView({ answer, resolution, onOpen }: {
  answer: QuestionnaireAnswerRow; resolution: ActivityEvent | undefined; onOpen: Props['onOpenEvidence']
}) {
  const c = answer.conflict
  if (!c) return null
  const side = (label: string, p: EvidencePassage | null) => (
    <div className="rounded-lg border border-red-200 bg-white p-3 min-w-0">
      <p className="text-xs font-semibold text-red-700 mb-1">{label}</p>
      {p ? (
        <>
          <blockquote className="text-sm text-slate-700 border-l-2 border-red-200 pl-2 break-words">“{p.quote}”</blockquote>
          <div className="mt-2"><PassageChip p={p} onOpen={onOpen} /></div>
        </>
      ) : <p className="text-sm text-slate-500">The model did not name a valid passage.</p>}
    </div>
  )
  const body = (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {side('A — stated commitment', c.a)}
        {side('B — evidence against it', c.b)}
      </div>
      <p className="text-sm text-red-900">{namePassages(c.explanation, answer.evidence)}</p>
    </>
  )
  // Once a person has decided, keep the disagreement on record but out of the way
  if (answer.review_status !== 'pending') {
    const choice = resolution?.payload.choice as Choice | undefined
    const note = resolution?.payload.note as string | undefined
    return (
      <details data-testid="conflict-resolved" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <summary className="cursor-pointer text-slate-700">
          {answer.review_status === 'rejected' ? 'Conflict: answer rejected' : `Conflict resolved${choice ? `: chose ${CHOICE_LABEL[choice]}` : ''}`}
          {note && <span className="text-slate-500"> · “{note}”</span>}
          <span className="text-slate-500"> · show the disagreement</span>
        </summary>
        <div className="mt-2 space-y-2">{body}</div>
      </details>
    )
  }
  return (
    <div data-testid="conflict-view" className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-red-800">
        <AlertTriangle className="w-4 h-4" /> Your documents disagree
      </p>
      {body}
    </div>
  )
}

// The Response cell the buyer sees; starts at the AI's label, and must be chosen when the AI had none
function ResponsePicker({ name, value, onChange }: { name: string; value: FinalAnswer | null; onChange: (v: FinalAnswer) => void }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold text-slate-600 mb-1">Response</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="response-picker">
        {(Object.keys(FINAL_ANSWER_LABEL) as FinalAnswer[]).map((v) => (
          <label key={v} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} className="cursor-pointer accent-[#0369A1]" />
            {FINAL_ANSWER_LABEL[v]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function ReviewControls({ answer, onReview, pending }: {
  answer: QuestionnaireAnswerRow; onReview: (b: ReviewBody) => void; pending: boolean
}) {
  const isConflict = answer.readiness === 'conflict'
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(answer.final_text ?? answer.response_text ?? '')
  const [choice, setChoice] = useState<Choice>('b')
  const [note, setNote] = useState('')
  const aiLabel = answer.answer === 'not_addressed' ? null : answer.answer
  const [response, setResponse] = useState<FinalAnswer | null>(answer.final_answer ?? aiLabel)
  const responseBody = response ? { final_answer: response } : {}

  if (isConflict && answer.review_status === 'pending') {
    return (
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <fieldset>
          <legend className="text-xs font-semibold text-slate-600 mb-1">Which is right?</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {(['a', 'b', 'custom'] as const).map((c) => (
              <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name={`choice-${answer.id}`} checked={choice === c} onChange={() => setChoice(c)} className="cursor-pointer accent-[#0369A1]" />
                {c === 'custom' ? 'Neither — my own wording' : CHOICE_LABEL[c]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-xs font-semibold text-slate-600">
          Answer to send
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-[#0F172A] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-200" />
        </label>
        <label className="block text-xs font-semibold text-slate-600">
          Note for the record (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-[#0F172A] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-200" />
        </label>
        <ResponsePicker name={`response-${answer.id}`} value={response} onChange={setResponse} />
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={pending || !text.trim() || !response} onClick={() => onReview({ action: 'resolve', choice, final_text: text, note: note || undefined, ...responseBody })}>
            <Check className="w-4 h-4" /> Resolve conflict
          </button>
          <button className={btnGhost} disabled={pending} onClick={() => onReview({ action: 'reject' })}><X className="w-4 h-4" /> Reject</button>
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-slate-600">
          Edit answer
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-[#0F172A] focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-200" />
        </label>
        <ResponsePicker name={`response-${answer.id}`} value={response} onChange={setResponse} />
        <div className="flex flex-wrap gap-2">
          <button className={btnPrimary} disabled={pending || !text.trim() || !response} onClick={() => { onReview({ action: 'edit', final_text: text, ...responseBody }); setEditing(false) }}>
            <Check className="w-4 h-4" /> Save and approve
          </button>
          <button className={btnGhost} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!isConflict && answer.review_status !== 'approved' && answer.response_text && (answer.final_answer || aiLabel) && (
        <button className={btnPrimary} disabled={pending} onClick={() => onReview({ action: 'approve' })}><Check className="w-4 h-4" /> Approve</button>
      )}
      {!isConflict && <button className={btnGhost} disabled={pending} onClick={() => setEditing(true)}><Pencil className="w-4 h-4" /> Edit</button>}
      {answer.review_status !== 'rejected' && (
        <button className={btnGhost} disabled={pending} onClick={() => onReview({ action: 'reject' })}><X className="w-4 h-4" /> Reject</button>
      )}
    </div>
  )
}

function AnswerCard({ answer, resolution, onOpen, onReview, pending }: {
  answer: QuestionnaireAnswerRow; resolution: ActivityEvent | undefined; onOpen: Props['onOpenEvidence']
  onReview: (b: ReviewBody) => void; pending: boolean
}) {
  const cited = uniqueByLocation(answer.evidence.filter((e) => e.cited))
  const other = answer.evidence.filter((e) => !e.cited)
  const text = answer.final_text ?? answer.response_text
  const reasons = answer.reasons.filter((r) => r !== 'CONFLICT')
  return (
    <li data-testid="answer-card" data-readiness={answer.readiness} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold text-[#0F172A]">{answer.question_ref}</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${READINESS_CLASS[answer.readiness]}`}>{READINESS_LABEL[answer.readiness]}</span>
        {(answer.final_answer || answer.answer) && (
          <span data-testid="answer-label" className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
            {answer.final_answer ? FINAL_ANSWER_LABEL[answer.final_answer] : ANSWER_LABEL[answer.answer!]}
          </span>
        )}
        <span data-testid="review-status" className={`ml-auto text-xs font-semibold ${answer.review_status === 'rejected' ? 'text-red-700' : answer.review_status === 'pending' ? 'text-slate-500' : 'text-emerald-700'}`}>
          {REVIEW_LABEL[answer.review_status]}
        </span>
      </div>
      <p className="text-sm font-medium text-[#0F172A]">{answer.question_text}</p>

      {answer.readiness === 'conflict' && <ConflictView answer={answer} resolution={resolution} onOpen={onOpen} />}

      {text
        ? <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{text}</p>
        : <p className="text-sm text-slate-500">No answer drafted: {answer.errors.length ? 'an AI step failed.' : 'nothing in the documents addresses this.'}</p>}

      {reasons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Why this needs review">
          {reasons.map((r) => (
            <li key={r} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">{REASON_LABEL[r]}</li>
          ))}
        </ul>
      )}
      {answer.unsupported_numbers.length > 0 && (
        <p className="text-xs text-amber-900">Numbers not found in the cited pages: {answer.unsupported_numbers.join(', ')}</p>
      )}
      {answer.verifier && answer.verifier.verdict !== 'supported' && (
        <p className="text-xs text-slate-600"><span className="font-semibold">Second check:</span> {answer.verifier.reason}</p>
      )}

      {cited.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">Cites</span>
          {cited.map((p, i) => <PassageChip key={i} p={p} onOpen={onOpen} />)}
        </div>
      )}
      {other.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Other evidence found ({other.length})</summary>
          <ul className="mt-2 space-y-2">
            {other.map((p, i) => (
              <li key={i} className="space-y-1">
                <p className="text-slate-600 break-words">
                  <span className="font-semibold">{p.stance}</span>: “{p.quote}”
                  {!p.quote_verified && <span className="text-amber-800"> · quote not verified</span>}
                </p>
                <PassageChip p={p} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <ReviewControls answer={answer} onReview={onReview} pending={pending} />
    </li>
  )
}

export default function AnswersTab({ requestId, onOpenEvidence }: Props) {
  const qc = useQueryClient()
  const abortRef = useRef<AbortController | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [live, setLive] = useState<{ total: number; answers: QuestionnaireAnswerRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runs = useQuery({ queryKey: ['sr-runs', requestId], queryFn: () => securityReviewApi.listRuns(requestId) })
  const latest: QuestionnaireRun | undefined = runs.data?.[0]
  const elsewhereRunning = latest?.status === 'running' && !live
  const run = useQuery({
    queryKey: ['sr-run', latest?.id],
    queryFn: () => securityReviewApi.getRun(latest!.id),
    enabled: Boolean(latest) && !live,
    refetchInterval: elsewhereRunning ? 3000 : false,
  })
  useEffect(() => {
    if (elsewhereRunning && run.data?.run.status !== 'running') qc.invalidateQueries({ queryKey: ['sr-runs', requestId] })
  }, [elsewhereRunning, run.data, qc, requestId])
  useEffect(() => () => abortRef.current?.abort(), [])

  const start = async () => {
    setError(null)
    abortRef.current = new AbortController()
    setLive({ total: 0, answers: [] })
    try {
      await securityReviewApi.streamRun(requestId, (e) => {
        if (e.type === 'run_started') setLive({ total: e.questions, answers: [] })
        if (e.type === 'answer') setLive((s) => s && { ...s, answers: [...s.answers, e.answer] })
        if (e.type === 'error') setError(e.message)
      }, abortRef.current.signal)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message)
    }
    await qc.invalidateQueries({ queryKey: ['sr-runs', requestId] })
    await qc.invalidateQueries({ queryKey: ['sr-docs', requestId] })
    await qc.invalidateQueries({ queryKey: ['sr-activity', requestId] })
    setLive(null)
  }

  const review = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewBody }) => securityReviewApi.review(id, body),
    onSuccess: (updated) => {
      qc.setQueryData<{ run: QuestionnaireRun; answers: QuestionnaireAnswerRow[] }>(['sr-run', updated.run_id], (old) =>
        old && { ...old, answers: old.answers.map((a) => (a.id === updated.id ? updated : a)) })
      qc.invalidateQueries({ queryKey: ['sr-activity', requestId] })
    },
    onError: (e: Error) => setError(e.message),
  })

  // The latest conflict_resolved event per answer, to show what the reviewer chose
  const activity = useQuery({ queryKey: ['sr-activity', requestId], queryFn: () => securityReviewApi.activity(requestId) })
  const resolutions = new Map<string, ActivityEvent>()
  for (const e of activity.data ?? []) {
    if (e.event_type !== 'conflict_resolved' || !e.entity_id) continue
    const seen = resolutions.get(e.entity_id)
    if (!seen || seen.created_at < e.created_at) resolutions.set(e.entity_id, e)
  }

  const answers = (live?.answers ?? run.data?.answers ?? []).slice().sort((a, b) => a.question_row - b.question_row)
  const count = (r: Readiness) => answers.filter((a) => a.readiness === r).length
  const shown = filter === 'all' ? answers : answers.filter((a) => a.readiness === filter)
  const running = Boolean(live) || elsewhereRunning

  const chips: { key: Filter; label: string; n: number; cls: string }[] = [
    { key: 'all', label: 'All', n: answers.length, cls: 'border-slate-300 text-[#0F172A]' },
    { key: 'ready', label: 'Ready', n: count('ready'), cls: READINESS_CLASS.ready },
    { key: 'needs_evidence', label: 'Needs evidence', n: count('needs_evidence'), cls: READINESS_CLASS.needs_evidence },
    { key: 'conflict', label: 'Conflict', n: count('conflict'), cls: READINESS_CLASS.conflict },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button className={btnPrimary} disabled={running} onClick={start}>
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Answering…' : latest ? 'Run again' : 'Answer questionnaire'}
        </button>
        {live && live.total > 0 && (
          <div className="flex-1 min-w-0" aria-live="polite">
            <p className="text-xs text-slate-600 mb-1">{live.answers.length} of {live.total} questions answered</p>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div className="h-full bg-[#0369A1] transition-all duration-300" style={{ width: `${(100 * live.answers.length) / live.total}%` }} />
            </div>
          </div>
        )}
        {live && live.total === 0 && <p className="text-xs text-slate-600">Preparing documents…</p>}
        {elsewhereRunning && <p className="text-xs text-slate-600">A run is in progress; answers appear as they finish.</p>}
        {!running && latest?.stats && (
          <p className="text-xs text-slate-500">
            Last run {new Date(latest.created_at).toLocaleString()} · {(latest.stats.duration_ms / 1000).toFixed(0)} s · {latest.model}
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {answers.length > 0 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter answers">
          {chips.map((c) => (
            <button
              key={c.key}
              role="tab"
              aria-selected={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none ${c.cls} ${filter === c.key ? 'ring-2 ring-offset-1 ring-[#0369A1]' : 'opacity-80 hover:opacity-100'} bg-white`}
            >
              {c.label} <span className="font-mono">{c.n}</span>
            </button>
          ))}
        </div>
      )}

      {!latest && !live && !runs.isLoading && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          Upload the questionnaire and evidence on the Documents tab, then answer the questionnaire here.
          Every answer cites your documents and is checked before it can be marked Ready.
        </div>
      )}

      <ul className="space-y-3">
        {shown.map((a) => (
          <AnswerCard key={a.id} answer={a} resolution={resolutions.get(a.id)} onOpen={onOpenEvidence} pending={review.isPending}
            onReview={(body) => review.mutate({ id: a.id, body })} />
        ))}
      </ul>
    </div>
  )
}
