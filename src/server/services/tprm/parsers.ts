import { createRequire } from 'module'
import path from 'path'
import ExcelJS from 'exceljs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// pdfjs needs its bundled standard fonts to read PDFs that use the base-14 fonts (Helvetica etc.)
const STANDARD_FONT_DATA_URL =
  path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep

import type { Locator } from '../../../types/index.js'

export type { Locator }

// A unit is the smallest citable piece of a document: one PDF page, or a range of
// spreadsheet rows. Every citation points at a unit via its locator.

export interface DocumentUnit {
  unitIndex: number
  locator: Locator
  text: string
  // PDF pages with almost no extractable text are likely scanned images and need OCR
  lowText: boolean
}

export interface QuestionnaireItem {
  ref: string
  domain: string | null
  question: string
  row: number
}

const LOW_TEXT_CHARS = 40

// Pages with almost no extractable text are likely scans; derived from text so it never needs storing
export function isLowText(text: string): boolean {
  return text.replace(/\s/g, '').length < LOW_TEXT_CHARS
}
const XLSX_ROWS_PER_UNIT = 25

export async function parsePdf(data: Uint8Array): Promise<DocumentUnit[]> {
  // pdfjs transfers (detaches) the buffer it is given, so pass a copy
  const task = getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  })
  const pdf = await task.promise
  const units: DocumentUnit[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        text += item.hasEOL ? '\n' : ''
      }
      text = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      units.push({
        unitIndex: pageNumber - 1,
        locator: { page: pageNumber },
        text,
        lowText: isLowText(text),
      })
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }

  return units
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('')
    if ('text' in value) return String(value.text)
    if ('result' in value) return value.result === undefined ? '' : String(value.result)
    return ''
  }
  return String(value).trim()
}

async function loadWorkbook(data: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(data) as unknown as ExcelJS.Buffer)
  return workbook
}

// Each spreadsheet row becomes one line: "[Row 7] User: ctr.mbaker | Decision: Remove | ..."
// so the model can cite a row and the verifier can find the quote inside the unit text.
export async function parseXlsx(data: Uint8Array): Promise<DocumentUnit[]> {
  const workbook = await loadWorkbook(data)
  const units: DocumentUnit[] = []

  workbook.eachSheet((sheet) => {
    const header: string[] = []
    const lines: { row: number; line: string }[] = []

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = []
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        values[col - 1] = cellText(cell.value)
      })
      if (header.length === 0) {
        header.push(...values.map((v, i) => v || `Column ${i + 1}`))
        return
      }
      const fields = values
        .map((v, i) => (v ? `${header[i] ?? `Column ${i + 1}`}: ${v}` : ''))
        .filter(Boolean)
      if (fields.length > 0) lines.push({ row: rowNumber, line: `[Row ${rowNumber}] ${fields.join(' | ')}` })
    })

    for (let i = 0; i < lines.length; i += XLSX_ROWS_PER_UNIT) {
      const chunk = lines.slice(i, i + XLSX_ROWS_PER_UNIT)
      units.push({
        unitIndex: units.length,
        locator: { sheet: sheet.name, row_start: chunk[0].row, row_end: chunk[chunk.length - 1].row },
        text: `Sheet: ${sheet.name}\n${chunk.map((c) => c.line).join('\n')}`,
        lowText: false,
      })
    }
  })

  return units
}

const REF_HEADERS = ['ref', 'id', 'question id', 'ref #', '#', 'no.', 'number']
const DOMAIN_HEADERS = ['domain', 'section', 'category']

// Finds the sheet whose header row has a "Question" column and reads one item per row.
export async function parseQuestionnaire(data: Uint8Array): Promise<QuestionnaireItem[]> {
  const workbook = await loadWorkbook(data)

  for (const sheet of workbook.worksheets) {
    let headerRow = 0
    let qCol = 0
    let refCol = 0
    let domainCol = 0

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (headerRow) return
      row.eachCell((cell, col) => {
        const h = cellText(cell.value).toLowerCase()
        if (h === 'question' || h === 'question text') qCol = col
        if (REF_HEADERS.includes(h)) refCol = col
        if (DOMAIN_HEADERS.includes(h)) domainCol = col
      })
      if (qCol) headerRow = rowNumber
    })
    if (!headerRow) continue

    const items: QuestionnaireItem[] = []
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber <= headerRow) return
      const question = cellText(row.getCell(qCol).value)
      if (!question) return
      items.push({
        ref: (refCol && cellText(row.getCell(refCol).value)) || `Q${items.length + 1}`,
        domain: domainCol ? cellText(row.getCell(domainCol).value) || null : null,
        question,
        row: rowNumber,
      })
    })
    if (items.length > 0) return items
  }

  throw new Error('No sheet with a "Question" column was found')
}

export function locatorLabel(locator: Locator): string {
  return 'page' in locator
    ? `p. ${locator.page}`
    : `${locator.sheet} rows ${locator.row_start}-${locator.row_end}`
}

// ---------------------------------------------------------------------------
// Quote matching: the deterministic half of the challenge step
// ---------------------------------------------------------------------------

export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text: string): string[] {
  return normalizeForMatch(text)
    .split(/[^a-z0-9%.$-]+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(Boolean)
}

export type QuoteMatch = { found: 'exact' | 'approximate' | 'no'; score: number }

const APPROXIMATE_THRESHOLD = 0.9

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0)
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[b.length]
}

// Exact match after normalization; otherwise the best share of quote tokens found in
// order inside a short window of the unit (window = 1.3x quote length, starting where
// one of the quote's first tokens appears). >= 0.9 counts as approximate. The window
// keeps common words scattered across a page from adding up to a false match.
export function matchQuote(unitText: string, quote: string): QuoteMatch {
  const q = normalizeForMatch(quote)
  if (!q) return { found: 'no', score: 0 }
  if (normalizeForMatch(unitText).includes(q)) return { found: 'exact', score: 1 }

  const qt = tokens(quote)
  const ut = tokens(unitText)
  if (qt.length === 0 || ut.length === 0) return { found: 'no', score: 0 }

  // A changed number (41 days -> 14 days) is the most damaging misquote, so fuzzy
  // matching never tolerates it: every numeric token in the quote must exist in the unit.
  const unitTokens = new Set(ut)
  if (qt.some((t) => /\d/.test(t) && !unitTokens.has(t))) return { found: 'no', score: 0 }

  const windowSize = Math.ceil(qt.length * 1.3)
  const starts = new Set(qt.slice(0, 3))
  let best = 0
  for (let s = 0; s < ut.length; s++) {
    if (!starts.has(ut[s])) continue
    best = Math.max(best, lcsLength(ut.slice(s, s + windowSize), qt))
    if (best === qt.length) break
  }
  const score = best / qt.length
  return { found: score >= APPROXIMATE_THRESHOLD ? 'approximate' : 'no', score: Math.round(score * 100) / 100 }
}

// Numbers a claim states that its source never does ("31 days" when the source says
// "41 days"). Catches arithmetic and invented values; spelled-out numbers are not checked.
// Identifiers with letters attached (PT-01, CC6.2, Q4, FY2026, AES-256) and framework names
// (SOC 2, Type 2) are not quantities.
const NUMBER = /\d+(?:[.,]\d+)*%?/g
const IDENTIFIER = /[a-z]+-?\d+(?:[.-]\d+)*/g
const FRAMEWORK = /\b(?:soc|type)\s+\d\b/g

function numbersIn(text: string): string[] {
  return normalizeForMatch(text).replace(FRAMEWORK, ' ').replace(IDENTIFIER, ' ').match(NUMBER) ?? []
}

export function numbersNotInSource(claim: string, source: string): string[] {
  const have = new Set(numbersIn(source))
  return [...new Set(numbersIn(claim))].filter((n) => !have.has(n))
}
