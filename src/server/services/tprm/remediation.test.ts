import { beforeEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { FindingStatus, SecurityDocType } from '../../../types/index.js'
import { ingestDocument } from './ingest.js'
import { MemorySecurityReviewStore } from './memoryStore.js'
import { addDays, findingDate, generateRemediation, isOverdue, readSla, toJiraCsv } from './remediation.js'
import { NewFinding } from './store.js'

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../test_data/tprm/documents')
const gold = JSON.parse(fs.readFileSync(path.join(SAMPLES, '../gold.json'), 'utf-8')) as {
  findings: { pentest: { ref: string; stated_severity: string; status: string }[] }
  remediation: { required: { ref: string; severity: string }[]; must_not_create: string[] }
}

const TYPES: Record<string, SecurityDocType> = {
  'acme_soc2_type2_2026.pdf': 'soc2_report',
  'acme_pentest_summary_2026.pdf': 'pentest_summary',
  'acme_infosec_access_control_policy_v3.2.pdf': 'security_policy',
  'acme_access_review_q2_2026.xlsx': 'access_review',
}
const AS_OF = '2026-10-30'
const ctx = { supplierId: 's', requestId: 'r', userId: null, asOf: AS_OF }
let store: MemorySecurityReviewStore

const f = (kind: NewFinding['kind'], ref: string, extra: Partial<NewFinding> = {}): NewFinding => ({
  kind, ref, title: `${ref} title`, stated_severity: null, status: null, detail: null, locator: { page: 1 },
  quote: null, quote_verified: true, prompt_version: 'v', ...extra,
})

// Findings as a correct step 2 would extract them (from gold), on the real sample documents
async function setup({ withPolicy = true } = {}) {
  store = new MemorySecurityReviewStore()
  store.contacts.set('s', { id: 'c-tech', name: 'Daniel Ortiz' })
  for (const [file, type] of Object.entries(TYPES)) {
    if (!withPolicy && type === 'security_policy') continue
    const { document } = await ingestDocument({ store, supplierId: 's', requestId: 'r', userId: null },
      { filename: file, data: new Uint8Array(fs.readFileSync(path.join(SAMPLES, file))) })
    await store.updateDocument(document.id, { doc_type: type })
  }
  const id = (file: string) => store.documents.find((d) => d.filename === file)!.id
  await store.replaceFindings('s', id('acme_pentest_summary_2026.pdf'), gold.findings.pentest.map((p) =>
    f('pentest_finding', p.ref, { stated_severity: p.stated_severity, status: p.status as FindingStatus, locator: { page: 2 } })))
  await store.replaceFindings('s', id('acme_soc2_type2_2026.pdf'), [
    f('control', 'CC6.2', { status: 'exceptions_noted', locator: { page: 11 } }),
    f('control_exception', 'CC6.2', { detail: '2 of 25 removals were 41 days late', locator: { page: 11 }, quote: '2 of 25 sampled accounts' }),
    f('control', 'CC8.1', { status: 'exceptions_noted', locator: { page: 14 } }),   // no exception record: falls back to the control
    f('control', 'CC6.1', { status: 'no_exceptions', locator: { page: 11 } }),
    f('carve_out', 'AWS', { locator: { page: 7 } }),
  ])
  await store.replaceFindings('s', id('acme_access_review_q2_2026.xlsx'), [
    f('access_review_exception', 'Row 27', { locator: { sheet: 'Q2-2026 Review', row_start: 27, row_end: 27 } }),
  ])
}

const byRef = () => new Map(store.remediation.map((r) => [r.title.split(':')[0], r]))

beforeEach(() => setup())

describe('generateRemediation', () => {
  test('creates exactly the items gold requires, with the right severity', async () => {
    const result = await generateRemediation(store, ctx)
    const items = byRef()
    assert.deepEqual([...items.keys()].sort(), gold.remediation.required.map((r) => r.ref).sort())
    for (const r of gold.remediation.required) assert.equal(items.get(r.ref)?.severity, r.severity, r.ref)
    for (const ref of gold.remediation.must_not_create) assert.ok(!items.has(ref), `${ref} must not create an item`)
    assert.equal(result.sla.basis, 'policy')
  })

  test('due dates: policy SLA from the finding date, else the report date; PT-01 is overdue', async () => {
    await generateRemediation(store, ctx)
    const items = byRef()
    assert.equal(items.get('PT-01')!.due_date, '2026-09-05', 'reported August 21 + 15 days (critical)')
    assert.equal(items.get('PT-03')!.due_date, '2026-10-04', 'report issued September 4 + 30 days (high)')
    assert.equal(items.get('CC6.2')!.due_date, '2026-09-27', 'SOC 2 opinion August 28 + 30 days')
    assert.ok(isOverdue(items.get('PT-01')!, AS_OF))
    assert.match(items.get('PT-01')!.description!, /15 days \(vendor policy SLA\) after 2026-08-21 \(date the finding was reported\)/)
    assert.equal(items.get('PT-01')!.owner_name, 'Daniel Ortiz')
  })

  test('without a policy the default SLA is used and labelled as such', async () => {
    await setup({ withPolicy: false })
    const result = await generateRemediation(store, ctx)
    assert.equal(result.sla.basis, 'default')
    assert.match(byRef().get('PT-01')!.description!, /default SLA — no policy SLA found/)
  })

  test('re-generating replaces untouched items and keeps the ones a person worked on', async () => {
    await generateRemediation(store, ctx)
    const pt01 = byRef().get('PT-01')!
    await store.updateRemediation(pt01.id, { status: 'in_progress', external_key: 'SEC-42' })
    const again = await generateRemediation(store, ctx)
    assert.deepEqual([again.created, again.kept, again.replaced], [3, 1, 3])
    assert.equal(store.remediation.length, 4, 'no duplicates')
    assert.equal(byRef().get('PT-01')!.external_key, 'SEC-42')
  })
})

describe('helpers', () => {
  test('readSla parses the policy wording across line breaks', () => {
    const sla = readSla(['6.3 Critical vulnerabilities are remediated within 15 calendar days. High vulnerabilities are remediated\nwithin 30 calendar days.'])
    assert.deepEqual(sla, { days: { critical: 15, high: 30, medium: 90 }, basis: 'policy' })
    assert.equal(readSla(['nothing here']).basis, 'default')
  })

  test("findingDate reads only the finding's own paragraph", async () => {
    const units = await store.listUnits(store.documents.find((d) => d.filename === 'acme_pentest_summary_2026.pdf')!.id)
    assert.equal(findingDate(units, 'PT-01'), '2026-08-21')
    assert.equal(findingDate(units, 'PT-03'), null, "PT-01's date must not leak into PT-03")
  })

  test('addDays crosses months', () => {
    assert.equal(addDays('2026-08-21', 15), '2026-09-05')
    assert.equal(addDays('2026-12-25', 10), '2027-01-04')
  })

  test('Jira CSV: columns, priorities, quoting, and no spreadsheet formulas', async () => {
    await generateRemediation(store, ctx)
    const item = { ...store.remediation[0], title: '=HYPERLINK("x") "quoted"', severity: 'critical' as const }
    const csv = toJiraCsv([item])
    const [header, row] = csv.trim().split('\r\n')
    assert.equal(header, '"Summary","Description","Priority","Assignee","Due Date","Labels"')
    assert.ok(row.startsWith(`"'=HYPERLINK(""x"") ""quoted"""`), row)
    assert.match(row, /"Highest","Daniel Ortiz","\d{4}-\d{2}-\d{2}"/)
  })
})
