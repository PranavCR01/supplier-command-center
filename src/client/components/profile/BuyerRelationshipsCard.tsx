import { Users } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { BuyerRelationship } from '../../../types'

interface Props {
  buyers: BuyerRelationship[]
}

const statusConfig = {
  preferred: { label: 'Preferred', class: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  approved: { label: 'Approved', class: 'bg-blue-50 text-blue-700 border-blue-200' },
  onboarding: { label: 'Onboarding', class: 'bg-amber-50 text-amber-700 border-amber-200' },
  inactive: { label: 'Inactive', class: 'bg-slate-100 text-slate-500 border-slate-200' },
}

export default function BuyerRelationshipsCard({ buyers }: Props) {
  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-[#0369A1]" />
          <CardTitle className="text-base font-semibold text-[#0F172A]">Active Buyers</CardTitle>
          <span className="ml-auto text-xs text-slate-400 font-normal">{buyers.length} relationships</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {buyers.length === 0 ? (
          <p className="text-sm text-slate-400 px-6 pb-4">No buyer relationships added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Buyer</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide hidden md:table-cell">Platform</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide hidden lg:table-cell">Since</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide hidden lg:table-cell">Annual Spend</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((buyer) => {
                  const config = statusConfig[buyer.status]
                  return (
                    <tr key={buyer.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-3">
                        <div className="font-medium text-[#0F172A]">{buyer.buyer_name}</div>
                        {buyer.vendor_id && (
                          <div className="text-xs text-slate-400 font-mono mt-0.5">{buyer.vendor_id}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{buyer.platform ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">
                        {buyer.since_date ? format(parseISO(buyer.since_date), 'MMM yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3 font-medium text-[#0F172A] hidden lg:table-cell">
                        {buyer.annual_spend ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={cn('text-xs font-medium border', config.class)}>
                          {config.label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
