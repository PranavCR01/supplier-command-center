// Verifies test_data/tprm/gold.json against the synthetic documents, using the same
// parsers the app uses. Fails if any gold anchor is not at its gold location, if page
// counts drift after regenerating the PDFs, or if a "not addressed" trap is accidentally
// answered by some document.
//
// Usage: npm run tprm:verify-samples

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  DocumentUnit,
  matchQuote,
  normalizeForMatch,
  parsePdf,
  parseQuestionnaire,
  parseXlsx,
} from '../../src/server/services/tprm/parsers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOCS = path.join(ROOT, 'test_data/tprm/documents')

interface GoldLocation {
  doc: string
  anchor: string
  page?: number
  sheet?: string
  row?: number
}

interface GoldQuestion {
  ref: string
  evidence: GoldLocation[]
  conflict?: { a: GoldLocation; b: GoldLocation[] }
}

interface Gold {
  documents: Record<string, { file: string; units?: number; questions?: number }>
  questions: GoldQuestion[]
}

// Phrases whose presence anywhere would mean a "not addressed" trap is actually answered
const MUST_BE_ABSENT: Record<string, string[]> = {
  'DATA-04': ['destroy', 'destruction', 'return of client data', 'return of customer data', 'within 30 days'],
  'BCP-02': ['rto', 'rpo', 'recovery time objective', 'recovery point objective'],
}

const gold = JSON.parse(fs.readFileSync(path.join(ROOT, 'test_data/tprm/gold.json'), 'utf-8')) as Gold
const failures: string[] = []
let checked = 0

const units: Record<string, DocumentUnit[]> = {}
for (const [key, doc] of Object.entries(gold.documents)) {
  if (key === 'questionnaire') continue
  const data = fs.readFileSync(path.join(DOCS, doc.file))
  units[key] = doc.file.endsWith('.pdf') ? await parsePdf(data) : await parseXlsx(data)
  if (doc.units !== undefined && units[key].length !== doc.units) {
    failures.push(`${key}: expected ${doc.units} pages, parsed ${units[key].length}`)
  }
  const low = units[key].filter((u) => u.lowText)
  if (low.length > 0) failures.push(`${key}: ${low.length} unit(s) with almost no text`)
}

function locate(loc: GoldLocation): string | null {
  const docUnits = units[loc.doc]
  if (!docUnits) return null
  if (loc.page !== undefined) {
    const u = docUnits.find((x) => 'page' in x.locator && x.locator.page === loc.page)
    return u ? u.text : null
  }
  // Spreadsheet: return just the cited row's line
  const u = docUnits.find(
    (x) => 'sheet' in x.locator && x.locator.sheet === loc.sheet &&
      loc.row !== undefined && x.locator.row_start <= loc.row && loc.row <= x.locator.row_end,
  )
  return u?.text.split('\n').find((line) => line.startsWith(`[Row ${loc.row}] `)) ?? null
}

function checkLocation(ref: string, loc: GoldLocation) {
  checked++
  const where = loc.page !== undefined ? `p.${loc.page}` : `${loc.sheet} row ${loc.row}`
  const text = locate(loc)
  if (text === null) {
    failures.push(`${ref}: ${loc.doc} ${where} does not exist`)
    return
  }
  const m = matchQuote(text, loc.anchor)
  if (m.found !== 'exact') failures.push(`${ref}: anchor not on ${loc.doc} ${where}: "${loc.anchor}" (score ${m.score})`)
}

for (const q of gold.questions) {
  for (const loc of q.evidence) checkLocation(q.ref, loc)
  if (q.conflict) {
    checkLocation(`${q.ref} conflict.a`, q.conflict.a)
    for (const b of q.conflict.b) checkLocation(`${q.ref} conflict.b`, b)
  }
}

for (const [ref, phrases] of Object.entries(MUST_BE_ABSENT)) {
  for (const [key, docUnits] of Object.entries(units)) {
    for (const u of docUnits) {
      const text = normalizeForMatch(u.text)
      for (const phrase of phrases) {
        if (new RegExp(`\\b${phrase}\\b`).test(text)) {
          failures.push(`${ref}: trap phrase "${phrase}" found in ${key} unit ${u.unitIndex} - question may be answerable`)
        }
      }
    }
  }
}

const questionnaire = await parseQuestionnaire(
  fs.readFileSync(path.join(DOCS, gold.documents.questionnaire.file)),
)
const parsedRefs = questionnaire.map((q) => q.ref)
const goldRefs = gold.questions.map((q) => q.ref)
if (parsedRefs.join() !== goldRefs.join()) {
  failures.push(`questionnaire refs differ from gold:\n  parsed ${parsedRefs.join(', ')}\n  gold   ${goldRefs.join(', ')}`)
}

console.log(`Checked ${checked} anchors across ${Object.keys(units).length} evidence documents and ${questionnaire.length} questions.`)
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('All gold anchors verified.')
