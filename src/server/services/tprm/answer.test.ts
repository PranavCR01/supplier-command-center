import { before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { DocumentFinding, FindingKind, FindingStatus } from '../../../types/index.js'
import { ANSWER_PROMPTS, draftAnswer, passageUsesFinding } from './answer.js'
import { buildEvidenceContext, checkPassages, EvidenceContext, QuestionEvidence } from './evidence.js'
import { ingestDocument } from './ingest.js'
import { MemorySecurityReviewStore } from './memoryStore.js'
import { QuestionnaireItem } from './parsers.js'
import { FakeReply, FakeTprmLlm } from './testing/fakeLlm.js'

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/documents')
const loc = (page: number | null, sheet: string | null = null, row: number | null = null) => ({ page, sheet, row })

let ev: EvidenceContext
let findings: DocumentFinding[]
const docId = (key: string) => ev.docs.find((d) => d.key === key)!.document.id

// D1 access review, D2 policy, D3 pen test, D4 phishing, D5 SOC 2
const EXCEPTION_QUOTE = '2 of 25 sampled accounts marked for removal were not removed until 41 days after review sign-off'
const CARVE_OUT_QUOTE = 'Physical security and environmental safeguards of the data centers hosting customer data are the responsibility of AWS'
const VPN_QUOTE = 'Multi-factor authentication is required for remote access to the production network via VPN and for access to the AWS management console'

function finding(kind: FindingKind, doc: string, page: number, quote: string, extra: Partial<DocumentFinding> = {}): DocumentFinding {
  return {
    id: quote.slice(0, 10), supplier_id: 's', document_id: docId(doc), kind, ref: null, title: kind, stated_severity: null,
    status: null as FindingStatus | null, detail: null, locator: { page }, quote, quote_verified: true, prompt_version: 'v', created_at: '',
    ...extra,
  }
}

before(async () => {
  const store = new MemorySecurityReviewStore()
  for (const file of fs.readdirSync(SAMPLES).filter((f) => /\.(pdf|xlsx)$/.test(f))) {
    await ingestDocument({ store, supplierId: 's', requestId: 'r', userId: null },
      { filename: file, data: new Uint8Array(fs.readFileSync(path.join(SAMPLES, file))) })
  }
  ev = await buildEvidenceContext(store, 'r')
  findings = [
    finding('control_exception', 'D5', 11, EXCEPTION_QUOTE, { ref: 'CC6.2' }),
    finding('carve_out', 'D5', 7, CARVE_OUT_QUOTE, { title: 'AWS' }),
    finding('pentest_finding', 'D3', 3, 'accepts a username and password without requiring multi-factor authentication',
      { ref: 'PT-03', stated_severity: 'High', status: 'open' }),
  ]
})

const Q: QuestionnaireItem = { ref: 'Q-1', domain: null, row: 2, question: 'Is MFA required for VPN access within 24 hours of hire?' }

function gathered(passages: { document: string; location: ReturnType<typeof loc>; quote: string; stance: string }[],
  conflict: QuestionEvidence['conflict'] = { status: 'not_needed' }): QuestionEvidence {
  const checked = checkPassages(ev, passages.map((p) => ({ ...p, note: '', stance: p.stance as 'supports' })))
  return { ref: Q.ref, question: Q.question, status: 'ok', error: null, passages: checked, conflict, usage: [] }
}

const draft = (answer: string, text: string, cited: number[], confidence = 0.9): FakeReply =>
  ({ json: { response_text: text, answer, cited, confidence } })
const verdict = (v: string): FakeReply => ({ json: { reason: 'checked', verdict: v } })
const llm = (d: FakeReply, v: FakeReply = verdict('supported')) => new FakeTprmLlm({ [ANSWER_PROMPTS.draft]: d, [ANSWER_PROMPTS.verify]: v })

describe('draftAnswer', () => {
  test('supported, cited, confident answer is Ready; verifier sees the full cited page and the date', async () => {
    const fake = llm(draft('yes', 'Acme requires MFA for VPN and AWS console access.', [1]))
    const { answer } = await draftAnswer(fake, ev, findings, Q, gathered([{ document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' }]), '2026-10-30')
    assert.ok(fake.calls.every((c) => c.context.startsWith('<today>2026-10-30</today>')))
    assert.equal(answer.readiness, 'ready')
    assert.deepEqual(answer.reasons, [])
    assert.equal(answer.evidence[0].cited, true)
    const verifyCall = fake.calls.find((c) => c.task === ANSWER_PROMPTS.verify)!
    assert.match(verifyCall.context, /CC6\.2/, 'whole page 11, not just the quote')
    assert.match(verifyCall.context, /<answer label="yes">/)
  })

  test('same page as an auditor exception but different text is not CONTROL_EXCEPTION', async () => {
    const vpn = gathered([{ document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' }]).passages[0]
    assert.equal(passageUsesFinding(ev, vpn, findings[0]), false)
  })

  test('relying on an auditor exception needs a human', async () => {
    const { answer } = await draftAnswer(llm(draft('partial', 'Quarterly reviews; 2 of 25 removals were late.', [1])), ev, findings, Q,
      gathered([{ document: 'D5', location: loc(11), quote: EXCEPTION_QUOTE, stance: 'limits' }]))
    assert.deepEqual(answer.reasons, ['CONTROL_EXCEPTION', 'GAP_DISCLOSED'])
  })

  test('relying on a carve-out needs a human', async () => {
    const { answer } = await draftAnswer(llm(draft('partial', 'Physical security is the responsibility of AWS.', [1])), ev, findings, Q,
      gathered([{ document: 'D5', location: loc(7), quote: CARVE_OUT_QUOTE, stance: 'limits' }]))
    assert.deepEqual(answer.reasons, ['CARVE_OUT', 'GAP_DISCLOSED'])
  })

  test('an open High finding shown to the drafter counts even if the answer does not cite it', async () => {
    const { answer } = await draftAnswer(llm(draft('yes', 'Acme requires MFA for VPN and AWS console access.', [1])), ev, findings, Q, gathered([
      { document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' },
      { document: 'D3', location: loc(3), quote: 'accepts a username and password without requiring multi-factor authentication', stance: 'contradicts' },
    ]))
    assert.deepEqual(answer.reasons, ['CONTROL_EXCEPTION'])
    assert.deepEqual(answer.evidence.map((e) => e.cited), [true, false])
  })

  test('a number not in the cited pages or the question is UNSUPPORTED_NUMBER (the RTO trap)', async () => {
    const g = gathered([{ document: 'D2', location: loc(6), quote: 'which are tested annually', stance: 'supports' }])
    const invented = await draftAnswer(llm(draft('yes', 'Plans are tested annually with an RTO of 4 hours.', [1])), ev, findings, Q, g)
    assert.deepEqual(invented.answer.reasons, ['UNSUPPORTED_NUMBER'])
    assert.deepEqual(invented.answer.unsupported_numbers, ['4'])
    const fromQuestion = await draftAnswer(llm(draft('partial', 'Not 24 hours: plans are tested annually.', [1])), ev, findings, Q, g)
    assert.deepEqual(fromQuestion.answer.unsupported_numbers, [], '24 comes from the question')
  })

  test('no verified evidence: no draft call, not addressed, quote failures recorded', async () => {
    const fake = llm(draft('yes', 'x', [1]))
    const { answer } = await draftAnswer(fake, ev, findings, Q, gathered([{ document: 'D2', location: loc(6), quote: 'RTO is 4 hours', stance: 'supports' }]))
    assert.equal(fake.calls.length, 0)
    assert.equal(answer.answer, 'not_addressed')
    assert.deepEqual(answer.reasons, ['NO_EVIDENCE', 'QUOTE_NOT_FOUND', 'LOW_CONFIDENCE'])
  })

  test('an adverse passage that failed its quote check blocks Ready', async () => {
    const { answer } = await draftAnswer(llm(draft('yes', 'Acme requires MFA for VPN and AWS console access.', [1])), ev, findings, Q, gathered([
      { document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' },
      { document: 'D3', location: loc(3), quote: 'The VPN accepts passwords alone', stance: 'contradicts' },
      { document: 'D3', location: loc(1), quote: 'an invented supporting line', stance: 'supports' },
    ]))
    assert.deepEqual(answer.reasons, ['QUOTE_NOT_FOUND'])
  })

  test('citing a passage that was never given is PAGE_OUT_OF_RANGE and skips the verifier', async () => {
    const fake = llm(draft('yes', 'Acme requires MFA for VPN and AWS console access.', [1, 4]))
    const { answer } = await draftAnswer(fake, ev, findings, Q, gathered([{ document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' }]))
    assert.deepEqual(answer.reasons, ['PAGE_OUT_OF_RANGE'])
    assert.ok(!fake.calls.some((c) => c.task === ANSWER_PROMPTS.verify))
  })

  test('an accurate "partial" or "no" still needs the vendor to sign off on the gap', async () => {
    const g = gathered([{ document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' }])
    for (const label of ['partial', 'no']) {
      const { answer } = await draftAnswer(llm(draft(label, 'MFA for VPN only.', [1])), ev, findings, Q, g)
      assert.deepEqual(answer.reasons, ['GAP_DISCLOSED'], label)
    }
  })

  test('verifier partial and low confidence each hold the answer back', async () => {
    const g = gathered([{ document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' }])
    assert.deepEqual((await draftAnswer(llm(draft('yes', 'MFA for VPN.', [1]), verdict('partially_supported')), ev, findings, Q, g)).answer.reasons, ['VERIFIER_PARTIAL'])
    assert.deepEqual((await draftAnswer(llm(draft('yes', 'MFA for VPN.', [1], 0.5)), ev, findings, Q, g)).answer.reasons, ['LOW_CONFIDENCE'])
  })

  test('conflict: drafter is told, verifier is skipped, readiness is Conflict', async () => {
    const g = gathered([
      { document: 'D2', location: loc(3), quote: 'Multi-factor authentication is enforced for all interactive access to Acme systems', stance: 'supports' },
      { document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' },
    ])
    g.conflict = { status: 'detected', conflict: { a: g.passages[0], b: g.passages[1], explanation: 'clash' } }
    const fake = llm(draft('partial', 'Policy and test disagree.', [1, 2]))
    const { answer } = await draftAnswer(fake, ev, findings, Q, g)
    assert.equal(answer.readiness, 'conflict')
    assert.match(fake.calls[0].context, /<note>A reviewer flagged a possible conflict between P1 and P2: clash<\/note>/)
    assert.ok(!fake.calls.some((c) => c.task === ANSWER_PROMPTS.verify))
  })

  test('a failed draft call is SCHEMA_INVALID with no answer, not "not addressed"', async () => {
    const { answer } = await draftAnswer(llm({ apiError: 'overloaded' }), ev, findings, Q,
      gathered([{ document: 'D5', location: loc(11), quote: VPN_QUOTE, stance: 'supports' }]))
    assert.equal(answer.answer, null)
    assert.equal(answer.readiness, 'needs_evidence')
    assert.equal(answer.reasons[0], 'SCHEMA_INVALID')
    assert.match(answer.errors[0], /^draft: api_error/)
  })
})
