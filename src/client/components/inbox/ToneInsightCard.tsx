import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { InboxRequest } from '../../../types'

type Urgency = 'low' | 'medium' | 'high' | 'critical'
type Sentiment = 'positive' | 'neutral' | 'concerned' | 'demanding'
type Risk = 'low' | 'medium' | 'high'

interface ToneResult {
  urgency: Urgency
  sentiment: Sentiment
  relationship_risk: Risk
  recommended_tone: string
  key_deadline: string | null
}

interface Props {
  request: InboxRequest
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

const URGENCY_CLASSES: Record<Urgency, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

const URGENCY_LABELS: Record<Urgency, string> = {
  low: 'Low urgency',
  medium: 'Medium urgency',
  high: 'High urgency',
  critical: 'Critical',
}

const SENTIMENT_CLASSES: Record<Sentiment, string> = {
  positive: 'bg-emerald-100 text-emerald-700',
  neutral: 'bg-slate-100 text-slate-600',
  concerned: 'bg-amber-100 text-amber-700',
  demanding: 'bg-red-100 text-red-700',
}

const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  concerned: 'Concerned',
  demanding: 'Demanding',
}

const RISK_CLASSES: Record<Risk, string> = {
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
}

const RISK_LABELS: Record<Risk, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
}

function isValidResult(v: unknown): v is ToneResult {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj.urgency === 'string' &&
    typeof obj.sentiment === 'string' &&
    typeof obj.relationship_risk === 'string' &&
    typeof obj.recommended_tone === 'string'
  )
}

export default function ToneInsightCard({ request }: Props) {
  const cacheRef = useRef<Map<string, ToneResult>>(new Map())
  const [result, setResult] = useState<ToneResult | null>(null)

  useEffect(() => {
    const cached = cacheRef.current.get(request.id)
    if (cached) {
      setResult(cached)
      return
    }

    setResult(null)
    let cancelled = false

    const run = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session || cancelled) return

      try {
        const res = await fetch(`${API_BASE}/api/ai/analyze-tone`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ requestId: request.id }),
        })

        if (!res.ok || cancelled) return

        const json: unknown = await res.json()
        if (cancelled) return

        if (!isValidResult(json)) return

        cacheRef.current.set(request.id, json)
        setResult(json)
      } catch {
        // Fail silently — supplementary feature
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [request.id])

  if (!result) return null

  const urgency = result.urgency in URGENCY_CLASSES ? result.urgency : 'low'
  const sentiment = result.sentiment in SENTIMENT_CLASSES ? result.sentiment : 'neutral'
  const risk = result.relationship_risk in RISK_CLASSES ? result.relationship_risk : 'low'

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 space-y-2">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
        Message analysis
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 font-medium">Urgency:</span>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${URGENCY_CLASSES[urgency]}`}>
            {URGENCY_LABELS[urgency]}
          </span>
        </span>

        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 font-medium">Tone:</span>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${SENTIMENT_CLASSES[sentiment]}`}>
            {SENTIMENT_LABELS[sentiment]}
          </span>
        </span>

        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-slate-500 font-medium">Risk:</span>
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${RISK_CLASSES[risk]}`}>
            {RISK_LABELS[risk]}
          </span>
        </span>
      </div>

      <p className="text-[11px] italic text-slate-500 leading-relaxed">
        {result.recommended_tone}
      </p>

      {result.key_deadline && (
        <p className="text-[11px] font-semibold text-orange-600">
          Deadline: {result.key_deadline}
        </p>
      )}
    </div>
  )
}
