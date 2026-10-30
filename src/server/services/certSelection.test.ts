import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relevantComplianceCerts } from './certSelection.js'

const certs = [
  { name: 'ISO 27001', category: 'security' },
  { name: 'Cyber Liability Insurance', category: 'insurance' },
  { name: 'MBE Certification', category: 'diversity' },
]

test('tag matches by category or name', () => {
  assert.deepEqual(relevantComplianceCerts(certs, ['insurance', 'coupa']).map((c) => c.name), ['Cyber Liability Insurance'])
  assert.deepEqual(relevantComplianceCerts(certs, ['iso 27001']).map((c) => c.name), ['ISO 27001'])
})

test('no matching tag falls back to the first certifications instead of none', () => {
  assert.equal(relevantComplianceCerts(certs, ['unrelated']).length, 3)
  assert.equal(relevantComplianceCerts(Array.from({ length: 8 }, (_, i) => ({ name: `C${i}`, category: 'x' })), []).length, 5)
})
