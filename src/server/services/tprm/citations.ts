import type { CitationFailure, DocumentUnitRow, Locator } from '../../../types/index.js'
import { isLowText, matchQuote, QuoteMatch } from './parsers.js'

// Where the model says a quote comes from. PDFs cite a page; spreadsheets cite a sheet
// and the row number shown in "[Row N]". Nullable fields keep the JSON schema flat.
export interface ClaimedLocation {
  page: number | null
  sheet: string | null
  row: number | null
}

export type CitationCheck =
  | { verified: true; locator: Locator; unitIndex: number; match: QuoteMatch }
  | { verified: false; locator: Locator | null; unitIndex: number | null; failure: CitationFailure; match: QuoteMatch | null }

const ROW_LINE = /^\[Row (\d+)\] /

function rowLine(unitText: string, row: number): string | null {
  for (const line of unitText.split('\n')) {
    const m = ROW_LINE.exec(line)
    if (m && Number(m[1]) === row) return line
  }
  return null
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
    return { verified: false, locator, unitIndex: unit.unit_index, failure: 'QUOTE_NOT_FOUND', match }
  }
  return { verified: true, locator, unitIndex: unit.unit_index, match }
}

// Renders a document for a prompt: page/row tags the model must cite back.
// Document text is untrusted input, so it is fenced and labelled as data.
export function renderDocument(filename: string, units: DocumentUnitRow[]): string {
  const parts = units.map((u) => {
    if ('page' in u.locator) {
      return `<page number="${u.locator.page}">\n${u.text}\n</page>`
    }
    return `<rows sheet="${u.locator.sheet}" first="${u.locator.row_start}" last="${u.locator.row_end}">\n${u.text}\n</rows>`
  })
  return `<document filename="${filename}">\n${parts.join('\n')}\n</document>`
}
