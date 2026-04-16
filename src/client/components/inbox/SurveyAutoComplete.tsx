import { useEffect, useRef, useState } from 'react'
import { ClipboardCopy, Check, RefreshCw, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { InboxRequest } from '../../../types'

interface SurveyAnswer {
  question: string
  answer: string
}

interface Props {
  request: InboxRequest
}

type Phase = 'idle' | 'loading' | 'done'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export default function SurveyAutoComplete({ request }: Props) {
  const cacheRef = useRef<Map<string, SurveyAnswer[]>>(new Map())
  const [phase, setPhase] = useState<Phase>('idle')
  const [answers, setAnswers] = useState<SurveyAnswer[] | null>(null)
  const [copied, setCopied] = useState(false)

  // Reset state when request changes; restore from cache if available
  useEffect(() => {
    const cached = cacheRef.current.get(request.id)
    if (cached) {
      setAnswers(cached)
      setPhase('done')
    } else {
      setAnswers(null)
      setPhase('idle')
    }
    setCopied(false)
  }, [request.id])

  // Only render for survey type — hooks are all called above this return
  if (request.type !== 'survey') return null

  const generate = async () => {
    const cached = cacheRef.current.get(request.id)
    if (cached && phase !== 'loading') {
      setAnswers(cached)
      setPhase('done')
      return
    }

    setPhase('loading')

    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setPhase('idle')
      return
    }

    try {
      const res = await fetch(`${API_BASE}/api/ai/auto-complete-survey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ requestId: request.id }),
      })

      if (!res.ok) {
        setPhase('idle')
        return
      }

      const json = (await res.json()) as { answers: SurveyAnswer[] }
      if (!Array.isArray(json.answers) || json.answers.length === 0) {
        setPhase('idle')
        return
      }

      cacheRef.current.set(request.id, json.answers)
      setAnswers(json.answers)
      setPhase('done')
    } catch {
      // Fail silently — supplementary feature
      setPhase('idle')
    }
  }

  const copyAll = async () => {
    if (!answers) return
    const text = answers.map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed — ignore
    }
  }

  return (
    <div className="space-y-3">
      {/* Trigger button */}
      <button
        onClick={generate}
        disabled={phase === 'loading'}
        className="
          flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
          transition-colors duration-150 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed
          bg-[#0369A1] text-white hover:bg-[#0284C7]
        "
      >
        {phase === 'loading' ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : phase === 'done' ? (
          <>
            <RefreshCw className="w-4 h-4" />
            Regenerate
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Auto-complete from profile
          </>
        )}
      </button>

      {/* Answer card */}
      {phase === 'done' && answers && answers.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          {/* Card header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
            <span className="text-xs font-semibold text-[#0F172A]">Draft survey responses</span>
            <button
              onClick={copyAll}
              title={copied ? 'Copied!' : 'Copy all as plain text'}
              className="
                flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md
                text-slate-500 hover:text-[#0F172A] hover:bg-slate-100
                transition-colors duration-150 cursor-pointer
              "
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <ClipboardCopy className="w-3.5 h-3.5" />
                  Copy all
                </>
              )}
            </button>
          </div>

          {/* Q&A list */}
          <div className="divide-y divide-slate-100">
            {answers.map((item, i) => (
              <div key={i} className="px-4 py-3 space-y-1">
                <p className="text-[11px] font-medium text-slate-400 leading-snug">
                  {item.question}
                </p>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {item.answer}
                </p>
              </div>
            ))}
          </div>

          {/* Disclaimer */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-[11px] italic text-slate-400">
              Review before submitting — answers are based on your profile data
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
