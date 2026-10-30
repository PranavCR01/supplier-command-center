import type { DocumentFinding, DocumentSummary, SecurityDocType } from '../../../types/index.js'

// Scores step-2 output (classification, findings, summary cards) against test_data/tprm/gold.json.
// Field accuracy is per record (one document per type in the sample set): a record counts
// only if every scored field on it is right.

export interface GoldAnalysis {
  documents: Record<string, { file: string; doc_type: string }>
  findings: {
    soc2: { controls: { ref: string; status: string; page?: number }[]; carve_outs: { subservice_org: string; page: number }[] }
    pentest: { ref: string; stated_severity: string; status: string }[]
    phishing: { campaigns: number; click_rates: Record<string, string>; training_completion: string }
    access_review: { late_removals: number; late_removal_rows: number[] }
  }
  summaries: Record<string, {
    must_mention_exceptions?: string[]
    must_mention_takeaways?: string[]
    must_mention_any?: string[]
  }>
}

export interface AnalyzedDoc {
  key: string           // gold document key: soc2, pentest, ...
  docType: SecurityDocType | null
  findings: DocumentFinding[]
  summary: DocumentSummary | null
}

export interface Check {
  name: string
  pass: boolean
  detail?: string
}

export interface AnalysisScore {
  checks: Check[]
  classification: { correct: number; total: number }
  fieldAccuracy: Record<string, { correct: number; total: number }>
  summaryCoverage: { correct: number; total: number }
  quoteVerification: { findings: { verified: number; total: number }; summaryItems: { verified: number; total: number } }
}

const lower = (s: string | null | undefined) => (s ?? '').toLowerCase()

function tally(checks: Check[], prefix: string) {
  const subset = checks.filter((c) => c.name.startsWith(prefix))
  return { correct: subset.filter((c) => c.pass).length, total: subset.length }
}

function summaryText(items: { text: string; quote: string }[]): string {
  return items.map((i) => `${i.text} ${i.quote}`).join(' \n ').toLowerCase()
}

export function scoreAnalysis(gold: GoldAnalysis, docs: AnalyzedDoc[]): AnalysisScore {
  const checks: Check[] = []
  const byKey = new Map(docs.map((d) => [d.key, d]))
  const findingsOf = (key: string) => byKey.get(key)?.findings ?? []

  for (const [key, g] of Object.entries(gold.documents)) {
    if (key === 'questionnaire') continue
    const got = byKey.get(key)?.docType ?? null
    checks.push({ name: `classify.${key}`, pass: got === g.doc_type, detail: `got ${got}, want ${g.doc_type}` })
  }

  // SOC 2: every control's status, every exception (with its page), the carve-out
  const soc2 = findingsOf('soc2')
  for (const c of gold.findings.soc2.controls) {
    const f = soc2.find((x) => x.kind === 'control' && x.ref === c.ref)
    checks.push({ name: `field.soc2.control.${c.ref}`, pass: f?.status === c.status, detail: f ? `status ${f.status}` : 'missing' })
  }
  const goldExceptions = gold.findings.soc2.controls.filter((c) => c.status === 'exceptions_noted')
  for (const c of goldExceptions) {
    const f = soc2.find((x) => x.kind === 'control_exception' && x.ref === c.ref)
    const page = f && 'page' in f.locator ? f.locator.page : null
    checks.push({ name: `field.soc2.exception.${c.ref}`, pass: Boolean(f) && page === c.page, detail: f ? `page ${page}` : 'missing' })
  }
  const extraExceptions = soc2.filter((x) => x.kind === 'control_exception' && !goldExceptions.some((c) => c.ref === x.ref))
  checks.push({ name: 'field.soc2.no_invented_exceptions', pass: extraExceptions.length === 0, detail: extraExceptions.map((x) => x.ref).join(', ') })
  for (const co of gold.findings.soc2.carve_outs) {
    const f = soc2.find((x) => x.kind === 'carve_out' && lower(x.title).includes(lower(co.subservice_org)))
    checks.push({ name: `field.soc2.carve_out.${co.subservice_org}`, pass: Boolean(f), detail: f ? undefined : 'missing' })
  }

  // Pen test: severity copied as stated, status after retest
  const pentest = findingsOf('pentest')
  for (const p of gold.findings.pentest) {
    const f = pentest.find((x) => x.kind === 'pentest_finding' && x.ref === p.ref)
    const pass = Boolean(f) && lower(f!.stated_severity) === lower(p.stated_severity) && f!.status === p.status
    checks.push({ name: `field.pentest.${p.ref}`, pass, detail: f ? `${f.stated_severity}/${f.status}` : 'missing' })
  }

  // Phishing metrics
  const phishing = findingsOf('phishing').filter((x) => x.kind === 'phishing_metric')
  const metric = (ref: string) => phishing.filter((x) => x.ref === ref)
  const campaigns = metric('campaign_count')[0]
  const campaignsPass = Boolean(campaigns) && new RegExp(`\\b(${gold.findings.phishing.campaigns}|two)\\b`, 'i').test(campaigns.detail ?? '')
  checks.push({ name: 'field.phishing.campaign_count', pass: campaignsPass, detail: campaigns?.detail ?? 'missing' })
  for (const [when, rate] of Object.entries(gold.findings.phishing.click_rates)) {
    const month = lower(when.split(' ')[0])
    const f = metric('click_rate').find((x) => lower(`${x.title} ${x.detail}`).includes(month))
    checks.push({ name: `field.phishing.click_rate.${when}`, pass: Boolean(f?.detail?.includes(rate)), detail: f?.detail ?? 'missing' })
  }
  const training = metric('training_completion')[0]
  checks.push({
    name: 'field.phishing.training_completion',
    pass: Boolean(training?.detail?.includes(gold.findings.phishing.training_completion)),
    detail: training?.detail ?? 'missing',
  })

  // Access review: exactly the late-removal rows
  const rows = findingsOf('access_review')
    .filter((x) => x.kind === 'access_review_exception')
    .map((x) => ('row_start' in x.locator ? x.locator.row_start : -1))
    .sort((a, b) => a - b)
  const want = [...gold.findings.access_review.late_removal_rows].sort((a, b) => a - b)
  checks.push({ name: 'field.access_review.late_removals', pass: JSON.stringify(rows) === JSON.stringify(want), detail: `rows ${rows.join(',')}` })

  // Summary cards must surface the known exceptions
  for (const [key, req] of Object.entries(gold.summaries)) {
    const s = byKey.get(key)?.summary
    const all = s ? summaryText([...s.top_findings, ...s.key_exceptions, ...s.takeaways, { text: s.headline, quote: '' }]) : ''
    for (const term of req.must_mention_exceptions ?? []) {
      checks.push({ name: `summary.${key}.exception.${term}`, pass: Boolean(s) && summaryText(s!.key_exceptions).includes(lower(term)) })
    }
    for (const term of req.must_mention_takeaways ?? []) {
      checks.push({ name: `summary.${key}.takeaway.${term}`, pass: Boolean(s) && summaryText(s!.takeaways).includes(lower(term)) })
    }
    if (req.must_mention_any?.length) {
      checks.push({ name: `summary.${key}.any`, pass: req.must_mention_any.some((t) => all.includes(lower(t))), detail: req.must_mention_any.join(' | ') })
    }
    if (!s) checks.push({ name: `summary.${key}.present`, pass: false })
  }

  const allFindings = docs.flatMap((d) => d.findings)
  const items = docs.flatMap((d) => (d.summary ? [...d.summary.top_findings, ...d.summary.key_exceptions, ...d.summary.takeaways] : []))
  const fieldAccuracy: AnalysisScore['fieldAccuracy'] = {}
  for (const group of ['soc2', 'pentest', 'phishing', 'access_review']) fieldAccuracy[group] = tally(checks, `field.${group}.`)

  return {
    checks,
    classification: tally(checks, 'classify.'),
    fieldAccuracy,
    summaryCoverage: tally(checks, 'summary.'),
    quoteVerification: {
      findings: { verified: allFindings.filter((f) => f.quote_verified).length, total: allFindings.length },
      summaryItems: { verified: items.filter((i) => i.quote_verified).length, total: items.length },
    },
  }
}
