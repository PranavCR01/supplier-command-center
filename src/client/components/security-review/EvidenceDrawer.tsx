import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText, X } from 'lucide-react'
import { securityReviewApi } from '@/lib/securityReviewApi'
import type { Locator } from '../../../types'
import { locatorLabel } from './labels'

export interface EvidenceTarget {
  documentId: string
  filename: string
  locator: Locator
  quote: string
  verified: boolean
}

// Splits text around the quote, tolerating different whitespace and case
function highlight(text: string, quote: string): { before: string; match: string; after: string } | null {
  const words = quote.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (words.length === 0) return null
  const m = new RegExp(words.join('\\s+'), 'i').exec(text)
  if (!m) return null
  return { before: text.slice(0, m.index), match: m[0], after: text.slice(m.index + m[0].length) }
}

export default function EvidenceDrawer({ target, onClose }: { target: EvidenceTarget | null; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['unit', target?.documentId, target ? locatorLabel(target.locator) : null],
    queryFn: () => securityReviewApi.unit(target!.documentId, target!.locator),
    enabled: Boolean(target),
  })

  useEffect(() => {
    if (!target) return
    setOpenError(null)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onClose])

  if (!target) return null
  const parts = data ? highlight(data.unit.text, target.quote) : null

  const openOriginal = async () => {
    try {
      const url = await securityReviewApi.originalUrl(target.documentId)
      // #page works in desktop PDF viewers; iOS Safari ignores it, which is why the text view comes first
      window.open('page' in target.locator ? `${url}#page=${target.locator.page}` : url, '_blank', 'noopener')
    } catch {
      setOpenError('The original file is not available.')
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Evidence"
        className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-xl bg-white shadow-xl flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#0F172A] truncate">
              <FileText className="w-4 h-4 shrink-0 text-slate-400" />
              <span className="truncate">{target.filename}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{locatorLabel(target.locator)}</p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none"
            aria-label="Close evidence"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {!target.verified && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              This quote was not found at the cited location. Treat it as unverified.
            </p>
          )}
          {isLoading && <p className="text-sm text-slate-500">Loading page text…</p>}
          {error && <p className="text-sm text-red-700">Could not load this page.</p>}
          {data && (
            <>
              {data.unit.low_text && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  This page has almost no extractable text (likely a scan).
                </p>
              )}
              {target.verified && !parts && (
                <p className="text-xs text-slate-500">The quote matched approximately, so it is not highlighted.</p>
              )}
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-700 bg-slate-50 border border-slate-100 rounded-lg p-4">
                {parts ? (
                  <>
                    {parts.before}
                    <mark data-testid="evidence-highlight" className="bg-amber-100 text-[#0F172A] rounded px-0.5">{parts.match}</mark>
                    {parts.after}
                  </>
                ) : data.unit.text}
              </pre>
            </>
          )}
        </div>

        {data?.document.has_original && (
          <div className="px-5 py-3 border-t border-slate-200">
            <button
              onClick={openOriginal}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0369A1] hover:underline cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0369A1] focus-visible:outline-none rounded"
            >
              <ExternalLink className="w-4 h-4" /> Open original
            </button>
            {openError && <p className="text-xs text-red-700 mt-1">{openError}</p>}
          </div>
        )}
      </aside>
    </>
  )
}
