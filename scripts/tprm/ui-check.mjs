// Browser check of the security review page, end to end through the real client and the real
// security-review router (in-memory store, fake model). Supabase is stubbed: a session in
// localStorage and canned rows for the two table reads the page makes.
//
// Usage: npm run tprm:ui-check            (screenshots to $UI_CHECK_OUT or ./ui-check-output)
// Plain JS because Playwright is the machine's global install (NODE_PATH), not a project dependency.

import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { chromium, newPage, PAGE, ROOT, startServers, stopServers } from './browser-harness.mjs'

const ExcelJS = createRequire(import.meta.url)('exceljs')
const OUT = process.env.UI_CHECK_OUT ?? path.join(ROOT, 'ui-check-output')

fs.mkdirSync(OUT, { recursive: true })
let failures = 0
const ok = (m) => console.log(`✓ ${m}`)
const bad = (m) => { failures++; console.log(`✗ ${m}`) }
const check = (cond, m) => (cond ? ok(m) : bad(m))

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function main() {
  await startServers()
  const browser = await chromium.launch()

  // ── Desktop: the whole flow ──────────────────────────────────────────────
  const { context, page, errors } = await newPage(browser, { viewport: { width: 1280, height: 900 } })
  await page.goto(PAGE)
  await page.getByRole('heading', { name: 'Security review' }).waitFor()
  const subjectShown = await page.getByText('Vendor Security Questionnaire (SIG-Lite)').waitFor({ timeout: 5000 }).then(() => true, () => false)
  check(subjectShown, 'page loads with the request subject')

  await page.getByRole('button', { name: 'Use sample documents' }).click()
  await page.getByTestId('document-card').nth(5).waitFor()
  check(await page.getByTestId('document-card').count() === 6, '6 sample documents listed')
  check(await page.getByText('Questionnaire', { exact: true }).count() === 1, 'questionnaire recognised')

  await page.getByRole('button', { name: /Analyze 5 documents/ }).click()
  await page.getByRole('button', { name: 'All documents analyzed' }).waitFor({ timeout: 30000 })
  check(await page.getByTestId('summary-card').count() === 5, 'summary cards shown for 5 evidence documents')
  await page.screenshot({ path: path.join(OUT, 'desktop-documents.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Answers' }).click()
  await page.getByRole('button', { name: 'Answer questionnaire' }).click()
  await page.getByText(/of 22 questions answered/).waitFor()
  ok('progress shown while answering')
  await page.getByRole('button', { name: 'Run again' }).waitFor({ timeout: 60000 })
  check(await page.getByTestId('answer-card').count() === 22, '22 answers after the run')
  const firstRef = await page.getByTestId('answer-card').first().locator('span.font-mono').first().textContent()
  check(firstRef === 'GOV-01', 'answers in questionnaire order')

  await page.getByRole('tab', { name: /Conflict 1/ }).click()
  check(await page.getByTestId('answer-card').count() === 1, 'Conflict filter shows 1 answer')
  const sides = page.getByTestId('conflict-view').locator('.grid > div')
  const [a, b] = [await sides.nth(0).boundingBox(), await sides.nth(1).boundingBox()]
  check(a && b && Math.abs(a.y - b.y) < 2 && b.x > a.x, 'conflict passages side by side on desktop')

  await page.getByTestId('conflict-view').getByRole('button').first().click()
  await page.getByRole('dialog', { name: 'Evidence' }).waitFor()
  await page.getByTestId('evidence-highlight').waitFor()
  check(/multi-factor/i.test(await page.getByTestId('evidence-highlight').textContent()), 'evidence drawer highlights the quote')
  await page.screenshot({ path: path.join(OUT, 'desktop-evidence.png') })
  await page.keyboard.press('Escape')
  check(await page.getByRole('dialog', { name: 'Evidence' }).count() === 0, 'Escape closes the drawer')

  await page.getByRole('button', { name: 'Approve' }).count().then((n) => check(n === 0, 'a conflict cannot be approved directly'))
  await page.getByLabel('B (evidence against)').check()
  await page.getByLabel('Note for the record (optional)').fill('pen test is the current state')
  await page.getByRole('button', { name: 'Resolve conflict' }).click()
  await page.getByText('Edited and approved').waitFor()
  ok('conflict resolved')
  await page.screenshot({ path: path.join(OUT, 'desktop-conflict.png'), fullPage: true })

  await page.getByRole('tab', { name: /Ready 21/ }).click()
  await page.getByRole('button', { name: 'Approve' }).first().click()
  await page.getByText('Approved', { exact: true }).first().waitFor()
  ok('ready answer approved')
  await page.getByTestId('answer-card').filter({ hasText: 'GOV-03' }).getByRole('button', { name: 'Reject' }).click()
  await page.getByTestId('answer-card').filter({ hasText: 'GOV-03' }).getByText('Rejected').waitFor()
  ok('ready answer rejected')

  await page.getByRole('tab', { name: 'Remediation' }).click()
  await page.getByRole('button', { name: 'Generate from findings' }).click()
  await page.getByTestId('remediation-item').nth(1).waitFor()
  const remTexts = await page.getByTestId('remediation-item').allTextContents()
  check(remTexts.length === 2 && remTexts[0].includes('PT-01') && remTexts[1].includes('PT-03'), 'remediation: PT-01 and PT-03 generated')
  check(remTexts[0].includes('critical') && remTexts[0].includes('Overdue') && remTexts[0].includes('Due 2026-09-05'), 'remediation: PT-01 critical, due 2026-09-05 by policy SLA, overdue')
  check(await page.getByText('Due dates use your policy SLA.').isVisible(), 'remediation: policy SLA used')
  await page.getByTestId('remediation-item').first().getByLabel('Status').selectOption('in_progress')
  await page.getByTestId('remediation-item').first().getByLabel('Jira key').fill('SEC-42')
  await page.getByTestId('remediation-item').first().getByLabel('Jira key').blur()
  await page.waitForTimeout(500)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Jira CSV' }).click()])
  const csv = fs.readFileSync(await download.path(), 'utf-8')
  check(csv.startsWith('"Summary","Description","Priority","Assignee","Due Date","Labels"') && csv.includes('"Highest"'), 'remediation: Jira CSV downloaded')
  check(/^remediation-\d{4}-\d{2}-\d{2}\.csv$/.test(download.suggestedFilename()), `remediation: dated filename (${download.suggestedFilename()})`)
  await page.screenshot({ path: path.join(OUT, 'desktop-remediation.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Response' }).click()
  await page.getByTestId('response-summary').waitFor()
  check((await page.getByTestId('response-summary').textContent()).includes('21 of 22'), 'response: 21 of 22 answers go to the buyer')
  const withheld = await page.getByTestId('withheld-entry').allTextContents()
  check(withheld.length === 1 && withheld[0].includes('GOV-03') && withheld[0].includes('Rejected'), 'response: rejected answer withheld')
  check(await page.getByTestId('response-entry').filter({ hasText: 'IAM-01' }).count() === 1, 'response: resolved conflict included')
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download completed questionnaire' }).click()])
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(await xlsx.path())
  const qs = wb.getWorksheet('Questionnaire')
  const responseOf = (ref) => { let v; qs.eachRow((r) => { if (r.getCell(1).value === ref) v = r.getCell(4).value }); return v }
  check(xlsx.suggestedFilename() === 'clearfield_vendor_security_questionnaire_response.xlsx', `response: questionnaire downloaded (${xlsx.suggestedFilename()})`)
  check(responseOf('GOV-01') === 'Yes' && (responseOf('GOV-03') ?? null) === null, 'response: xlsx filled, withheld row left blank')
  await page.screenshot({ path: path.join(OUT, 'desktop-response.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Activity' }).click()
  await page.getByTestId('activity-event').first().waitFor()
  const activity = await page.getByTestId('activity-event').allTextContents()
  check(activity.some((t) => t.includes('Conflict resolved') && t.includes('IAM-01')), 'activity shows the conflict resolution')
  check(activity.some((t) => t.includes('Answer approved')), 'activity shows the approval')
  check(activity.some((t) => t.includes('AI flagged a conflict')), 'activity shows the AI conflict flag')
  check(activity.filter((t) => t.includes('Remediation item updated')).length === 2, 'activity shows the remediation updates')
  check(activity.some((t) => t.includes('Response exported') && t.includes('21 answers included, 1 withheld')), 'activity shows the export')

  await page.goto(`${PAGE}?tab=answers`)
  await page.getByTestId('answer-card').nth(21).waitFor()
  check(await page.getByText('Edited and approved').count() === 1, 'reviews persist after reload')
  check(errors.length === 0, `no console errors on desktop${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  await context.close()

  // ── Mobile 375px ─────────────────────────────────────────────────────────
  const m = await newPage(browser, { viewport: { width: 375, height: 812 } })
  for (const tab of ['documents', 'answers', 'remediation', 'response', 'activity']) {
    await m.page.goto(`${PAGE}?tab=${tab}`)
    await m.page.getByRole('heading', { name: 'Security review' }).waitFor()
    await m.page.waitForLoadState('networkidle')
    check(await noHorizontalScroll(m.page), `375px ${tab}: no horizontal scroll`)
    // No-scroll alone passed while a fixed sidebar squeezed the page into 60px; check the content width
    const tabs = await m.page.getByRole('tablist', { name: 'Security review sections' }).boundingBox()
    check(tabs && tabs.width >= 330, `375px ${tab}: content uses the screen width (${Math.round(tabs?.width ?? 0)}px)`)
    const sel = await m.page.getByRole('tab', { selected: true }).first().boundingBox()
    check(sel && sel.x >= 0 && sel.x + sel.width <= 375, `375px ${tab}: selected tab fully visible`)
    await m.page.screenshot({ path: path.join(OUT, `mobile-${tab}.png`), fullPage: true })
  }
  await m.page.getByRole('button', { name: 'Open menu' }).click()
  const nav = m.page.getByRole('dialog', { name: 'Navigation' })
  await nav.getByRole('link', { name: 'Inbox' }).waitFor()
  ok('375px: menu opens the navigation drawer')
  await m.page.getByRole('button', { name: 'Close menu' }).click()
  check(await nav.count() === 0, '375px: navigation drawer closes')

  await m.page.goto(`${PAGE}?tab=answers`)
  await m.page.getByRole('tab', { name: /Conflict 1/ }).click()
  const msides = m.page.getByTestId('conflict-view').locator('.grid > div')
  const [ma, mb] = [await msides.nth(0).boundingBox(), await msides.nth(1).boundingBox()]
  check(ma && mb && mb.y >= ma.y + ma.height - 1, '375px: conflict passages stacked')
  await m.page.getByTestId('conflict-view').getByRole('button').first().click()
  const drawer = await m.page.getByRole('dialog', { name: 'Evidence' }).boundingBox()
  check(drawer && drawer.width >= 374, '375px: evidence drawer is full width')
  check(await noHorizontalScroll(m.page), '375px: no horizontal scroll with the drawer open')
  await m.page.screenshot({ path: path.join(OUT, 'mobile-evidence.png') })
  check(m.errors.length === 0, `no console errors on mobile${m.errors.length ? `: ${m.errors.join(' | ')}` : ''}`)

  await browser.close()
}

try {
  await main()
} catch (err) {
  bad(err.stack ?? String(err))
} finally {
  stopServers()
}
console.log(failures ? `\n${failures} check(s) failed` : `\nAll UI checks passed. Screenshots in ${path.relative(ROOT, OUT) || OUT}`)
process.exit(failures ? 1 : 0)
