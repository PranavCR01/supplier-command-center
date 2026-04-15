import { useEffect, useState } from 'react'
import { Inbox, ChevronDown, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import RequestCard from '@/components/inbox/RequestCard'
import RequestDetail from '@/components/inbox/RequestDetail'
import type { InboxRequest, RequestPriority, RequestType } from '../../../types'

const TYPE_OPTIONS: { value: RequestType | 'all'; label: string }[] = [
  { value: 'all',        label: 'All Types' },
  { value: 'rfp',        label: 'RFP' },
  { value: 'rfq',        label: 'RFQ' },
  { value: 'rfi',        label: 'RFI' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'survey',     label: 'Survey' },
]

const PRIORITY_OPTIONS: { value: RequestPriority | 'all'; label: string }[] = [
  { value: 'all',    label: 'All Priorities' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high',   label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
]

const PRIORITY_ORDER: RequestPriority[] = ['urgent', 'high', 'medium', 'low']

function prioritySort(a: InboxRequest, b: InboxRequest) {
  return PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
}

export default function InboxPage() {
  const [requests, setRequests] = useState<InboxRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<RequestType | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<RequestPriority | 'all'>('all')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: supplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('user_id', session.user.id)
        .single()

      if (!supplier) {
        setError('No supplier profile found.')
        setLoading(false)
        return
      }

      const { data, error: fetchError } = await supabase
        .from('inbox_requests')
        .select('*')
        .eq('supplier_id', supplier.id)
        .order('received_at', { ascending: false })

      if (fetchError) {
        setError('Could not load inbox.')
      } else {
        setRequests((data ?? []) as InboxRequest[])
      }
      setLoading(false)
    }
    load()
  }, [])

  // Counts by priority (across all requests, ignoring filters)
  const priorityCounts = PRIORITY_ORDER.reduce<Record<RequestPriority, number>>(
    (acc, p) => ({ ...acc, [p]: requests.filter((r) => r.priority === p).length }),
    { urgent: 0, high: 0, medium: 0, low: 0 }
  )

  const filtered = requests
    .filter((r) => typeFilter === 'all' || r.type === typeFilter)
    .filter((r) => priorityFilter === 'all' || r.priority === priorityFilter)
    .sort(prioritySort)

  const selected = requests.find((r) => r.id === selectedId) ?? null

  const filtersActive = typeFilter !== 'all' || priorityFilter !== 'all'

  const clearFilters = () => {
    setTypeFilter('all')
    setPriorityFilter('all')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <p className="text-sm text-slate-400">Loading inbox…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Left panel — list */}
      <div className={`flex flex-col flex-1 min-w-0 ${selected ? 'hidden lg:flex' : 'flex'}`}>
        {/* Page header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Inbox className="w-5 h-5 text-[#0369A1]" />
            <h1 className="text-lg font-semibold text-[#0F172A]">Smart Inbox</h1>
            <span className="ml-1 text-xs font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
              {requests.length}
            </span>
          </div>

          {/* Summary bar */}
          {requests.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {(
                [
                  { priority: 'urgent' as const, color: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' },
                  { priority: 'high'   as const, color: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
                  { priority: 'medium' as const, color: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200' },
                  { priority: 'low'    as const, color: 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100' },
                ] as const
              )
                .filter(({ priority }) => priorityCounts[priority] > 0)
                .map(({ priority, color }) => (
                  <button
                    key={priority}
                    onClick={() => setPriorityFilter(priorityFilter === priority ? 'all' : priority)}
                    className={`
                      text-xs font-semibold px-3 py-1 rounded-full border transition-colors duration-150 cursor-pointer
                      ${color}
                      ${priorityFilter === priority ? 'ring-2 ring-offset-1 ring-current' : ''}
                    `}
                  >
                    {priorityCounts[priority]} {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </button>
                ))}
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect
              value={typeFilter}
              onChange={(v) => setTypeFilter(v as RequestType | 'all')}
              options={TYPE_OPTIONS}
            />
            <FilterSelect
              value={priorityFilter}
              onChange={(v) => setPriorityFilter(v as RequestPriority | 'all')}
              options={PRIORITY_OPTIONS}
            />
            {filtersActive && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors cursor-pointer px-2 py-1.5"
              >
                <X className="w-3 h-3" /> Clear
              </button>
            )}
            <span className="ml-auto text-xs text-slate-400">
              {filtered.length} of {requests.length} requests
            </span>
          </div>
        </div>

        {/* Request list */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
              <Inbox className="w-8 h-8 text-slate-300 mb-3" />
              <p className="text-sm font-medium text-slate-500 mb-1">No requests match your filters</p>
              <p className="text-xs text-slate-400 mb-4">Try adjusting or clearing your filters.</p>
              <button
                onClick={clearFilters}
                className="text-xs font-semibold text-[#0369A1] hover:underline cursor-pointer transition-colors"
              >
                Clear filters
              </button>
            </div>
          ) : (
            filtered.map((req) => (
              <RequestCard
                key={req.id}
                request={req}
                isSelected={req.id === selectedId}
                onClick={() => setSelectedId(req.id === selectedId ? null : req.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      {selected && (
        <RequestDetail
          request={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

function FilterSelect({ value, onChange, options }: FilterSelectProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="
          appearance-none text-xs font-medium pl-3 pr-7 py-1.5
          bg-white border border-slate-200 rounded-lg text-slate-600
          hover:border-slate-300 focus:outline-none focus:border-[#0369A1]
          transition-colors duration-150 cursor-pointer
        "
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  )
}
