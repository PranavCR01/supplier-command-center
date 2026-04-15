import { useEffect, useRef, useState } from 'react'
import { Sparkles, AlertCircle, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '@/lib/supabase'

interface Props {
  requestId: string
}

type State =
  | { phase: 'checking' }
  | { phase: 'idle' }
  | { phase: 'streaming'; text: string }
  | { phase: 'done'; text: string }
  | { phase: 'error'; message: string }

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'

export default function DraftPanel({ requestId }: Props) {
  const [state, setState] = useState<State>({ phase: 'checking' })
  const abortRef = useRef<AbortController | null>(null)

  // On mount: check for an existing draft
  useEffect(() => {
    setState({ phase: 'checking' })
    let cancelled = false

    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || cancelled) return

      try {
        const res = await fetch(`${API_BASE}/api/ai/draft/${requestId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        if (cancelled) return

        if (res.ok) {
          const json = await res.json() as { draft: string; tokens: number }
          setState({ phase: 'done', text: json.draft })
        } else {
          setState({ phase: 'idle' })
        }
      } catch {
        if (!cancelled) setState({ phase: 'idle' })
      }
    }

    check()
    return () => { cancelled = true }
  }, [requestId])

  // Abort any in-flight stream when unmounted
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  const generate = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const controller = new AbortController()
    abortRef.current = controller

    setState({ phase: 'streaming', text: '' })

    try {
      const res = await fetch(`${API_BASE}/api/ai/draft/${requestId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        setState({ phase: 'error', message: 'Server error — please try again.' })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const messages = buffer.split('\n\n')
        buffer = messages.pop() ?? ''

        for (const msg of messages) {
          const line = msg.trim()
          if (!line.startsWith('data: ')) continue

          try {
            const event = JSON.parse(line.slice(6)) as
              | { type: 'delta'; text: string }
              | { type: 'done'; tokens: number }
              | { type: 'error'; message: string }

            if (event.type === 'delta') {
              accumulated += event.text
              setState({ phase: 'streaming', text: accumulated })
            } else if (event.type === 'done') {
              setState({ phase: 'done', text: accumulated })
            } else if (event.type === 'error') {
              setState({ phase: 'error', message: event.message })
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState({ phase: 'error', message: 'Connection lost — please try again.' })
    }
  }

  // ── Render states ──────────────────────────────────────────────

  if (state.phase === 'checking') {
    return (
      <div className="mt-6 pt-5 border-t border-slate-100">
        <p className="text-xs text-slate-400">Checking for existing draft…</p>
      </div>
    )
  }

  if (state.phase === 'idle') {
    return (
      <div className="mt-6 pt-5 border-t border-slate-100">
        <button
          onClick={generate}
          className="
            flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
            bg-[#0369A1] text-white hover:bg-[#0284C7]
            transition-colors duration-150 cursor-pointer
          "
        >
          <Sparkles className="w-4 h-4" />
          Draft Response
        </button>
        <p className="text-xs text-slate-400 mt-2">
          AI will generate a draft using your supplier profile. You review and send.
        </p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="mt-6 pt-5 border-t border-slate-100">
        <div className="flex items-start gap-2 text-sm text-red-600 mb-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{state.message}</span>
        </div>
        <button
          onClick={generate}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#0369A1] hover:underline cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" /> Try again
        </button>
      </div>
    )
  }

  // streaming or done
  const isStreaming = state.phase === 'streaming'

  return (
    <div className="mt-6 pt-5 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#0369A1]" />
          <span className="text-xs font-semibold text-[#0F172A]">
            {isStreaming ? 'Drafting…' : 'AI Draft'}
          </span>
        </div>
        {!isStreaming && (
          <button
            onClick={generate}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3 h-3" /> Regenerate
          </button>
        )}
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 max-h-[480px] overflow-y-auto">
        <div className="
          prose prose-sm max-w-none
          prose-headings:text-[#0F172A] prose-headings:font-semibold
          prose-h2:text-sm prose-h3:text-xs prose-h3:uppercase prose-h3:tracking-wide prose-h3:text-slate-500
          prose-p:text-slate-700 prose-p:leading-relaxed
          prose-strong:text-[#0F172A] prose-strong:font-semibold
          prose-ul:text-slate-700 prose-li:my-0.5
          prose-table:w-full prose-table:text-sm prose-table:border-collapse
          prose-thead:bg-slate-100
          prose-th:border prose-th:border-slate-200 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-slate-600
          prose-td:border prose-td:border-slate-200 prose-td:px-3 prose-td:py-2 prose-td:text-slate-700 prose-td:align-top
          [&_tbody_tr:nth-child(even)]:bg-slate-50/70
        ">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.text}</ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 bg-[#0369A1] ml-0.5 animate-pulse align-text-bottom" />
          )}
        </div>
      </div>

      {!isStreaming && (
        <p className="text-xs text-slate-400 mt-2">
          Draft generated — review and expand as needed.
        </p>
      )}
    </div>
  )
}
