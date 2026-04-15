import { cn } from '@/lib/utils'
import type { RequestType } from '../../../types'

interface Props {
  type: RequestType
  className?: string
}

const config: Record<RequestType, { label: string; class: string }> = {
  rfp:        { label: 'RFP',        class: 'bg-blue-50 text-blue-700 border-blue-200' },
  rfq:        { label: 'RFQ',        class: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  rfi:        { label: 'RFI',        class: 'bg-teal-50 text-teal-700 border-teal-200' },
  compliance: { label: 'Compliance', class: 'bg-amber-50 text-amber-700 border-amber-200' },
  onboarding: { label: 'Onboarding', class: 'bg-purple-50 text-purple-700 border-purple-200' },
  survey:     { label: 'Survey',     class: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export default function TypeBadge({ type, className }: Props) {
  const { label, class: cls } = config[type] ?? config.survey
  return (
    <span className={cn('inline-flex items-center px-2.5 py-1 rounded text-xs font-semibold border', cls, className)}>
      {label}
    </span>
  )
}
