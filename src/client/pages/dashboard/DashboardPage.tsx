import { useEffect, useState } from 'react'
import { differenceInDays, parseISO } from 'date-fns'
import { BarChart3 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import BuyerCard from '@/components/dashboard/BuyerCard'
import type { BuyerRelationship, BuyerStatus, Certification, InboxRequest, RequestStatus } from '../../../types'

function computeStatus(expiryDate: string | null): 'active' | 'expiring_soon' | 'critical' | 'expired' {
  if (!expiryDate) return 'active'
  const days = differenceInDays(parseISO(expiryDate), new Date())
  if (days <= 0) return 'expired'
  if (days <= 30) return 'critical'
  if (days <= 90) return 'expiring_soon'
  return 'active'
}

const ACTIVE_STATUSES: RequestStatus[] = ['pending_response', 'in_progress', 'urgent_action']

interface DashboardData {
  buyers: BuyerRelationship[]
  requests: InboxRequest[]
  certs: Certification[]
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

      const [buyersRes, requestsRes, certsRes] = await Promise.all([
        supabase.from('buyer_relationships').select('*').eq('supplier_id', supplier.id),
        supabase.from('inbox_requests').select('*').eq('supplier_id', supplier.id),
        supabase.from('certifications').select('*').eq('supplier_id', supplier.id),
      ])

      if (buyersRes.error || certsRes.error || requestsRes.error) {
        const msg = buyersRes.error?.message ?? certsRes.error?.message ?? requestsRes.error?.message
        setError(`Could not load dashboard data: ${msg}`)
        setLoading(false)
        return
      }

      setData({
        buyers: (buyersRes.data ?? []) as BuyerRelationship[],
        requests: (requestsRes.data ?? []) as InboxRequest[],
        certs: (certsRes.data ?? []) as Certification[],
      })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center min-h-64">
      <p className="text-sm text-slate-400">Loading dashboard…</p>
    </div>
  )

  if (error || !data) return (
    <div className="flex items-center justify-center min-h-64">
      <p className="text-sm text-red-500">{error ?? 'Unknown error'}</p>
    </div>
  )

  const { buyers, requests, certs } = data

  // Stats
  const activeRequests = requests.filter((r) => (ACTIVE_STATUSES as string[]).includes(r.status))
  const activeCerts = certs.filter((c) => computeStatus(c.expiry_date) === 'active')
  const healthScore = certs.length > 0 ? Math.round((activeCerts.length / certs.length) * 100) : 100

  const healthColor =
    healthScore >= 80 ? 'text-emerald-600' :
    healthScore >= 60 ? 'text-amber-600' :
    'text-red-600'

  const healthBg =
    healthScore >= 80 ? 'bg-emerald-50 border-emerald-200' :
    healthScore >= 60 ? 'bg-amber-50 border-amber-200' :
    'bg-red-50 border-red-200'

  // Per-buyer metrics
  function activeRequestsFor(buyerName: string) {
    return activeRequests.filter((r) => r.from_buyer === buyerName).length
  }

  function complianceGapsFor(buyerName: string) {
    const name = buyerName.toLowerCase()
    return certs.filter(
      (c) =>
        c.required_by.some((r) => r.toLowerCase() === name) &&
        computeStatus(c.expiry_date) !== 'active'
    ).length
  }

  // Sort: preferred first, then approved, then onboarding, then inactive
  const STATUS_ORDER: BuyerStatus[] = ['preferred', 'approved', 'onboarding', 'inactive']
  const sortedBuyers = [...buyers].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  )

  return (
    <div className="px-6 py-6 max-w-5xl">
      {/* Page header */}
      <div className="flex items-center gap-2 mb-5">
        <BarChart3 className="w-5 h-5 text-[#0369A1]" />
        <h1 className="text-lg font-semibold text-[#0F172A]">Buyer Dashboard</h1>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-4 mb-7">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm text-center">
          <p className="text-2xl font-bold text-[#0F172A]">{buyers.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Total Buyers</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 shadow-sm text-center">
          <p className="text-2xl font-bold text-[#0369A1]">{activeRequests.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Active Requests</p>
        </div>
        <div className={`border rounded-xl px-5 py-4 shadow-sm text-center ${healthBg}`}>
          <p className={`text-2xl font-bold ${healthColor}`}>{healthScore}%</p>
          <p className="text-xs text-slate-400 mt-0.5">Compliance Health</p>
        </div>
      </div>

      {/* Buyer cards grid */}
      {sortedBuyers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BarChart3 className="w-8 h-8 text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-500">No buyer relationships found</p>
          <p className="text-xs text-slate-400 mt-1">Run the seed script to load test data.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedBuyers.map((buyer) => (
            <BuyerCard
              key={buyer.id}
              buyer={buyer}
              activeRequests={activeRequestsFor(buyer.buyer_name)}
              complianceGaps={complianceGapsFor(buyer.buyer_name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
