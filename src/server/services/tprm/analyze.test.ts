import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { SecurityDocument } from '../../../types/index.js'
import { analyzeDocument, analyzeRequestDocuments, ExtractionSchema, PROMPTS } from './analyze.js'
import { checkCitation } from './citations.js'
import { ingestDocument } from './ingest.js'
import { toOutputSchema } from './llm.js'
import { MemorySecurityReviewStore } from './memoryStore.js'
import { FakeReply, FakeTprmLlm } from './testing/fakeLlm.js'

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/documents')

let store: MemorySecurityReviewStore

async function ingest(file: string): Promise<SecurityDocument> {
  const { document } = await ingestDocument(
    { store, supplierId: 'sup-1', requestId: 'req-1', userId: 'u-1' },
    { filename: file, data: new Uint8Array(fs.readFileSync(path.join(SAMPLES, file))) },
  )
  return document
}

const ctx = (llm: FakeTprmLlm) => ({ store, llm, supplierId: 'sup-1', requestId: 'req-1' })
const loc = (page: number | null, sheet: string | null = null, row: number | null = null) => ({ page, sheet, row })

// Extraction output for the pen test summary with one of each problem the code must catch
const PENTEST_EXTRACTION = {
  doc_type: 'pentest_summary',
  doc_type_reason: 'Lists penetration test findings with severity and status.',
  findings: [
    { kind: 'pentest_finding', ref: 'PT-01', title: 'VPN firmware RCE', stated_severity: 'Critical', status: 'open', detail: null,
      location: loc(3), quote: 'the finding remains open, 45 days after it was reported' },
    // invented quote: the page never says this
    { kind: 'pentest_finding', ref: 'PT-03', title: 'Admin portal without MFA', stated_severity: 'High', status: 'open', detail: null,
      location: loc(3), quote: 'The admin portal has no MFA and was exploited by the testers' },
    // page that does not exist (4-page document)
    { kind: 'pentest_finding', ref: 'PT-02', title: 'Stored XSS', stated_severity: 'High', status: 'remediated', detail: null,
      location: loc(9), quote: 'Stored cross-site scripting in customer portal ticket comments' },
    // severity the page never states
    { kind: 'pentest_finding', ref: 'PT-05', title: 'Session timeout', stated_severity: 'Severe', status: 'open', detail: null,
      location: loc(2), quote: 'Session timeout of 24 hours on the customer portal' },
    // wrong kind for a pen test
    { kind: 'control', ref: 'CC6.1', title: 'MFA', stated_severity: null, status: 'no_exceptions', detail: null,
      location: loc(2), quote: 'Summary of Findings' },
    // no location at all
    { kind: 'pentest_finding', ref: 'PT-06', title: 'Headers', stated_severity: 'Low', status: 'open', detail: null,
      location: loc(null), quote: 'Missing HTTP security headers on marketing site' },
  ],
}

const PENTEST_SUMMARY = {
  headline: 'Redline Assurance Group pen test summary, August 2026, retest October 5, 2026.',
  top_findings: [
    { text: 'One critical and two high findings.', location: loc(2), quote: 'Redline identified 1 critical, 2 high, 2 medium, and 2 low severity findings' },
  ],
  key_exceptions: [
    // number changed from 45 to 54: must fail verification
    { text: 'Critical VPN finding still open.', location: loc(3), quote: 'the finding remains open, 54 days after it was reported' },
  ],
  takeaways: [
    // quote is real, but the text adds a number the page never states (computed overdue days)
    { text: 'PT-01: open 30 days past the 15-day SLA.', location: loc(3), quote: 'the finding remains open, 45 days after it was reported' },
  ],
}

function pentestLlm(overrides: Record<string, FakeReply> = {}) {
  return new FakeTprmLlm({
    [PROMPTS.extract]: { json: PENTEST_EXTRACTION },
    [PROMPTS.summarize]: { json: PENTEST_SUMMARY },
    ...overrides,
  })
}

beforeEach(() => {
  store = new MemorySecurityReviewStore()
})

describe('analyzeDocument', () => {
  test('classifies, stores checked findings and a checked summary card', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    const result = await analyzeDocument(ctx(pentestLlm()), doc)

    assert.equal(result.status, 'analyzed')
    // severity cleared twice: PT-05 ("Severe" not on its page) and PT-02 (its page doesn't exist)
    assert.deepEqual(result.findings, {
      extracted: 6, kept: 4, quote_verified: 2, dropped_wrong_kind: 1, dropped_no_location: 1, severity_cleared: 2, relocated: 0,
    })

    const byRef = Object.fromEntries(store.findings.map((f) => [f.ref, f]))
    assert.equal(byRef['PT-01'].quote_verified, true)
    assert.equal(byRef['PT-01'].stated_severity, 'Critical')
    assert.deepEqual(byRef['PT-01'].locator, { page: 3 })
    assert.equal(byRef['PT-03'].quote_verified, false, 'invented quote must not verify')
    assert.equal(byRef['PT-02'].quote_verified, false, 'page 9 does not exist')
    assert.equal(byRef['PT-05'].stated_severity, null, 'severity not on the page is cleared')
    assert.equal(byRef['PT-05'].quote_verified, true)
    assert.ok(store.findings.every((f) => f.prompt_version === PROMPTS.extract))

    const saved = store.documents[0]
    assert.equal(saved.doc_type, 'pentest_summary')
    assert.equal(saved.doc_type_source, 'ai')
    assert.equal(saved.analysis_status, 'analyzed')
    assert.equal(saved.summary_prompt_version, PROMPTS.summarize)
    assert.equal(saved.summary?.top_findings[0].quote_verified, true)
    assert.equal(saved.summary?.key_exceptions[0].quote_verified, false, 'changed number must fail')
    assert.equal(saved.summary?.key_exceptions[0].failure, 'QUOTE_NOT_FOUND')
    assert.deepEqual(saved.summary?.top_findings[0].unsupported_numbers, [])
    assert.equal(saved.summary?.takeaways[0].quote_verified, true)
    assert.deepEqual(saved.summary?.takeaways[0].unsupported_numbers, ['30', '15'], 'computed numbers are flagged')

    const events = store.events.map((e) => e.event_type)
    assert.deepEqual(events.slice(-3), ['document_classified', 'findings_extracted', 'document_summarized'])
    assert.equal(store.events.at(-1)?.actor, 'ai')
  })

  test('summary prompt sees the kept findings, not the dropped ones', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    const llm = pentestLlm()
    await analyzeDocument(ctx(llm), doc)
    const summaryCall = llm.calls.find((c) => c.task === PROMPTS.summarize)
    assert.ok(summaryCall?.input?.includes('PT-01'))
    assert.ok(!summaryCall?.input?.includes('CC6.1'))
    assert.match(summaryCall!.context, /<page number="3">/)
  })

  test('schema-invalid model output fails the document without throwing', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    const llm = pentestLlm({ [PROMPTS.extract]: { json: { doc_type: 'pen_test', findings: 'none' } } })
    const result = await analyzeDocument(ctx(llm), doc)
    assert.equal(result.status, 'failed')
    assert.match(result.error!, /^extract: schema_invalid/)
    assert.equal(store.documents[0].analysis_status, 'failed')
    assert.equal(store.findings.length, 0)
    assert.equal(store.events.at(-1)?.event_type, 'document_analysis_failed')
    assert.equal(llm.calls.length, 1, 'no summary call after a failed extraction')
  })

  test('non-JSON output is schema_invalid', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    const result = await analyzeDocument(ctx(pentestLlm({ [PROMPTS.extract]: { raw: 'Sure! Here are the findings:' } })), doc)
    assert.match(result.error!, /schema_invalid: not JSON/)
  })

  test('summary failure keeps the extracted findings', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    const result = await analyzeDocument(ctx(pentestLlm({ [PROMPTS.summarize]: { apiError: 'overloaded' } })), doc)
    assert.equal(result.status, 'failed')
    assert.match(result.error!, /^summarize: api_error: overloaded/)
    assert.equal(store.findings.length, 4)
    assert.equal(store.documents[0].summary, null)
  })

  test('an unexpected throw marks the document failed instead of leaving it running', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    store.listUnits = async () => { throw new Error('db down') }
    const result = await analyzeDocument(ctx(pentestLlm()), doc)
    assert.equal(result.status, 'failed')
    assert.equal(store.documents[0].analysis_status, 'failed')
    assert.match(store.documents[0].analysis_error!, /internal: db down/)
  })

  test("a vendor-set doc type wins over the model's and filters kinds by it", async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    await store.updateDocument(doc.id, { doc_type: 'security_policy', doc_type_source: 'user' })
    const llm = pentestLlm()
    const result = await analyzeDocument(ctx(llm), (await store.getDocument(doc.id, 'sup-1'))!)
    assert.equal(result.docType, 'security_policy')
    assert.equal(store.documents[0].doc_type_source, 'user')
    assert.match(llm.calls[0].input ?? '', /confirmed this document's type is "security_policy"/)
    assert.equal(store.findings.length, 0, 'pentest findings are not allowed on a policy')
    assert.ok(!store.events.some((e) => e.event_type === 'document_classified'))
  })

  test('re-analysis replaces findings instead of duplicating them', async () => {
    const doc = await ingest('acme_pentest_summary_2026.pdf')
    await analyzeDocument(ctx(pentestLlm()), doc)
    await analyzeDocument(ctx(pentestLlm()), doc)
    assert.equal(store.findings.length, 4)
  })

  test('questionnaires and unparsed documents are skipped without a model call', async () => {
    const q = await ingest('clearfield_vendor_security_questionnaire.xlsx')
    const llm = pentestLlm()
    assert.equal((await analyzeDocument(ctx(llm), q)).status, 'skipped')
    assert.equal(llm.calls.length, 0)
  })

  test('analyzeRequestDocuments covers every evidence document', async () => {
    await ingest('acme_pentest_summary_2026.pdf')
    await ingest('acme_phishing_simulation_summary_2026.pdf')
    await ingest('clearfield_vendor_security_questionnaire.xlsx')
    const results = await analyzeRequestDocuments(ctx(pentestLlm()), 2)
    assert.equal(results.length, 2)
    assert.ok(results.every((r) => r.status === 'analyzed'))
  })
})

describe('checkCitation on spreadsheets', () => {
  test('quote must be in the cited row, not just the same 25-row unit', async () => {
    const doc = await ingest('acme_access_review_q2_2026.xlsx')
    const units = await store.listUnits(doc.id)
    const at = (row: number, sheet = 'Q2-2026 Review') => checkCitation(units, loc(null, sheet, row), 'User: ctr.mbaker')

    const ok = at(27)
    assert.equal(ok.verified, true)
    assert.deepEqual(ok.locator, { sheet: 'Q2-2026 Review', row_start: 27, row_end: 27 })
    // row 28 is in the same unit as row 27 (rows 27-32): a unit-level check would accept row 28
    // as cited; the row-level check finds the quote only in row 27 and corrects the citation
    const wrongRow = at(28)
    assert.equal(wrongRow.verified, true)
    assert.deepEqual(wrongRow.locator, { sheet: 'Q2-2026 Review', row_start: 27, row_end: 27 })
    assert.deepEqual(wrongRow.verified && wrongRow.relocatedFrom, { sheet: 'Q2-2026 Review', row_start: 28, row_end: 28 })
    const invented = checkCitation(units, loc(null, 'Q2-2026 Review', 27), 'User: ctr.nobody')
    assert.equal(invented.verified === false && invented.failure, 'QUOTE_NOT_FOUND')
    const noSheet = at(27, 'Q3 Review')
    assert.equal(noSheet.verified === false && noSheet.failure, 'PAGE_OUT_OF_RANGE')
    const none = checkCitation(units, loc(null), 'User: ctr.mbaker')
    assert.equal(none.verified === false && none.failure, 'NO_LOCATION')
  })

  test('sheet names match case-insensitively and keep the real name', async () => {
    const doc = await ingest('acme_access_review_q2_2026.xlsx')
    const check = checkCitation(await store.listUnits(doc.id), loc(null, 'summary', 7), 'Removed late (more than 10 business days) | Value: 2')
    assert.equal(check.verified, true)
    assert.deepEqual(check.locator, { sheet: 'Summary', row_start: 7, row_end: 7 })
  })
})

describe('checkCitation on PDFs', () => {
  test('a real quote cited to the wrong page is relocated to the one page that has it', async () => {
    const doc = await ingest('acme_soc2_type2_2026.pdf')
    const units = await store.listUnits(doc.id)
    const check = checkCitation(units, loc(11), 'using separate administrative accounts')
    assert.equal(check.verified, true)
    assert.deepEqual(check.locator, { page: 12 })
    assert.deepEqual(check.verified && check.relocatedFrom, { page: 11 })
    assert.equal(checkCitation(units, loc(12), 'using separate administrative accounts').verified && 'ok', 'ok')
  })

  test('ambiguous, approximate-only, and other-document quotes are not relocated', async () => {
    const soc2 = await store.listUnits((await ingest('acme_soc2_type2_2026.pdf')).id)
    const many = checkCitation(soc2, loc(1), 'No exceptions noted.')                  // on most control pages
    assert.equal(many.verified === false && many.failure, 'QUOTE_NOT_FOUND')
    // approximately matches p.12 only ("via" for "through"); approximate is not enough to move a citation
    const near = checkCitation(soc2, loc(11), 'Customer data at rest is encrypted using AES-256 via AWS Key Management Service')
    assert.equal(near.verified === false && near.failure, 'QUOTE_NOT_FOUND')
    const pentestText = checkCitation(soc2, loc(1), 'Report issued: September 4, 2026')  // from the pen test
    assert.equal(pentestText.verified, false)
    const missing = checkCitation(soc2, loc(40), 'using separate administrative accounts')
    assert.equal(missing.verified === false && missing.failure, 'PAGE_OUT_OF_RANGE', 'a page that does not exist is never relocated')
  })
})

describe('output schema', () => {
  test('keeps enums and closes objects; strips keywords the API rejects', () => {
    const schema = toOutputSchema(ExtractionSchema)
    const json = JSON.stringify(schema)
    assert.ok(!json.includes('$schema'))
    assert.ok(!json.includes('"minimum"'))
    assert.ok(json.includes('"soc2_report"'))
    assert.equal(schema.additionalProperties, false)
  })
})
