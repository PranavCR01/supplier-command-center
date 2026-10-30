import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchQuote, normalizeForMatch, numbersNotInSource } from './parsers.js'

const PAGE = `CC6.2 User access to production systems
and the identity provider is reviewed
quarterly by system owners.
Exception noted. For the Q2
2026 access review, 2 of 25
sampled accounts marked for
removal were not removed
until 41 days after review
sign-off.`

test('normalization collapses whitespace, case, smart quotes and dashes', () => {
  assert.equal(normalizeForMatch('  Acme’s  “MFA” – Policy\n'), 'acme\'s "mfa" - policy')
})

test('exact match across line breaks', () => {
  const m = matchQuote(PAGE, '2 of 25 sampled accounts marked for removal were not removed until 41 days after review sign-off.')
  assert.equal(m.found, 'exact')
})

test('small wording drift is approximate', () => {
  const m = matchQuote(PAGE, 'For the Q2 2026 access review, 2 of 25 sampled accounts marked for removal were not removed until 41 days after the review sign-off')
  assert.equal(m.found, 'approximate')
})

test('a changed number never matches, however close the wording', () => {
  const m = matchQuote(PAGE, '2 of 25 sampled accounts marked for removal were not removed until 14 days after review sign-off')
  assert.equal(m.found, 'no')
})

test('a fabricated claim does not match', () => {
  const m = matchQuote(PAGE, 'All accounts marked for removal were removed within 10 business days')
  assert.equal(m.found, 'no')
})

test('common words scattered across a page do not add up to a match', () => {
  const m = matchQuote(PAGE, 'the access to the production systems is reviewed by the owners')
  assert.equal(m.found, 'no')
})

test('empty quote does not match', () => {
  assert.equal(matchQuote(PAGE, '   ').found, 'no')
})

test('numbers a claim adds to its source are reported', () => {
  assert.deepEqual(numbersNotInSource('2 of 25 accounts removed 41 days after sign-off', PAGE), [])
  assert.deepEqual(numbersNotInSource('Removed 31 days late, in Q2 2026', PAGE), ['31'])
  assert.deepEqual(numbersNotInSource('Click rate fell to 14%', 'click rate 14 percent'), ['14%'])
  assert.deepEqual(numbersNotInSource('TLS 1.2 or higher', 'TLS 1.2 or higher'), [])
  assert.deepEqual(numbersNotInSource('PT-01 and CC6.2 open since Q4, FY2026', 'nothing numeric here'), [])
  assert.deepEqual(numbersNotInSource('PT-01: open 46 days', 'PT-01 open 45 days'), ['46'])
  assert.deepEqual(numbersNotInSource('Our SOC 2 Type 2 report', 'Type II report issued by the auditor'), [])
  assert.deepEqual(numbersNotInSource('Type 2 scans run 2 times', 'Type II scans'), ['2'], 'a real quantity still counts')
})
