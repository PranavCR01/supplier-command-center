import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideReadiness, ReadinessInput } from './readiness.js'

const CLEAN: ReadinessInput = {
  conflictDetected: false, callFailed: false, citedVerified: 2, answerNotAddressed: false, answerAdmitsGap: false, citedOutOfRange: false,
  quoteFailures: [], unsupportedNumbers: [], reliesOnException: false, reliesOnCarveOut: false,
  verifierVerdict: 'supported', confidence: 0.9,
}
const decide = (patch: Partial<ReadinessInput>) => decideReadiness({ ...CLEAN, ...patch })

test('ready only when every rule passes', () => {
  assert.deepEqual(decide({}), { readiness: 'ready', reasons: [] })
})

test('each rule holds an answer back with its reason code', () => {
  const cases: [Partial<ReadinessInput>, string][] = [
    [{ callFailed: true }, 'SCHEMA_INVALID'],
    [{ citedVerified: 0 }, 'NO_EVIDENCE'],
    [{ answerNotAddressed: true }, 'NO_EVIDENCE'],
    [{ citedOutOfRange: true }, 'PAGE_OUT_OF_RANGE'],
    [{ quoteFailures: ['NO_LOCATION'] }, 'PAGE_OUT_OF_RANGE'],
    [{ quoteFailures: ['QUOTE_NOT_FOUND'] }, 'QUOTE_NOT_FOUND'],
    [{ quoteFailures: ['LOW_TEXT'] }, 'LOW_TEXT'],
    [{ unsupportedNumbers: ['4'] }, 'UNSUPPORTED_NUMBER'],
    [{ reliesOnException: true }, 'CONTROL_EXCEPTION'],
    [{ reliesOnCarveOut: true }, 'CARVE_OUT'],
    [{ answerAdmitsGap: true }, 'GAP_DISCLOSED'],
    [{ verifierVerdict: 'unsupported' }, 'VERIFIER_UNSUPPORTED'],
    [{ verifierVerdict: 'partially_supported' }, 'VERIFIER_PARTIAL'],
    [{ confidence: 0.69 }, 'LOW_CONFIDENCE'],
    [{ confidence: null }, 'LOW_CONFIDENCE'],
  ]
  for (const [patch, reason] of cases) {
    assert.deepEqual(decide(patch), { readiness: 'needs_evidence', reasons: [reason] }, reason)
  }
})

test('conflict wins over everything; all reasons are kept in rule order', () => {
  assert.deepEqual(decide({ verifierVerdict: 'partially_supported', conflictDetected: true, reliesOnException: true }), {
    readiness: 'conflict', reasons: ['CONFLICT', 'CONTROL_EXCEPTION', 'VERIFIER_PARTIAL'],
  })
})

test('high model confidence never overrides a failed check', () => {
  assert.equal(decide({ confidence: 1, verifierVerdict: 'unsupported' }).readiness, 'needs_evidence')
  assert.deepEqual(decide({ confidence: 1, verifierVerdict: null }), { readiness: 'needs_evidence', reasons: ['VERIFIER_UNSUPPORTED'] },
    'a skipped verifier never defaults to Ready')
  assert.deepEqual(decide({ citedVerified: 0, verifierVerdict: null }).reasons, ['NO_EVIDENCE'], 'no extra reason when already held back')
  assert.deepEqual(decide({ answerNotAddressed: true, confidence: null, verifierVerdict: null }).reasons, ['NO_EVIDENCE'],
    'no "low confidence" when nothing was drafted')
  assert.equal(decide({ confidence: 0.7 }).readiness, 'ready', '0.7 is the threshold')
})
