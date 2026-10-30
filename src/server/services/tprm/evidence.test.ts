import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildEvidenceContext, EVIDENCE_PROMPTS, EvidenceContext, gatherAllEvidence, gatherQuestionEvidence } from './evidence.js'
import { ingestDocument } from './ingest.js'
import { MemorySecurityReviewStore } from './memoryStore.js'
import { QuestionnaireItem } from './parsers.js'
import { runPool } from './pool.js'
import { FakeReply, FakeTprmLlm } from './testing/fakeLlm.js'

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/documents')
const loc = (page: number | null, sheet: string | null = null, row: number | null = null) => ({ page, sheet, row })

const IAM01: QuestionnaireItem = {
  ref: 'IAM-01', domain: 'Identity and Access Management', row: 5,
  question: 'Is multi-factor authentication enforced for all interactive access, including administrative interfaces?',
}

let store: MemorySecurityReviewStore
let ev: EvidenceContext

beforeEach(async () => {
  store = new MemorySecurityReviewStore()
  for (const file of fs.readdirSync(SAMPLES).filter((f) => /\.(pdf|xlsx)$/.test(f))) {
    await ingestDocument(
      { store, supplierId: 's', requestId: 'r', userId: null },
      { filename: file, data: new Uint8Array(fs.readFileSync(path.join(SAMPLES, file))) },
    )
  }
  ev = await buildEvidenceContext(store, 'r')
})

// Sorted by filename: D1 access review, D2 policy, D3 pen test, D4 phishing, D5 SOC 2
const POLICY_MFA = { document: 'D2', location: loc(3), stance: 'supports', note: 'policy',
  quote: 'Multi-factor authentication is enforced for all interactive access to Acme systems, including administrative interfaces' }
const PENTEST_MFA = { document: 'D3', location: loc(3), stance: 'contradicts', note: 'pen test',
  quote: 'accepts a username and password without requiring multi-factor authentication' }
const SOC2_VPN = { document: 'D5', location: loc(11), stance: 'supports', note: 'soc2',
  quote: 'Multi-factor authentication is required for remote access to the production network via VPN' }
const INVENTED = { document: 'D5', location: loc(11), stance: 'supports', note: 'made up',
  quote: 'MFA is enforced on the administrative portal for all staff' }

const llmWith = (passages: unknown[], conflict: FakeReply | ((i: string | undefined, c: string) => FakeReply)) =>
  new FakeTprmLlm({ [EVIDENCE_PROMPTS.gather]: { json: { passages } }, [EVIDENCE_PROMPTS.conflict]: conflict })

describe('evidence context', () => {
  test('all parsed evidence, stable ids by filename, questionnaire excluded', () => {
    assert.deepEqual(ev.docs.map((d) => [d.key, d.document.filename]), [
      ['D1', 'acme_access_review_q2_2026.xlsx'],
      ['D2', 'acme_infosec_access_control_policy_v3.2.pdf'],
      ['D3', 'acme_pentest_summary_2026.pdf'],
      ['D4', 'acme_phishing_simulation_summary_2026.pdf'],
      ['D5', 'acme_soc2_type2_2026.pdf'],
    ])
    assert.match(ev.text, /<document id="D3" filename="acme_pentest_summary_2026.pdf">/)
    assert.ok(!ev.text.includes('clearfield'))
  })
})

describe('gatherQuestionEvidence', () => {
  test('checks every quote; conflict check sees only verified passages and returns the clashing pair', async () => {
    const llm = llmWith(
      [POLICY_MFA, PENTEST_MFA, SOC2_VPN, INVENTED, { ...POLICY_MFA }, { ...PENTEST_MFA, document: 'D9' }],
      { json: { conflict: true, a: 1, b: 2, explanation: 'Policy says MFA everywhere; pen test found the admin portal without it.' } },
    )
    const r = await gatherQuestionEvidence(llm, ev, IAM01)

    assert.equal(r.status, 'ok')
    assert.equal(r.passages.length, 5, 'exact duplicate removed')
    assert.deepEqual(r.passages.map((p) => [p.quote_verified, p.failure]), [
      [true, null], [true, null], [true, null], [false, 'QUOTE_NOT_FOUND'], [false, 'PAGE_OUT_OF_RANGE'],
    ])
    assert.equal(r.passages[1].filename, 'acme_pentest_summary_2026.pdf')

    const conflictCall = llm.calls.find((c) => c.task === EVIDENCE_PROMPTS.conflict)!
    assert.match(conflictCall.context, /\[P3\] D5/)
    assert.ok(!conflictCall.context.includes('MFA is enforced on the administrative portal'), 'unverified passage not shown')
    assert.ok(!conflictCall.context.includes('<evidence>'), 'conflict step never sees the full documents')

    assert.equal(r.conflict.status, 'detected')
    if (r.conflict.status === 'detected') {
      assert.equal(r.conflict.conflict.a?.filename, 'acme_infosec_access_control_policy_v3.2.pdf')
      assert.equal(r.conflict.conflict.b?.filename, 'acme_pentest_summary_2026.pdf')
    }
  })

  test('the gather call carries the question as untrusted input after the cached evidence', async () => {
    const llm = llmWith([], { json: { conflict: false, a: null, b: null, explanation: '' } })
    await gatherQuestionEvidence(llm, ev, IAM01)
    assert.equal(llm.calls[0].context, ev.text)
    assert.match(llm.calls[0].input!, /<question ref="IAM-01" domain="Identity and Access Management">/)
  })

  test('no conflict call when verified evidence comes from one document', async () => {
    const llm = llmWith([POLICY_MFA, { ...PENTEST_MFA, quote: 'invented text' }], () => { throw new Error('should not be called') })
    const r = await gatherQuestionEvidence(llm, ev, IAM01)
    assert.equal(r.conflict.status, 'not_needed')
    assert.equal(llm.calls.length, 1)
  })

  test('a reported conflict with an invalid pair still routes to conflict, without a pair', async () => {
    const r = await gatherQuestionEvidence(llmWith([POLICY_MFA, PENTEST_MFA], { json: { conflict: true, a: 1, b: 7, explanation: 'x' } }), ev, IAM01)
    assert.equal(r.conflict.status, 'detected')
    if (r.conflict.status === 'detected') assert.equal(r.conflict.conflict.a, null)
  })

  test('a pair from the same document is not a conflict between documents', async () => {
    const POLICY_REMOTE = { document: 'D2', location: loc(3), stance: 'supports', note: 'policy', quote: 'including administrative interfaces and remote access' }
    const r = await gatherQuestionEvidence(llmWith([POLICY_MFA, PENTEST_MFA, POLICY_REMOTE], { json: { conflict: true, a: 1, b: 3, explanation: 'x' } }), ev, IAM01)
    assert.equal(r.conflict.status, 'detected')
    if (r.conflict.status === 'detected') assert.equal(r.conflict.conflict.a, null)
  })

  test('compatible passages: no conflict', async () => {
    const r = await gatherQuestionEvidence(llmWith([POLICY_MFA, SOC2_VPN], { json: { conflict: false, a: null, b: null, explanation: 'VPN is in scope of both.' } }), ev, IAM01)
    assert.deepEqual(r.conflict, { status: 'none', explanation: 'VPN is in scope of both.' })
  })

  test('failures are reported, not thrown', async () => {
    const gatherFail = await gatherQuestionEvidence(new FakeTprmLlm({ [EVIDENCE_PROMPTS.gather]: { raw: '{"passages": "lots"}' } }), ev, IAM01)
    assert.equal(gatherFail.status, 'failed')
    assert.match(gatherFail.error!, /^gather: schema_invalid/)

    const conflictFail = await gatherQuestionEvidence(llmWith([POLICY_MFA, PENTEST_MFA], { apiError: 'overloaded' }), ev, IAM01)
    assert.equal(conflictFail.status, 'ok')
    assert.equal(conflictFail.conflict.status, 'failed')
  })

  test('gatherAllEvidence keeps question order', async () => {
    const qs = ['A', 'B', 'C', 'D', 'E'].map((ref, i) => ({ ...IAM01, ref, row: i }))
    const results = await gatherAllEvidence(llmWith([], { json: {} }), ev, qs, 3)
    assert.deepEqual(results.map((r) => r.ref), ['A', 'B', 'C', 'D', 'E'])
  })
})

describe('runPool', () => {
  test('warmFirst finishes the first item before any other starts', async () => {
    const log: string[] = []
    const out = await runPool([1, 2, 3, 4], 3, async (n) => {
      log.push(`start ${n}`)
      await new Promise((r) => setTimeout(r, n === 1 ? 20 : 1))
      log.push(`end ${n}`)
      return n * 10
    }, { warmFirst: true })
    assert.deepEqual(out, [10, 20, 30, 40])
    assert.deepEqual(log.slice(0, 2), ['start 1', 'end 1'])
  })
})
