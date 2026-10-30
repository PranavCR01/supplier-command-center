import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { DocumentFinding, DocumentSummary, FindingKind, FindingStatus, Locator, SecurityDocType } from '../../../types/index.js'
import { AnalyzedDoc, GoldAnalysis, scoreAnalysis } from './scoreAnalysis.js'

const gold = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/gold.json'), 'utf-8',
)) as GoldAnalysis

function finding(kind: FindingKind, ref: string | null, extra: Partial<DocumentFinding> = {}): DocumentFinding {
  return {
    id: ref ?? kind, supplier_id: 's', document_id: 'd', kind, ref, title: ref ?? kind, stated_severity: null,
    status: null, detail: null, locator: { page: 1 }, quote: 'q', quote_verified: true, prompt_version: 'v', created_at: '',
    ...extra,
  }
}

function card(exceptions: string[], takeaways: string[], other = ''): DocumentSummary {
  const item = (text: string) => ({ text, locator: { page: 1 } as Locator, quote: 'q', quote_verified: true, failure: null, unsupported_numbers: [] })
  return { headline: other, top_findings: [], key_exceptions: exceptions.map(item), takeaways: takeaways.map(item) }
}

// The output a perfect model would produce, built from gold itself
function perfect(): AnalyzedDoc[] {
  const g = gold.findings
  const doc = (key: string, findings: DocumentFinding[], summary: DocumentSummary): AnalyzedDoc =>
    ({ key, docType: gold.documents[key].doc_type as SecurityDocType, findings, summary })
  return [
    doc('soc2', [
      ...g.soc2.controls.map((c) => finding('control', c.ref, { status: c.status as FindingStatus })),
      ...g.soc2.controls.filter((c) => c.page).map((c) => finding('control_exception', c.ref, { locator: { page: c.page! } })),
      finding('carve_out', null, { title: 'AWS' }),
    ], card(['CC6.2 late removals', 'CC8.1 late approval'], ['Obtain the AWS SOC 2 report'])),
    doc('pentest', g.pentest.map((p) => finding('pentest_finding', p.ref, { stated_severity: p.stated_severity, status: p.status as FindingStatus })),
      card(['PT-01 open', 'PT-03 open'], [])),
    doc('phishing', [
      finding('phishing_metric', 'campaign_count', { detail: '2' }),
      finding('phishing_metric', 'click_rate', { title: 'February 2026 campaign', detail: '19%' }),
      finding('phishing_metric', 'click_rate', { title: 'August 2026 campaign', detail: '14%' }),
      finding('phishing_metric', 'training_completion', { detail: '87%' }),
    ], card([], [], 'Training completion 87%')),
    doc('policy', [], card([], [])),
    doc('access_review', g.access_review.late_removal_rows.map((r) =>
      finding('access_review_exception', `Row ${r}`, { locator: { sheet: 'Q2-2026 Review', row_start: r, row_end: r } })),
    card(['2 accounts removed late'], [])),
  ]
}

test('a perfect analysis scores 100% on every check', () => {
  const score = scoreAnalysis(gold, perfect())
  const failed = score.checks.filter((c) => !c.pass)
  assert.deepEqual(failed, [])
  assert.deepEqual(score.classification, { correct: 5, total: 5 })
  assert.deepEqual(score.fieldAccuracy.soc2, { correct: 25, total: 25 })
})

test('each kind of mistake is caught', () => {
  const docs = perfect()
  const [soc2, pentest, phishing, , access] = docs
  pentest.findings.find((f) => f.ref === 'PT-01')!.stated_severity = 'High'      // severity not as stated
  soc2.findings.find((f) => f.kind === 'control' && f.ref === 'CC8.1')!.status = 'no_exceptions'
  soc2.findings.push(finding('control_exception', 'CC7.1'))                         // invented exception
  phishing.findings.find((f) => f.ref === 'training_completion')!.detail = '78%'
  access.findings.pop()                                                             // missed a late row
  soc2.summary = card(['CC6.2 late removals'], [])                                  // dropped CC8.1 and AWS
  docs[3].docType = 'other'

  const failed = scoreAnalysis(gold, docs).checks.filter((c) => !c.pass).map((c) => c.name).sort()
  assert.deepEqual(failed, [
    'classify.policy',
    'field.access_review.late_removals',
    'field.pentest.PT-01',
    'field.phishing.training_completion',
    'field.soc2.control.CC8.1',
    'field.soc2.no_invented_exceptions',
    'summary.soc2.exception.CC8.1',
    'summary.soc2.takeaway.AWS',
  ])
})

test('a missing document fails its checks instead of crashing', () => {
  const score = scoreAnalysis(gold, perfect().filter((d) => d.key !== 'pentest'))
  assert.equal(score.fieldAccuracy.pentest.correct, 0)
  assert.ok(score.checks.some((c) => c.name === 'summary.pentest.present' && !c.pass))
})
