import { ShieldCheck, AlertTriangle, XCircle } from 'lucide-react'
import { format, differenceInDays, parseISO } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Certification, CertCategory } from '../../../types'

interface Props {
  items: Certification[]
  category: CertCategory
  title: string
}

function computeStatus(expiryDate: string | null): 'active' | 'expiring_soon' | 'critical' | 'expired' {
  if (!expiryDate) return 'active'
  const days = differenceInDays(parseISO(expiryDate), new Date())
  if (days <= 0) return 'expired'
  if (days <= 30) return 'critical'
  if (days <= 90) return 'expiring_soon'
  return 'active'
}

const statusConfig = {
  active: { label: 'Active', class: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ShieldCheck },
  expiring_soon: { label: 'Expiring Soon', class: 'bg-amber-50 text-amber-700 border-amber-200', icon: AlertTriangle },
  critical: { label: 'Critical', class: 'bg-red-50 text-red-700 border-red-200', icon: AlertTriangle },
  expired: { label: 'Expired', class: 'bg-red-100 text-red-800 border-red-300', icon: XCircle },
}

export default function CertificationsCard({ items, category, title }: Props) {
  const filtered = items.filter((c) => c.category === category)

  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#0369A1]" />
          <CardTitle className="text-base font-semibold text-[#0F172A]">{title}</CardTitle>
          <span className="ml-auto text-xs text-slate-400 font-normal">{filtered.length} items</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 px-6 pb-4">No items added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Name</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide hidden md:table-cell">Issuer</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide hidden lg:table-cell">Cert #</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Expires</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((cert) => {
                  const status = computeStatus(cert.expiry_date)
                  const config = statusConfig[status]
                  const Icon = config.icon
                  const daysLeft = cert.expiry_date
                    ? differenceInDays(parseISO(cert.expiry_date), new Date())
                    : null

                  return (
                    <tr key={cert.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-3 font-medium text-[#0F172A]">{cert.name}</td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{cert.issuer ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs hidden lg:table-cell">{cert.cert_number ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {cert.expiry_date ? (
                          <span>
                            {format(parseISO(cert.expiry_date), 'MMM d, yyyy')}
                            {daysLeft !== null && daysLeft <= 90 && daysLeft > 0 && (
                              <span className={cn('ml-1.5 text-xs', daysLeft <= 30 ? 'text-red-500' : 'text-amber-500')}>
                                ({daysLeft}d)
                              </span>
                            )}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={cn('text-xs font-medium border', config.class)}>
                          <Icon className="w-3 h-3 mr-1" />
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
