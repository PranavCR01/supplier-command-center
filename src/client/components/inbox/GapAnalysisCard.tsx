import { useEffect, useState } from 'react'
import { Zap, CheckCircle, AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { InboxRequest, RequestType } from '../../../types'

const SUPPORTED_TYPES: RequestType[] = ['rfp', 'rfq', 'onboarding']

interface GapResult {
  strengths: string[]
  gaps: string[]
}

interface Props {
  request: InboxRequest
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export default function GapAnalysisCard({ request }: Props) {
  const isSupported = SUPPORTED_TYPES.includes(request.type)
  const [result, setResult] = useState<GapResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isSupported) return

    let cancelled = false
    setLoading(true)
    setResult(null)

    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session || cancelled) return

      try {
        const res = await fetch(`${API_BASE}/api/ai/analyze-gap`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ requestId: request.id }),
        })

        if (!res.ok || cancelled) return

        const json = (await res.json()) as GapResult
        if (cancelled) return

        if (json.strengths.length === 0 && json.gaps.length === 0) {
          setLoading(false)
          return
        }

        setResult(json)
      } catch {
        // Fail silently — supplementary feature
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [request.id, isSupported])

  if (!isSupported) return null

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 animate-pulse">
        <div className="flex items-center gap-1.5 mb-3">
          <div className="h-3.5 w-3.5 bg-slate-200 rounded" />
          <div className="h-3 w-36 bg-slate-200 rounded" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="h-3 w-full bg-slate-200 rounded" />
            <div className="h-3 w-4/5 bg-slate-200 rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-full bg-slate-200 rounded" />
            <div className="h-3 w-3/4 bg-slate-200 rounded" />
          </div>
        </div>
      </div>
    )
  }

  if (!result) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <Zap className="w-3.5 h-3.5 text-[#0369A1]" />
        <span className="text-xs font-semibold text-[#0F172A]">Profile match analysis</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {result.strengths.length > 0 && (
          <ul className="space-y-1.5">
            {result.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        )}

        {result.gaps.length > 0 && (
          <ul className="space-y-1.5">
            {result.gaps.map((g, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-slate-700">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <span>{g}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
