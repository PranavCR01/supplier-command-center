import { differenceInDays, parseISO, format } from 'date-fns'
import { ChevronDown, ChevronRight, ShieldCheck, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Certification } from '../../../types'

interface Props {
  cert: Certification
  expanded: boolean
  onToggle: () => void
}

type ComputedStatus = 'active' | 'expiring_soon' | 'critical' | 'expired'

function computeStatus(expiryDate: string | null): ComputedStatus {
  if (!expiryDate) return 'active'
  const days = differenceInDays(parseISO(expiryDate), new Date())
  if (days <= 0) return 'expired'
  if (days <= 30) return 'critical'
  if (days <= 90) return 'expiring_soon'
  return 'active'
}

function actionNote(status: ComputedStatus, expiryDate: string | null): string | null {
  if (!expiryDate) return null
  const days = differenceInDays(parseISO(expiryDate), new Date())
  if (status === 'expired') return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago — contact issuer to renew`
  if (status === 'critical') return `Expires in ${days} day${days === 1 ? '' : 's'} — contact issuer immediately`
  if (status === 'expiring_soon') return `Expires in ${days} days — schedule renewal`
  return null
}

const statusConfig: Record<ComputedStatus, { label: string; rowClass: string; badgeClass: string; icon: React.ElementType }> = {
  active:        { label: 'Active',        rowClass: '',                  badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: ShieldCheck },
  expiring_soon: { label: 'Expiring Soon', rowClass: 'bg-amber-50/30',   badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',       icon: AlertTriangle },
  critical:      { label: 'Critical',      rowClass: 'bg-red-50/40',     badgeClass: 'bg-red-50 text-red-700 border-red-200',             icon: AlertTriangle },
  expired:       { label: 'Expired',       rowClass: 'bg-red-50/20',     badgeClass: 'bg-red-100 text-red-800 border-red-300',            icon: XCircle },
}

export default function ComplianceRow({ cert, expanded, onToggle }: Props) {
  const status = computeStatus(cert.expiry_date)
  const { label, rowClass, badgeClass, icon: Icon } = statusConfig[status]
  const note = actionNote(status, cert.expiry_date)
  const hasDetail = note !== null || cert.required_by.length > 0

  return (
    <>
      <tr
        onClick={hasDetail ? onToggle : undefined}
        className={cn(
          'border-b border-slate-100 transition-colors duration-150',
          rowClass,
          hasDetail ? 'cursor-pointer hover:brightness-95' : ''
        )}
      >
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            {hasDetail ? (
              expanded
                ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="text-sm font-medium text-[#0F172A]">{cert.name}</span>
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-slate-500 hidden md:table-cell">{cert.issuer ?? '—'}</td>
        <td className="px-4 py-3 text-xs text-slate-400 font-mono hidden lg:table-cell">{cert.cert_number ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-slate-500">
          {cert.expiry_date ? format(parseISO(cert.expiry_date), 'MMM d, yyyy') : '—'}
        </td>
        <td className="px-4 py-3">
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border', badgeClass)}>
            <Icon className="w-3 h-3" />
            {label}
          </span>
        </td>
      </tr>

      {expanded && hasDetail && (
        <tr className={cn('border-b border-slate-100', rowClass)}>
          <td colSpan={5} className="px-5 pb-3 pt-0">
            <div className="pl-6 space-y-2">
              {note && (
                <p className="text-xs font-medium text-slate-600 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                  {note}
                </p>
              )}
              {cert.required_by.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-slate-400">Required by:</span>
                  {cert.required_by.map((buyer) => (
                    <span
                      key={buyer}
                      className="text-xs bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full"
                    >
                      {buyer}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
