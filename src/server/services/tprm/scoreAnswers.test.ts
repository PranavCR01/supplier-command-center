import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AnswerEvidence, AnswerValue, DraftedAnswer, Readiness } from '../../../types/index.js'
import { GoldAnswers, scoreAnswers } from './scoreAnswers.js'
import { GoldLocation } from './scoreEvidence.js'

const gold = JSON.parse(fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/gold.json'), 'utf-8',
)) as GoldAnswers

function evidence(g: GoldLocation): AnswerEvidence {
  return {
    document_id: g.doc, filename: gold.documents[g.doc].file, quote: g.anchor, stance: 'supports', note: '',
    quote_verified: true, failure: null, relocated_from: null, cited: true,
    locator: g.page !== undefined ? { page: g.page } : { sheet: g.sheet!, row_start: g.row!, row_end: g.row! },
  }
}

// The answers a perfect pipeline would give, built from gold
function perfect(): DraftedAnswer[] {
  return gold.questions.map((q) => ({
    question_ref: q.ref, question_row: 0, domain: null, question_text: '', answer: q.expected_answer as AnswerValue,
    response_text: (q.must_mention ?? []).join(' and '), evidence: q.evidence.map(evidence), conflict: null, verifier: null,
    model_confidence: 0.9, readiness: q.expected_readiness as Readiness,
    reasons: (q.expected_reasons ?? []) as DraftedAnswer['reasons'], unsupported_numbers: [], errors: [],
  }))
}

test('a perfect run: no unsafe Ready, full recall, no false positives, 12 Ready', () => {
  const s = scoreAnswers(gold, perfect())
  assert.deepEqual(s.unsafeReady, [])
  assert.deepEqual(s.conflictRecall, { caught: ['IAM-01', 'VULN-02', 'TRN-02'], missed: [] })
  assert.deepEqual(s.conflictFalsePositives, [])
  assert.deepEqual(s.needsEvidenceRecall.missed, [])
  assert.equal(s.needsEvidenceRecall.caught.length, 6)
  assert.equal(s.readyCount, 12)
  assert.deepEqual(s.readinessAccuracy, { correct: 22, total: 22 })
  assert.deepEqual(s.answerAccuracy, { correct: 22, total: 22 })
  assert.equal(s.citationAccuracy.correct, s.citationAccuracy.total)
  assert.equal(s.mustMention.correct, s.mustMention.total)
})

test('unsafe Ready: gold says not Ready, or Ready with a wrong answer', () => {
  const answers = perfect()
  const set = (ref: string, patch: Partial<DraftedAnswer>) => Object.assign(answers.find((a) => a.question_ref === ref)!, patch)
  set('IAM-03', { readiness: 'ready', reasons: [] })                 // trap marked Ready
  set('DATA-02', { answer: 'no' })                                     // Ready but wrong answer
  set('BCP-02', { readiness: 'ready', answer: 'yes' })                 // fabricated RTO marked Ready
  set('IAM-01', { readiness: 'needs_evidence' })                       // missed conflict (safe, but a miss)
  set('IAM-02', { readiness: 'conflict' })                             // decoy flagged
  set('TRN-01', { readiness: 'needs_evidence' })                       // acceptable alternative
  set('IAM-04', { readiness: 'conflict' })                             // acceptable since gold 2026-10-31.1

  const s = scoreAnswers(gold, answers)
  assert.deepEqual(s.unsafeReady, ['IAM-03', 'DATA-02', 'BCP-02'])
  assert.deepEqual(s.conflictRecall.missed, ['IAM-01'])
  assert.deepEqual(s.conflictFalsePositives, ['IAM-02'])
  assert.deepEqual(s.decoysFlagged, ['IAM-02'])
  assert.deepEqual(s.needsEvidenceRecall.missed, ['IAM-03', 'BCP-02'])
  assert.ok(s.outcomes.find((o) => o.ref === 'TRN-01')!.readinessOk)
  assert.ok(s.outcomes.find((o) => o.ref === 'IAM-04')!.readinessOk, 'IAM-04 as Conflict is not a false positive')
})

test('citations outside the gold locations and missing mentions are counted', () => {
  const answers = perfect()
  const gov02 = answers.find((a) => a.question_ref === 'GOV-02')!
  gov02.evidence.push({ ...gov02.evidence[0], locator: { page: 9 } })
  gov02.response_text = 'We have a report.'
  const s = scoreAnswers(gold, answers)
  assert.equal(s.citationAccuracy.total - s.citationAccuracy.correct, 1)
  assert.deepEqual(s.outcomes.find((o) => o.ref === 'GOV-02')!.missingMentions, ['June 30, 2026'])
})

test('a question with no answer counts as held back, never unsafe', () => {
  const s = scoreAnswers(gold, perfect().filter((a) => a.question_ref !== 'GOV-01'))
  assert.deepEqual(s.unsafeReady, [])
  assert.equal(s.outcomes.find((o) => o.ref === 'GOV-01')!.readinessOk, false)
})
