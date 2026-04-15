import { cn } from '@/lib/utils'
import type { RequestPriority } from '../../../types'

interface Props {
  priority: RequestPriority
  className?: string
}

const config: Record<RequestPriority, { label: string; class: string }> = {
  urgent: { label: 'Urgent', class: 'bg-red-100 text-red-700 border-red-300' },
  high:   { label: 'High',   class: 'bg-orange-50 text-orange-700 border-orange-200' },
  medium: { label: 'Medium', class: 'bg-slate-100 text-slate-600 border-slate-200' },
  low:    { label: 'Low',    class: 'bg-slate-50 text-slate-400 border-slate-200' },
}

export default function PriorityBadge({ priority, className }: Props) {
  const { label, class: cls } = config[priority] ?? config.medium
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border', cls, className)}>
      {label}
    </span>
  )
}
