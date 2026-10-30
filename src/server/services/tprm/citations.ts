import * as z from 'zod/v4'
import type { CitationFailure, DocumentUnitRow, Locator } from '../../../types/index.js'
import { isLowText, matchQuote, normalizeForMatch, QuoteMatch } from './parsers.js'

// Where the model says a quote comes from. PDFs cite a page; spreadsheets cite a sheet
// and the row number shown in "[Row N]". Nullable fields keep the JSON schema flat.
export interface ClaimedLocation {
  page: number | null
  sheet: string | null
  row: number | null
}

export const LocationSchema = z.object({
  page: z.number().int().nullable(),
  sheet: z.string().nullable(),
  row: z.number().int().nullable(),
})

// relocatedFrom is set when the quote was not at the cited location but appears verbatim at
// exactly one other location in the same document; the locator is corrected to that place.
export type CitationCheck =
  | { verified: true; locator: Locator; unitIndex: number; match: QuoteMatch; relocatedFrom: Locator | null }
  | { verified: false; locator: Locator | null; unitIndex: number | null; failure: CitationFailure; match: QuoteMatch | null }

const ROW_LINE = /^\[Row (\d+)\] /

function rowLine(unitText: string, row: number): string | null {
  for (const line of unitText.split('\n')) {
    const m = ROW_LINE.exec(line)
    if (m && Number(m[1]) === row) return line
  }
  return null
}

// A real quote cited to the wrong page is bookkeeping, not invention. Only an exact match at a
// single other location in the same document qualifies; anything ambiguous stays unverified.
function relocate(units: DocumentUnitRow[], cited: DocumentUnitRow, quote: string): { locator: Locator; unit: DocumentUnitRow } | null {
  const q = normalizeForMatch(quote)
  if (!q) return null
  const hits: { locator: Locator; unit: DocumentUnitRow }[] = []
  for (const u of units) {
    if (isLowText(u.text)) continue
    if ('page' in u.locator) {
      if (u !== cited && 'page' in cited.locator && normalizeForMatch(u.text).includes(q)) hits.push({ locator: u.locator, unit: u })
    } else if ('sheet' in cited.locator && u.locator.sheet === cited.locator.sheet) {
      const sheet = u.locator.sheet
      for (const line of u.text.split('\n')) {
        const m = ROW_LINE.exec(line)
        if (m && normalizeForMatch(line).includes(q)) {
          hits.push({ locator: { sheet, row_start: Number(m[1]), row_end: Number(m[1]) }, unit: u })
        }
      }
    }
  }
  return hits.length === 1 ? hits[0] : null
}

// The deterministic half of the challenge layer: does the cited location exist, does it
// have real text, and is the quote actually there? A spreadsheet quote must be in the
// cited row itself, not just somewhere in the 25-row unit.
export function checkCitation(units: DocumentUnitRow[], claimed: ClaimedLocation, quote: string): CitationCheck {
  let locator: Locator
  let unit: DocumentUnitRow | undefined
  let text: string | null = null

  if (claimed.page !== null) {
    locator = { page: claimed.page }
    unit = units.find((u) => 'page' in u.locator && u.locator.page === claimed.page)
    text = unit?.text ?? null
  } else if (claimed.sheet !== null && claimed.row !== null) {
    const sheet = claimed.sheet.trim().toLowerCase()
    const row = claimed.row
    locator = { sheet: claimed.sheet, row_start: row, row_end: row }
    unit = units.find((u) => 'sheet' in u.locator && u.locator.sheet.toLowerCase() === sheet
      && row >= u.locator.row_start && row <= u.locator.row_end)
    if (unit && 'sheet' in unit.locator) locator = { sheet: unit.locator.sheet, row_start: row, row_end: row }
    text = unit ? rowLine(unit.text, row) : null
  } else {
    return { verified: false, locator: null, unitIndex: null, failure: 'NO_LOCATION', match: null }
  }

  if (!unit || text === null) {
    return { verified: false, locator, unitIndex: null, failure: 'PAGE_OUT_OF_RANGE', match: null }
  }
  if (isLowText(unit.text)) {
    return { verified: false, locator, unitIndex: unit.unit_index, failure: 'LOW_TEXT', match: null }
  }
  const match = matchQuote(text, quote)
  if (match.found === 'no') {
    const moved = relocate(units, unit, quote)
    if (moved) {
      return { verified: true, locator: moved.locator, unitIndex: moved.unit.unit_index, match: { found: 'exact', score: 1 }, relocatedFrom: locator }
    }
    return { verified: false, locator, unitIndex: unit.unit_index, failure: 'QUOTE_NOT_FOUND', match }
  }
  return { verified: true, locator, unitIndex: unit.unit_index, match, relocatedFrom: null }
}

// Renders a document for a prompt: page/row tags the model must cite back.
// Document text is untrusted input, so it is fenced and labelled as data.
export function renderDocument(filename: string, units: DocumentUnitRow[], id?: string, docType?: string | null): string {
  const parts = units.map((u) => {
    if ('page' in u.locator) {
      return `<page number="${u.locator.page}">\n${u.text}\n</page>`
    }
    return `<rows sheet="${u.locator.sheet}" first="${u.locator.row_start}" last="${u.locator.row_end}">\n${u.text}\n</rows>`
  })
  const attrs = [id ? `id="${id}"` : '', `filename="${filename}"`, docType ? `type="${docType}"` : ''].filter(Boolean).join(' ')
  return `<document ${attrs}>\n${parts.join('\n')}\n</document>`
}
