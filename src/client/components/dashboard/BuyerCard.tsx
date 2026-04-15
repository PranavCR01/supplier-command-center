import { differenceInDays, parseISO, format } from 'date-fns'
import { cn } from '@/lib/utils'
import type { BuyerRelationship, BuyerStatus } from '../../../types'

interface Props {
  buyer: BuyerRelationship
  activeRequests: number
  complianceGaps: number
}

const statusConfig: Record<BuyerStatus, { label: string; class: string }> = {
  preferred:  { label: 'Preferred',  class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  approved:   { label: 'Approved',   class: 'bg-blue-50 text-blue-700 border-blue-200' },
  onboarding: { label: 'Onboarding', class: 'bg-amber-50 text-amber-700 border-amber-200' },
  inactive:   { label: 'Inactive',   class: 'bg-slate-100 text-slate-500 border-slate-200' },
}

export default function BuyerCard({ buyer, activeRequests, complianceGaps }: Props) {
  const { label: statusLabel, class: statusClass } = statusConfig[buyer.status] ?? statusConfig.approved

  const sinceYear = buyer.since_date
    ? format(parseISO(buyer.since_date), 'yyyy')
    : null

  const daysUntilAnniversary = buyer.since_date
    ? (() => {
        const since = parseISO(buyer.since_date)
        const thisYear = new Date(new Date().getFullYear(), since.getMonth(), since.getDate())
        const days = differenceInDays(thisYear, new Date())
        return days < 0
          ? differenceInDays(new Date(new Date().getFullYear() + 1, since.getMonth(), since.getDate()), new Date())
          : days
      })()
    : null
  void daysUntilAnniversary // used only for future enhancement

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow duration-150">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#0F172A] truncate">{buyer.buyer_name}</h3>
          {buyer.platform && (
            <p className="text-xs text-slate-400 mt-0.5">{buyer.platform}</p>
          )}
        </div>
        <span className={cn('inline-flex shrink-0 items-center px-2 py-0.5 rounded text-xs font-semibold border', statusClass)}>
          {statusLabel}
        </span>
      </div>

      {/* Stats grid */}
      <dl className="grid grid-cols-2 gap-3">
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <dt className="text-xs text-slate-400 mb-0.5">Annual Spend</dt>
          <dd className="text-sm font-semibold text-[#0F172A]">{buyer.annual_spend ?? '—'}</dd>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2.5">
          <dt className="text-xs text-slate-400 mb-0.5">Partner Since</dt>
          <dd className="text-sm font-semibold text-[#0F172A]">{sinceYear ?? '—'}</dd>
        </div>
        <div className={cn('rounded-lg px-3 py-2.5', activeRequests > 0 ? 'bg-blue-50' : 'bg-slate-50')}>
          <dt className="text-xs text-slate-400 mb-0.5">Active Requests</dt>
          <dd className={cn('text-sm font-semibold', activeRequests > 0 ? 'text-[#0369A1]' : 'text-[#0F172A]')}>
            {activeRequests}
          </dd>
        </div>
        <div className={cn('rounded-lg px-3 py-2.5', complianceGaps > 0 ? 'bg-red-50' : 'bg-slate-50')}>
          <dt className="text-xs text-slate-400 mb-0.5">Compliance Gaps</dt>
          <dd className={cn('text-sm font-semibold', complianceGaps > 0 ? 'text-red-600' : 'text-[#0F172A]')}>
            {complianceGaps === 0 ? 'None' : complianceGaps}
          </dd>
        </div>
      </dl>
    </div>
  )
}
