import { useEffect, useState } from 'react'
import { differenceInDays, parseISO } from 'date-fns'
import { ShieldCheck, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import ComplianceRow from '@/components/compliance/ComplianceRow'
import type { Certification, CertCategory } from '../../../types'

type ComputedStatus = 'active' | 'expiring_soon' | 'critical' | 'expired'

function computeStatus(expiryDate: string | null): ComputedStatus {
  if (!expiryDate) return 'active'
  const days = differenceInDays(parseISO(expiryDate), new Date())
  if (days <= 0) return 'expired'
  if (days <= 30) return 'critical'
  if (days <= 90) return 'expiring_soon'
  return 'active'
}

const GROUPS: { category: CertCategory; label: string }[] = [
  { category: 'certification', label: 'Certifications' },
  { category: 'insurance',     label: 'Insurance' },
  { category: 'diversity',     label: 'Diversity' },
]

export default function CompliancePage() {
  const [certs, setCerts] = useState<Certification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<ComputedStatus | 'all'>('all')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: supplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('user_id', session.user.id)
        .single()

      if (!supplier) { setError('No supplier profile found.'); setLoading(false); return }

      const { data, error: fetchError } = await supabase
        .from('certifications')
        .select('*')
        .eq('supplier_id', supplier.id)

      if (fetchError) setError('Could not load compliance data.')
      else setCerts((data ?? []) as Certification[])
      setLoading(false)
    }
    load()
  }, [])

  const toggle = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Summary counts (always from full list, ignoring filter)
  const counts: Record<ComputedStatus, number> = { active: 0, expiring_soon: 0, critical: 0, expired: 0 }
  for (const c of certs) counts[computeStatus(c.expiry_date)]++

  const summaryChips: { status: ComputedStatus; label: string; chipClass: string }[] = (
    [
      { status: 'critical'      as const, label: `${counts.critical} Critical`,            chipClass: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' },
      { status: 'expired'       as const, label: `${counts.expired} Expired`,              chipClass: 'bg-red-100 text-red-800 border-red-300 hover:bg-red-200' },
      { status: 'expiring_soon' as const, label: `${counts.expiring_soon} Expiring Soon`,  chipClass: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
      { status: 'active'        as const, label: `${counts.active} Active`,                chipClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
    ] as const
  ).filter(({ status }) => counts[status] > 0)

  const filtered = statusFilter === 'all'
    ? certs
    : certs.filter((c) => computeStatus(c.expiry_date) === statusFilter)

  if (loading) return (
    <div className="flex items-center justify-center min-h-64">
      <p className="text-sm text-slate-400">Loading compliance data…</p>
    </div>
  )

  if (error) return (
    <div className="flex items-center justify-center min-h-64">
      <p className="text-sm text-red-500">{error}</p>
    </div>
  )

  return (
    <div className="px-6 py-6 max-w-5xl">
      {/* Page header */}
      <div className="flex items-center gap-2 mb-5">
        <ShieldCheck className="w-5 h-5 text-[#0369A1]" />
        <h1 className="text-lg font-semibold text-[#0F172A]">Compliance Tracker</h1>
        <span className="text-xs font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full ml-1">
          {certs.length} items
        </span>
      </div>

      {/* Summary bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        {summaryChips.map(({ status, label, chipClass }) => (
          <button
            key={status}
            onClick={() => setStatusFilter(statusFilter === status ? 'all' : status)}
            className={`
              text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors duration-150 cursor-pointer
              ${chipClass}
              ${statusFilter === status ? 'ring-2 ring-offset-1 ring-current' : ''}
            `}
          >
            {label}
          </button>
        ))}
        {statusFilter !== 'all' && (
          <button
            onClick={() => setStatusFilter('all')}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer px-2"
          >
            <X className="w-3 h-3" /> Clear filter
          </button>
        )}
      </div>

      {/* Grouped tables */}
      <div className="space-y-6">
        {GROUPS.map(({ category, label }) => {
          const rows = filtered.filter((c) => c.category === category)
          if (rows.length === 0) return null

          return (
            <div key={category}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 px-1">
                {label}
              </h2>
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left px-5 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide">Name</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide hidden md:table-cell">Issuer</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide hidden lg:table-cell">Cert #</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide">Expires</th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-400 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((cert) => (
                      <ComplianceRow
                        key={cert.id}
                        cert={cert}
                        expanded={expandedIds.has(cert.id)}
                        onToggle={() => toggle(cert.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ShieldCheck className="w-8 h-8 text-slate-300 mb-3" />
            <p className="text-sm font-medium text-slate-500 mb-1">No items match this filter</p>
            <button
              onClick={() => setStatusFilter('all')}
              className="text-xs font-semibold text-[#0369A1] hover:underline cursor-pointer mt-1"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
