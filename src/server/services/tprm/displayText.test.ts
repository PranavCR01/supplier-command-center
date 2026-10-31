import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { EvidencePassage } from '../../../types/index.js'
import { closestLines, namePassages, reflow, uniqueByLocation } from '../../../client/components/security-review/text.js'

// Tests for the UI's display-only text helpers (they live in the client but have no browser code)

const SOC2_P11 = `CC6.2 User access to production systems
and the identity provider is reviewed
quarterly by system owners.
Exception noted. For the Q2
2026 access review, 2 of 25
sampled accounts were late.
CC6.3 Access for terminated personnel is
removed within one business day.`

test('reflow joins lines broken mid-sentence and keeps real line breaks', () => {
  assert.equal(reflow(SOC2_P11), [
    'CC6.2 User access to production systems and the identity provider is reviewed quarterly by system owners.',
    'Exception noted. For the Q2 2026 access review, 2 of 25 sampled accounts were late.',
    'CC6.3 Access for terminated personnel is removed within one business day.',
  ].join('\n'))
  assert.equal(reflow('Field Value\nVersion 3.2\nEffective date January 15, 2026'), 'Field Value\nVersion 3.2\nEffective date January 15, 2026',
    'table rows that start with a capital stay on their own lines')
})

test('closestLines finds the table rows an approximate quote was assembled from', () => {
  const page = 'Information Security and Access Control Policy\nField Value\nVersion 3.2\nEffective date January 15, 2026\nPolicy owner Daniel Ortiz\n1. Purpose and Scope'
  const quote = 'Version 3.2, Effective date January 15, 2026, Policy owner Daniel Ortiz'
  assert.deepEqual(closestLines(page, quote), [2, 3, 4])
  assert.deepEqual(closestLines(page, 'something unrelated entirely'), [])
})

const passage = (filename: string, page: number, verified = true): EvidencePassage => ({
  document_id: filename, filename, locator: { page }, quote: 'q', stance: 'supports', note: '', quote_verified: verified, failure: null, relocated_from: null,
})

test('namePassages counts only verified passages, like the conflict check did', () => {
  const evidence = [passage('policy.pdf', 3), passage('bad.pdf', 9, false), passage('pentest.pdf', 2)]
  assert.equal(namePassages('P1 conflicts with P2; P7 is unknown.', evidence), 'policy (p. 3) conflicts with pentest (p. 2); P7 is unknown.')
})

test('uniqueByLocation keeps one chip per document page', () => {
  const chips = uniqueByLocation([passage('pentest.pdf', 3), passage('pentest.pdf', 3), passage('pentest.pdf', 2), passage('soc2.pdf', 3)])
  assert.deepEqual(chips.map((c) => `${c.filename}:${'page' in c.locator! ? c.locator.page : ''}`), ['pentest.pdf:3', 'pentest.pdf:2', 'soc2.pdf:3'])
})
