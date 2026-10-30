import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { QuestionnaireAnswerRow } from '../../../types/index.js'
import { buildResponse, fillQuestionnaire, isReleasable, toMarkdown } from './response.js'

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/documents')

function answer(ref: string, row: number, patch: Partial<QuestionnaireAnswerRow> = {}): QuestionnaireAnswerRow {
  return {
    id: ref, supplier_id: 's', run_id: 'run', question_ref: ref, question_row: row, domain: 'Gov', question_text: `${ref}?`,
    answer: 'yes', response_text: `Drafted ${ref}.`, conflict: null, verifier: null, model_confidence: 0.9,
    readiness: 'ready', reasons: [], unsupported_numbers: [], errors: [], review_status: 'pending', final_text: null,
    reviewed_at: null, created_at: '', updated_at: '',
    evidence: [
      { document_id: 'd', filename: 'soc2.pdf', locator: { page: 10 }, quote: 'q', stance: 'supports', note: '', quote_verified: true, failure: null, relocated_from: null, cited: true },
      { document_id: 'd', filename: 'soc2.pdf', locator: { page: 10 }, quote: 'q2', stance: 'supports', note: '', quote_verified: true, failure: null, relocated_from: null, cited: true },
      { document_id: 'd', filename: 'policy.pdf', locator: { page: 3 }, quote: 'q', stance: 'supports', note: '', quote_verified: false, failure: 'QUOTE_NOT_FOUND', relocated_from: null, cited: true },
      { document_id: 'd', filename: 'pentest.pdf', locator: { page: 2 }, quote: 'q', stance: 'limits', note: '', quote_verified: true, failure: null, relocated_from: null, cited: false },
    ],
    ...patch,
  }
}

test('only human-approved answers or unrejected Ready answers are released', () => {
  const cases: [Partial<QuestionnaireAnswerRow>, boolean][] = [
    [{}, true],                                                                          // Ready, not reviewed
    [{ review_status: 'rejected' }, false],                                              // rejected Ready
    [{ readiness: 'needs_evidence' }, false],                                            // not reviewed
    [{ readiness: 'conflict' }, false],
    [{ readiness: 'needs_evidence', review_status: 'approved' }, true],                  // human signed off
    [{ readiness: 'conflict', review_status: 'edited', final_text: 'Resolved.' }, true],
    [{ readiness: 'needs_evidence', review_status: 'approved', response_text: null }, false],  // nothing to send
  ]
  for (const [patch, expected] of cases) assert.equal(isReleasable(answer('X', 1, patch)), expected, JSON.stringify(patch))
})

test('entries: questionnaire order, edited text wins, only cited verified evidence, withheld listed with reasons', () => {
  const { included, withheld } = buildResponse([
    answer('IAM-01', 5, { readiness: 'conflict', review_status: 'edited', final_text: 'Partial: admin portal lacks MFA.', answer: 'partial' }),
    answer('GOV-01', 2),
    answer('DATA-04', 13, { readiness: 'needs_evidence', answer: 'not_addressed', reasons: ['NO_EVIDENCE'] }),
    answer('GOV-02', 3, { review_status: 'rejected' }),
  ])
  assert.deepEqual(included.map((e) => [e.ref, e.response, e.signed_off]), [['GOV-01', 'Yes', 'checks'], ['IAM-01', 'Partial', 'human']])
  assert.equal(included[1].explanation, 'Partial: admin portal lacks MFA.')
  assert.equal(included[0].evidence_reference, 'soc2.pdf, p. 10', 'deduplicated, unverified and uncited passages left out')
  assert.deepEqual(withheld.map((w) => [w.ref, w.why]), [['GOV-02', 'rejected'], ['DATA-04', 'needs_evidence']])
  assert.deepEqual(withheld[1].reasons, ['NO_EVIDENCE'])
  assert.match(toMarkdown('T', included, 4), /2 of 4 questions answered[\s\S]*## GOV-01 — GOV-01\?[\s\S]*\*\*Response:\*\* Yes/)
})

test("fills the buyer's own questionnaire; withheld rows stay blank", async () => {
  const original = new Uint8Array(fs.readFileSync(path.join(SAMPLES, 'clearfield_vendor_security_questionnaire.xlsx')))
  const { included } = buildResponse([answer('GOV-01', 2), answer('IAM-03', 7, { answer: 'partial', review_status: 'edited', final_text: 'One business day.' }), answer('GOV-02', 3, { readiness: 'needs_evidence' })])
  const { data, filled } = await fillQuestionnaire(original, included)
  assert.equal(filled, 2)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(data) as unknown as ExcelJS.Buffer)
  const sheet = wb.getWorksheet('Questionnaire')!
  const header = (sheet.getRow(1).values as ExcelJS.CellValue[]).map(String)
  const col = (name: string) => header.indexOf(name)
  const cell = (ref: string, name: string) => {
    let r = 0
    sheet.eachRow((x, n) => { if (x.getCell(col('Ref')).value === ref) r = n })
    assert.ok(r > 1, `${ref} row found`)
    return sheet.getRow(r).getCell(col(name)).value
  }
  assert.deepEqual([cell('GOV-01', 'Response'), cell('GOV-01', 'Explanation'), cell('GOV-01', 'Evidence Reference')], ['Yes', 'Drafted GOV-01.', 'soc2.pdf, p. 10'])
  assert.deepEqual([cell('IAM-03', 'Response'), cell('IAM-03', 'Explanation')], ['Partial', 'One business day.'])
  assert.equal(cell('GOV-02', 'Response'), null, 'withheld answer not written')
  assert.equal(cell('GOV-02', 'Question'), 'Do you have a SOC 2 Type II report issued within the last 12 months? Provide the report period.', 'question text untouched')
  assert.equal(wb.getWorksheet('Instructions')!.getCell('A1').value, 'Clearfield Financial - Vendor Security Questionnaire (SIG-Lite style)', 'other sheets untouched')
})
