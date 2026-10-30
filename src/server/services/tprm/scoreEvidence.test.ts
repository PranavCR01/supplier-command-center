import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { EvidencePassage } from '../../../types/index.js'
import type { QuestionEvidence } from './evidence.js'
import { GoldEvidence, GoldLocation, scoreEvidence } from './scoreEvidence.js'

const gold = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/gold.json'), 'utf-8',
)) as GoldEvidence

const file = (key: string) => gold.documents[key].file

function passage(g: GoldLocation, stance: EvidencePassage['stance'] = 'supports'): EvidencePassage {
  return {
    document_id: g.doc, filename: file(g.doc), quote: g.anchor, stance, note: '', quote_verified: true, failure: null, relocated_from: null,
    locator: g.page !== undefined ? { page: g.page } : { sheet: g.sheet!, row_start: g.row!, row_end: g.row! },
  }
}

// What a perfect step 3 would return, built from gold
function perfect(): QuestionEvidence[] {
  return gold.questions.map((q) => {
    const passages = q.evidence.map((g) => passage(g))
    const conflict: QuestionEvidence['conflict'] = q.conflict
      ? { status: 'detected', conflict: { a: passage(q.conflict.a), b: passage(q.conflict.b[0], 'contradicts'), explanation: 'clash' } }
      : { status: 'none', explanation: 'compatible' }
    return { ref: q.ref, question: '', status: 'ok', error: null, passages, conflict, usage: [] }
  })
}

test('a perfect step 3 scores full recall with no false positives', () => {
  const s = scoreEvidence(gold, perfect())
  assert.equal(s.evidenceRecall.hit, s.evidenceRecall.total)
  assert.deepEqual([s.conflictRecall.caught, s.conflictRecall.total], [3, 3])
  assert.ok(s.conflictRecall.outcomes.every((o) => o.pairCorrect))
  assert.deepEqual(s.optionalConflicts.map((o) => o.ref), ['TRN-01'])
  assert.deepEqual(s.falsePositives, [])
  assert.deepEqual(s.decoys.map((d) => [d.ref, d.detected]), [['IAM-02', false], ['IAM-04', false], ['DATA-01', false]])
  assert.deepEqual(s.trapSupports, [])
  assert.deepEqual(s.failures, [])
})

test('misses, false positives, wrong pairs, unverified quotes and trap support are all counted', () => {
  const results = perfect()
  const get = (ref: string) => results.find((r) => r.ref === ref)!
  get('VULN-02').conflict = { status: 'none', explanation: 'missed' }
  get('IAM-02').conflict = get('IAM-01').conflict                                    // decoy flagged
  const trn02 = get('TRN-02').conflict
  if (trn02.status === 'detected') trn02.conflict.b = passage({ doc: 'soc2', page: 9, anchor: 'x' })   // wrong document
  get('GOV-01').passages[0].quote_verified = false                                    // unverified quote is not a hit
  get('DATA-04').passages.push(passage({ doc: 'policy', page: 6, anchor: 'records retention' }))

  const s = scoreEvidence(gold, results)
  assert.deepEqual([s.conflictRecall.caught, s.conflictRecall.total], [2, 3])
  assert.equal(s.conflictRecall.outcomes.find((o) => o.ref === 'TRN-02')?.pairCorrect, false)
  assert.deepEqual(s.falsePositives.map((o) => o.ref), ['IAM-02'])
  assert.equal(s.evidenceRecall.total - s.evidenceRecall.hit, 1)
  assert.deepEqual(s.perQuestionRecall.find((q) => q.ref === 'GOV-01')?.missed, ['policy p.1'])
  assert.deepEqual(s.trapSupports.map((t) => t.ref), ['DATA-04'])
})

test('spreadsheet evidence matches when the gold row falls inside the cited range', () => {
  const results = perfect()
  const iam04 = results.find((r) => r.ref === 'IAM-04')!
  for (const p of iam04.passages) if (p.locator && 'sheet' in p.locator) p.locator = { ...p.locator, row_start: 2, row_end: 32 }
  const s = scoreEvidence(gold, results)
  assert.equal(s.perQuestionRecall.find((q) => q.ref === 'IAM-04')?.missed.length, 0)
})
