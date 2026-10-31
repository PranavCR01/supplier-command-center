import ExcelJS from 'exceljs'
import type { QuestionnaireAnswerRow, ReadinessReason } from '../../../types/index.js'
import { locatorLabel } from './parsers.js'

// The final response is filtered here, in code: an answer reaches the buyer only if a person
// approved or edited it, or the checks marked it Ready and nobody rejected it. Everything else
// is withheld and listed for the vendor, never sent.

export type ResponseLabel = 'Yes' | 'No' | 'Partial' | 'N/A' | ''

export interface ResponseEntry {
  ref: string
  row: number
  domain: string | null
  question: string
  response: ResponseLabel
  explanation: string
  evidence_reference: string
  signed_off: 'human' | 'checks'
}

export interface WithheldEntry {
  ref: string
  row: number
  question: string
  why: 'rejected' | 'needs_evidence' | 'conflict'
  reasons: ReadinessReason[]
}

const LABEL: Record<string, ResponseLabel> = { yes: 'Yes', no: 'No', partial: 'Partial', 'n/a': 'N/A' }

export function isReleasable(a: QuestionnaireAnswerRow): boolean {
  if (a.review_status === 'rejected') return false
  if (a.review_status === 'approved' || a.review_status === 'edited') return Boolean((a.final_text ?? a.response_text)?.trim())
  return a.readiness === 'ready' && Boolean(a.response_text?.trim())
}

function evidenceReference(a: QuestionnaireAnswerRow): string {
  const refs = a.evidence
    .filter((e) => e.cited && e.quote_verified && e.locator)
    .map((e) => `${e.filename}, ${locatorLabel(e.locator!)}`)
  return [...new Set(refs)].join('; ')
}

export function buildResponse(answers: QuestionnaireAnswerRow[]): { included: ResponseEntry[]; withheld: WithheldEntry[] } {
  const included: ResponseEntry[] = []
  const withheld: WithheldEntry[] = []
  for (const a of [...answers].sort((x, y) => x.question_row - y.question_row)) {
    if (isReleasable(a)) {
      included.push({
        ref: a.question_ref, row: a.question_row, domain: a.domain, question: a.question_text,
        response: LABEL[a.final_answer ?? a.answer ?? ''] ?? '',
        explanation: (a.final_text ?? a.response_text ?? '').trim(),
        evidence_reference: evidenceReference(a),
        signed_off: a.review_status === 'pending' ? 'checks' : 'human',
      })
    } else {
      withheld.push({
        ref: a.question_ref, row: a.question_row, question: a.question_text,
        why: a.review_status === 'rejected' ? 'rejected' : a.readiness === 'ready' ? 'needs_evidence' : a.readiness,
        reasons: a.reasons,
      })
    }
  }
  return { included, withheld }
}

export function toMarkdown(title: string, entries: ResponseEntry[], total: number): string {
  const lines = [`# ${title}`, '', `${entries.length} of ${total} questions answered.`, '']
  for (const e of entries) {
    lines.push(`## ${e.ref} — ${e.question}`, '', `**Response:** ${e.response || 'See explanation'}`, '', e.explanation, '')
    if (e.evidence_reference) lines.push(`*Evidence:* ${e.evidence_reference}`, '')
  }
  return lines.join('\n')
}

const norm = (v: ExcelJS.CellValue) => String(v ?? '').trim().toLowerCase()

// Writes releasable answers into the buyer's own questionnaire: finds the header row with
// Ref + Response columns and fills Response / Explanation / Evidence Reference by ref.
// Withheld questions are left blank.
export async function fillQuestionnaire(original: Uint8Array, entries: ResponseEntry[]): Promise<{ data: Uint8Array; filled: number }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(original) as unknown as ExcelJS.Buffer)
  const byRef = new Map(entries.map((e) => [e.ref.toLowerCase(), e]))
  let filled = 0

  for (const sheet of wb.worksheets) {
    let headerRow = 0
    const col: Record<string, number> = {}
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (headerRow) return
      row.eachCell((cell, c) => { col[norm(cell.value)] = c })
      if (col.ref && (col.response || col.answer)) headerRow = n
      else for (const k of Object.keys(col)) delete col[k]
    })
    if (!headerRow) continue
    const responseCol = col.response ?? col.answer
    const explanationCol = col.explanation ?? col.comments
    const evidenceCol = col['evidence reference'] ?? col.evidence
    sheet.eachRow({ includeEmpty: false }, (row, n) => {
      if (n <= headerRow) return
      const e = byRef.get(norm(row.getCell(col.ref).value))
      if (!e) return
      row.getCell(responseCol).value = e.response
      if (explanationCol) row.getCell(explanationCol).value = e.explanation
      if (evidenceCol) row.getCell(evidenceCol).value = e.evidence_reference
      filled++
    })
  }
  return { data: new Uint8Array(await wb.xlsx.writeBuffer()), filled }
}
