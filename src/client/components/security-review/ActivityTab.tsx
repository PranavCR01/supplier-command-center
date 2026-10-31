import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Cog, User } from 'lucide-react'
import { securityReviewApi } from '@/lib/securityReviewApi'
import type { ActivityEvent } from '../../../types'
import { EVENT_LABEL, STATUS_LABEL } from './labels'

const ACTOR_ICON = { user: User, ai: Bot, system: Cog } as const

// Long details (conflict explanations) show two lines until expanded
function Detail({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 160
  return (
    <>
      <p data-testid="activity-detail" className={`text-xs text-slate-500 break-words ${long && !open ? 'line-clamp-2' : ''}`}>{text}</p>
      {long && (
        <button onClick={() => setOpen(!open)} className="text-xs font-semibold text-[#0369A1] hover:underline cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none rounded">
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

function detail(e: ActivityEvent): string | null {
  const p = e.payload
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null)
  if (str('question_ref')) {
    const extra = str('note') ?? (e.event_type === 'answer_conflict_detected' ? str('explanation') : null)
    const chose = str('choice') && `chose ${str('choice') === 'custom' ? 'own wording' : str('choice')!.toUpperCase()}`
    const response = str('final_answer') && `response ${str('final_answer') === 'n/a' ? 'N/A' : str('final_answer')!.replace(/^./, (c) => c.toUpperCase())}`
    const parts = [chose, response].filter(Boolean).join(', ')
    return `${str('question_ref')}${str('ai_readiness') ? ` (AI said ${String(p.ai_readiness).replace('_', ' ')})` : ''}${parts ? ` · ${parts}` : ''}${extra ? ` — ${extra}` : ''}`
  }
  if (e.event_type === 'remediation_generated') {
    return `${p.created} created${p.kept ? `, ${p.kept} kept` : ''} · due dates from ${p.sla_basis === 'policy' ? 'your policy SLA' : 'the default SLA'}`
  }
  if (e.event_type === 'remediation_updated' && str('title')) {
    const changes = (p.changes ?? {}) as { status?: keyof typeof STATUS_LABEL; external_key?: string | null }
    const what = [
      changes.status && `status → ${STATUS_LABEL[changes.status] ?? changes.status}`,
      'external_key' in changes && (changes.external_key ? `Jira key → ${changes.external_key}` : 'Jira key removed'),
    ].filter(Boolean).join(' · ')
    return `${str('title')!.split(':')[0]}${what ? `: ${what}` : ''}`
  }
  if (str('filename')) return str('filename')
  if (str('doc_type')) return String(p.doc_type).replace('_', ' ')
  if (typeof p.included === 'number') return `${String(p.format).toUpperCase()} · ${p.included} answers included, ${p.withheld} withheld`
  if (typeof p.ready === 'number') return `${p.ready} ready · ${p.needs_evidence} need evidence · ${p.conflict} conflict`
  if (str('error')) return str('error')
  return null
}

export default function ActivityTab({ requestId }: { requestId: string }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['sr-activity', requestId],
    queryFn: () => securityReviewApi.activity(requestId),
  })
  if (isLoading) return <p className="text-sm text-slate-500">Loading activity…</p>
  if (events.length === 0) return <p className="text-sm text-slate-500">No activity yet.</p>
  return (
    <ol className="space-y-2" aria-label="Activity, newest first">
      {events.map((e) => {
        const Icon = ACTOR_ICON[e.actor]
        const d = detail(e)
        return (
          <li key={e.id} data-testid="activity-event" className="flex gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
            <Icon className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" aria-label={e.actor} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-[#0F172A]">{EVENT_LABEL[e.event_type] ?? e.event_type.replace(/_/g, ' ')}</p>
              {d && <Detail text={d} />}
            </div>
            <time className="text-xs text-slate-400 shrink-0" dateTime={e.created_at}>
              {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </time>
          </li>
        )
      })}
    </ol>
  )
}
