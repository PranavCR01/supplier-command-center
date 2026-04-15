import { differenceInDays, parseISO, format } from 'date-fns'
import { Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import TypeBadge from './TypeBadge'
import PriorityBadge from './PriorityBadge'
import type { InboxRequest, RequestStatus } from '../../../types'

interface Props {
  request: InboxRequest
  isSelected: boolean
  onClick: () => void
}

const statusConfig: Record<RequestStatus, { label: string; class: string }> = {
  pending_response: { label: 'Pending Response', class: 'bg-blue-50 text-blue-600' },
  in_progress:      { label: 'In Progress',      class: 'bg-amber-50 text-amber-700' },
  submitted:        { label: 'Submitted',         class: 'bg-emerald-50 text-emerald-700' },
  urgent_action:    { label: 'Urgent Action',     class: 'bg-red-50 text-red-700' },
}

function DeadlineChip({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-slate-400 text-xs">No deadline</span>

  const days = differenceInDays(parseISO(deadline), new Date())
  const label = format(parseISO(deadline), 'MMM d')

  if (days < 0) {
    return <span className="text-xs font-semibold text-red-600">OVERDUE · {label}</span>
  }
  if (days === 0) {
    return <span className="text-xs font-semibold text-red-500">Due today</span>
  }
  if (days <= 3) {
    return <span className="text-xs font-semibold text-red-500">{days}d left · {label}</span>
  }
  if (days <= 14) {
    return <span className="text-xs font-semibold text-amber-600">{days}d left · {label}</span>
  }
  return <span className="text-xs text-slate-500">{days}d left · {label}</span>
}

export default function RequestCard({ request, isSelected, onClick }: Props) {
  const status = statusConfig[request.status] ?? statusConfig.pending_response

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-6 py-4 border-b border-slate-100 transition-colors duration-150 cursor-pointer',
        isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Badges column — fixed width so all rows align */}
        <div className="flex flex-col gap-1.5 pt-0.5 shrink-0 min-w-[100px]">
          <TypeBadge type={request.type} className="w-full justify-center" />
          <PriorityBadge priority={request.priority} className="w-full justify-center" />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-500 mb-0.5">
                {request.from_buyer ?? '—'}
                {request.from_contact && (
                  <span className="text-slate-400"> · {request.from_contact}</span>
                )}
              </p>
              <p className="text-sm font-semibold text-[#0F172A] truncate">
                {request.subject ?? '(No subject)'}
              </p>
            </div>
            <div className="text-right shrink-0">
              <DeadlineChip deadline={request.deadline} />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', status.class)}>
              {status.label}
            </span>
            {request.attachments.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <Paperclip className="w-3 h-3" />
                {request.attachments.length}
              </span>
            )}
            {request.tags.length > 0 && (
              <span className="text-xs text-slate-400 truncate hidden md:block">
                {request.tags.slice(0, 3).join(' · ')}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
