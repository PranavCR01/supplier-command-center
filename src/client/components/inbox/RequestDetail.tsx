import { Link } from 'react-router-dom'
import { X, Paperclip, Mail, Globe, Calendar, User, ShieldCheck } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import TypeBadge from './TypeBadge'
import PriorityBadge from './PriorityBadge'
import DraftPanel from './DraftPanel'
import GapAnalysisCard from './GapAnalysisCard'
import ToneInsightCard from './ToneInsightCard'
import SurveyAutoComplete from './SurveyAutoComplete'
import type { InboxRequest } from '../../../types'

interface Props {
  request: InboxRequest
  onClose: () => void
}

export default function RequestDetail({ request, onClose }: Props) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-20 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside className="
        fixed inset-y-0 right-0 z-30 w-full max-w-lg bg-white shadow-xl flex flex-col
        lg:static lg:z-auto lg:shadow-none lg:border-l lg:border-slate-200
      ">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex flex-wrap gap-2 pt-0.5">
            <TypeBadge type={request.type} />
            <PriorityBadge priority={request.priority} />
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer shrink-0"
            aria-label="Close detail"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Subject */}
          <h2 className="text-base font-semibold text-[#0F172A] leading-snug">
            {request.subject ?? '(No subject)'}
          </h2>

          {/* Metadata grid */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            {request.from_buyer && (
              <>
                <dt className="flex items-center gap-1.5 text-slate-400 font-medium whitespace-nowrap">
                  <User className="w-3.5 h-3.5" /> From
                </dt>
                <dd className="text-[#0F172A]">
                  {request.from_buyer}
                  {request.from_contact && (
                    <span className="text-slate-500"> · {request.from_contact}</span>
                  )}
                </dd>
              </>
            )}

            {request.from_email && (
              <>
                <dt className="flex items-center gap-1.5 text-slate-400 font-medium whitespace-nowrap">
                  <Mail className="w-3.5 h-3.5" /> Email
                </dt>
                <dd>
                  <a
                    href={`mailto:${request.from_email}`}
                    className="text-[#0369A1] hover:underline cursor-pointer"
                  >
                    {request.from_email}
                  </a>
                </dd>
              </>
            )}

            {request.from_platform && (
              <>
                <dt className="flex items-center gap-1.5 text-slate-400 font-medium whitespace-nowrap">
                  <Globe className="w-3.5 h-3.5" /> Platform
                </dt>
                <dd className="text-slate-600">{request.from_platform}</dd>
              </>
            )}

            {request.deadline && (
              <>
                <dt className="flex items-center gap-1.5 text-slate-400 font-medium whitespace-nowrap">
                  <Calendar className="w-3.5 h-3.5" /> Deadline
                </dt>
                <dd className="text-slate-600">
                  {format(parseISO(request.deadline), 'MMMM d, yyyy')}
                </dd>
              </>
            )}

            <dt className="flex items-center gap-1.5 text-slate-400 font-medium whitespace-nowrap">
              <Calendar className="w-3.5 h-3.5" /> Received
            </dt>
            <dd className="text-slate-600">
              {format(parseISO(request.received_at), 'MMM d, yyyy · h:mm a')}
            </dd>
          </dl>

          {/* Security review — questionnaire answering with evidence (compliance and onboarding requests) */}
          {(request.type === 'compliance' || request.type === 'onboarding') && (
            <Link
              to={`/inbox/${request.id}/security-review`}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90 cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0369A1] focus-visible:outline-none"
            >
              <ShieldCheck className="w-4 h-4" /> Open security review
            </Link>
          )}

          {/* Tags */}
          {request.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {request.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500 border border-slate-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Attachments */}
          {request.attachments.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
                Attachments
              </p>
              <ul className="space-y-1">
                {request.attachments.map((file) => (
                  <li
                    key={file}
                    className="flex items-center gap-2 text-sm text-[#0369A1] bg-blue-50 rounded-lg px-3 py-2"
                  >
                    <Paperclip className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{file}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Body */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Message
            </p>
            <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 rounded-lg p-4 border border-slate-100">
              {request.body ?? '(No message body)'}
            </div>
          </div>

          {/* Tone insight — renders below message body once AI result arrives */}
          <ToneInsightCard request={request} />

          {/* Survey auto-complete — only for survey type */}
          <SurveyAutoComplete request={request} />

          {/* Gap analysis — only for rfp/rfq/onboarding, above draft panel */}
          <GapAnalysisCard request={request} />

          {/* AI Draft */}
          <DraftPanel requestId={request.id} subject={request.subject} />
        </div>
      </aside>
    </>
  )
}
