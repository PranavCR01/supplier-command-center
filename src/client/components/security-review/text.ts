// Display-only text helpers for the security review UI. Pure functions (no React, no DOM) so
// they are unit-tested from the server test suite. None of them change stored text.

import type { EvidencePassage, Locator } from '../../../types/index.js'

// PDF text keeps the line breaks of narrow table columns ("removed within one business day of\n
// the termination date"). Join a line onto the next when it stops mid-sentence: no closing
// punctuation and the next line starts lowercase, with a digit or an opening bracket.
export function reflow(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const prev = out.length ? out[out.length - 1] : null
    const midSentence = prev !== null && prev.trim() !== '' && !/[.:;!?]\s*$/.test(prev) && /^\s*[a-z0-9(]/.test(line)
    if (midSentence) out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${line.trim()}`
    else out.push(line)
  }
  return out.join('\n')
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9][a-z0-9.%-]*/g) ?? []

// For a quote that only matched approximately (e.g. the model joined table cells with commas),
// the line indexes on the page that are mostly made of the quote's words
export function closestLines(text: string, quote: string): number[] {
  const quoteWords = new Set(words(quote))
  const hits: number[] = []
  text.split('\n').forEach((line, i) => {
    const w = words(line)
    if (w.length < 2) return
    const share = w.filter((x) => quoteWords.has(x)).length / w.length
    if (share >= 0.6) hits.push(i)
  })
  return hits
}

export function locatorText(locator: Locator | null): string {
  if (!locator) return 'no location'
  if ('page' in locator) return `p. ${locator.page}`
  return locator.row_start === locator.row_end ? `${locator.sheet}, row ${locator.row_start}` : `${locator.sheet}, rows ${locator.row_start}–${locator.row_end}`
}

// Older conflict explanations refer to the model's passage numbers (P1, P2...), counted over the
// verified passages in order; show the document and page instead
export function namePassages(text: string, evidence: EvidencePassage[]): string {
  const verified = evidence.filter((e) => e.quote_verified)
  return text.replace(/\bP(\d+)\b/g, (m, n: string) => {
    const p = verified[Number(n) - 1]
    return p ? `${p.filename.replace(/\.(pdf|xlsx)$/i, '')} (${locatorText(p.locator)})` : m
  })
}

// One citation chip per document location, even when two quotes come from the same page
export function uniqueByLocation<T extends EvidencePassage>(passages: T[]): T[] {
  const seen = new Set<string>()
  return passages.filter((p) => {
    const key = `${p.document_id}|${locatorText(p.locator)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
