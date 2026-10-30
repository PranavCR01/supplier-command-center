import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ActivityTab from '@/components/security-review/ActivityTab'
import AnswersTab from '@/components/security-review/AnswersTab'
import DocumentsTab from '@/components/security-review/DocumentsTab'
import EvidenceDrawer, { EvidenceTarget } from '@/components/security-review/EvidenceDrawer'
import RemediationTab from '@/components/security-review/RemediationTab'
import ResponseTab from '@/components/security-review/ResponseTab'

const TABS = [
  { key: 'documents', label: 'Documents' },
  { key: 'answers', label: 'Answers' },
  { key: 'remediation', label: 'Remediation' },
  { key: 'response', label: 'Response' },
  { key: 'activity', label: 'Activity' },
] as const
type TabKey = typeof TABS[number]['key']

export default function SecurityReviewPage() {
  const { requestId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab: TabKey = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') as TabKey : 'documents'
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null)
  const closeEvidence = useCallback(() => setEvidence(null), [])
  // On narrow screens the tab row scrolls; keep the selected tab in view
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => { activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }, [tab])

  const { data: request } = useQuery({
    queryKey: ['inbox-request', requestId],
    queryFn: async () => {
      const { data } = await supabase.from('inbox_requests').select('id, subject, from_buyer, deadline').eq('id', requestId).single()
      return data as { id: string; subject: string | null; from_buyer: string | null; deadline: string | null } | null
    },
  })

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/inbox" className="inline-flex items-center gap-1 text-sm text-[#0369A1] hover:underline cursor-pointer">
        <ArrowLeft className="w-4 h-4" /> Inbox
      </Link>
      <header className="mt-3 mb-5">
        <h1 className="flex items-center gap-2 text-xl font-bold text-[#0F172A]">
          <ShieldCheck className="w-6 h-6 text-[#0369A1] shrink-0" /> Security review
        </h1>
        <p className="mt-1 text-sm text-slate-600 break-words">
          {request?.subject ?? 'Loading request…'}
          {request?.from_buyer && <span className="text-slate-500"> · {request.from_buyer}</span>}
        </p>
      </header>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Security review sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            ref={tab === t.key ? activeTab : undefined}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            className={`shrink-0 border-b-2 px-2.5 sm:px-3 py-2 text-sm font-semibold transition-colors duration-200 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none ${tab === t.key ? 'border-[#0369A1] text-[#0369A1]' : 'border-transparent text-slate-500 hover:text-[#0F172A]'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'documents' && <DocumentsTab requestId={requestId} onOpenEvidence={setEvidence} />}
      {tab === 'answers' && <AnswersTab requestId={requestId} onOpenEvidence={setEvidence} />}
      {tab === 'remediation' && <RemediationTab requestId={requestId} />}
      {tab === 'response' && <ResponseTab requestId={requestId} onGoToAnswers={() => setParams({ tab: 'answers' }, { replace: true })} />}
      {tab === 'activity' && <ActivityTab requestId={requestId} />}

      <EvidenceDrawer target={evidence} onClose={closeEvidence} />
    </div>
  )
}
