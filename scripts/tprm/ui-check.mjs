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

  // A spreadsheet citation reads as rows of fields, with the cited row marked
  await page.getByTestId('answer-card').filter({ hasText: 'IAM-04' }).getByRole('button', { name: /access review.*row 27/i }).click()
  await page.getByRole('dialog', { name: 'Evidence' }).waitFor()
  const cited = page.locator('[data-testid="sheet-row"][data-cited="true"]')
  await cited.first().waitFor()
  check(await cited.count() === 1 && /Row 27/.test(await cited.textContent()) && /ctr\.mbaker/.test(await cited.textContent()),
    'spreadsheet evidence: cited row 27 shown and marked')
  check(await page.locator('[data-testid="sheet-row"][data-cited="false"]').count() > 0, 'spreadsheet evidence: neighbouring rows shown for context')
  await page.screenshot({ path: path.join(OUT, 'desktop-sheet-evidence.png') })
  await page.keyboard.press('Escape')

  await page.getByRole('tab', { name: /Conflict 1/ }).click()
  check(await page.getByTestId('answer-card').count() === 1, 'Conflict filter shows 1 answer')
  const sides = page.getByTestId('conflict-view').locator('.grid > div')
  const [a, b] = [await sides.nth(0).boundingBox(), await sides.nth(1).boundingBox()]
  check(a && b && Math.abs(a.y - b.y) < 2 && b.x > a.x, 'conflict passages side by side on desktop')
  const explanation = await page.getByTestId('conflict-view').textContent()
  check(!/\bP\d\b/.test(explanation) && /policy.*\(p\. \d+\)/i.test(explanation), 'conflict explanation names documents, not P1/P2')

  await page.getByTestId('conflict-view').getByRole('button').first().click()
  await page.getByRole('dialog', { name: 'Evidence' }).waitFor()
  await page.getByTestId('evidence-highlight').waitFor()
  check(/multi-factor/i.test(await page.getByTestId('evidence-highlight').textContent()), 'evidence drawer highlights the quote')
  check(/multi-factor/i.test(await page.getByTestId('evidence-quote').textContent()), 'evidence drawer shows the quoted text')
  await page.screenshot({ path: path.join(OUT, 'desktop-evidence.png') })
  await page.keyboard.press('Escape')
  check(await page.getByRole('dialog', { name: 'Evidence' }).count() === 0, 'Escape closes the drawer')

  await page.getByRole('button', { name: 'Approve' }).count().then((n) => check(n === 0, 'a conflict cannot be approved directly'))
  await page.getByLabel('B (evidence against)').check()
  await page.getByLabel('Note for the record (optional)').fill('pen test is the current state')
  const picker = page.getByTestId('response-picker')
  check(await picker.getByLabel('Yes').isChecked(), 'resolve form: Response defaults to the AI label')
  await picker.getByLabel('Partial').check()
  await page.getByRole('button', { name: 'Resolve conflict' }).click()
  await page.getByText('Edited and approved').waitFor()
  ok('conflict resolved')
  const resolved = page.getByTestId('conflict-resolved')
  const resolvedText = await resolved.locator('summary').textContent()
  check(/chose B/.test(resolvedText) && resolvedText.includes('pen test is the current state'), 'resolved conflict shows the chosen side and note')
  check(await page.getByTestId('conflict-view').count() === 0 && !(await resolved.getAttribute('open')), 'resolved conflict is collapsed')
  check(await page.getByTestId('answer-card').getByTestId('answer-label').textContent() === 'Partial', 'chosen Response shown on the answer')
  check(/font-semibold/.test(await page.getByTestId('answer-card').getByTestId('review-status').getAttribute('class')), 'review status is bold')
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
  check(csv.startsWith('"Summary","Description","Priority","Assignee","Due Date","Labels"') && csv.includes('PT-03'), 'remediation: Jira CSV downloaded')
  check(!csv.includes('PT-01'), 'remediation: item already in Jira left out of the CSV')
  await page.getByText('1 exported to the Jira CSV; 1 already in Jira (SEC-42) skipped.').waitFor()
  ok('remediation: CSV message names the skipped item')
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
  check(responseOf('IAM-01') === 'Partial', 'response: reviewer-chosen Response exported')
  await page.screenshot({ path: path.join(OUT, 'desktop-response.png'), fullPage: true })

  await page.getByRole('tab', { name: 'Activity' }).click()
  // The Answers tab shares this query, so cached events render first; wait for the refetch
  await page.getByTestId('activity-event').filter({ hasText: 'Response exported' }).waitFor()
  const activity = await page.getByTestId('activity-event').allTextContents()
  check(activity.some((t) => t.includes('Conflict resolved') && t.includes('IAM-01')), 'activity shows the conflict resolution')
  check(activity.some((t) => t.includes('Answer approved')), 'activity shows the approval')
  check(activity.some((t) => t.includes('AI flagged a conflict')), 'activity shows the AI conflict flag')
  check(activity.filter((t) => t.includes('Remediation item updated')).length === 2, 'activity shows the remediation updates')
  check(activity.some((t) => t.includes('PT-01: status → In progress')) && activity.some((t) => t.includes('PT-01: Jira key → SEC-42')),
    'activity says what changed on a remediation item')
  check(activity.some((t) => t.includes('2 created') && t.includes('due dates from your policy SLA')), 'activity details the remediation generation')
  check(activity.some((t) => t.includes('IAM-01') && t.includes('chose B') && t.includes('response Partial')), 'activity shows the chosen side and Response')
  check(activity.some((t) => t.includes('Response exported') && t.includes('21 answers included, 1 withheld')), 'activity shows the export')

  await page.goto(`${PAGE}?tab=answers`)
  await page.getByTestId('answer-card').nth(21).waitFor()
  check(await page.getByText('Edited and approved').count() === 1, 'reviews persist after reload')
  check(errors.length === 0, `no console errors on desktop${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  await context.close()

  // ── TipTap draft editor (existing inbox feature; guards TipTap upgrades) ───
  const t = await newPage(browser, { viewport: { width: 1280, height: 900 } })
  const DRAFT = '## Compliance response\n\nAcme confirms coverage.\n\n| Item | Status |\n|---|---|\n| SOC 2 | Current |\n'
  await t.context.route('**/api/ai/draft/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: DRAFT, tokens: 0 }) }))
  await t.context.route('**/api/ai/analyze-*', (r) => r.abort())
  await t.page.goto(PAGE.replace(/\/inbox\/.*$/, '/inbox'))
  await t.page.getByText('Vendor Security Questionnaire (SIG-Lite)').first().click()
  check(await t.page.getByRole('link', { name: 'Open security review' }).isVisible(), 'inbox: compliance request offers "Open security review"')
  await t.page.getByRole('button', { name: 'Edit draft' }).click()
  const editor = t.page.locator('.ProseMirror')
  await editor.waitFor()
  check(await editor.locator('table td').count() === 2 && await editor.locator('h2').count() === 1, 'TipTap: editor renders the draft heading and table')
  // Select the line the way a keyboard user would (a double-click left no selection in headless Chromium)
  await editor.locator('p', { hasText: 'Acme confirms coverage.' }).click()
  await t.page.keyboard.press('End')
  await t.page.keyboard.press('Shift+Home')
  await t.page.getByTitle('Bold').click()
  check(await editor.locator('strong').count() === 1, 'TipTap: Bold applies')
  await t.page.getByRole('button', { name: 'Preview' }).click()
  await t.page.locator('strong').first().waitFor()
  check(await t.page.locator('.ProseMirror').count() === 0, 'TipTap: Preview leaves edit mode and keeps the formatting')
  check(t.errors.length === 0, `no console errors in the draft editor${t.errors.length ? `: ${t.errors.join(' | ')}` : ''}`)
  await t.context.close()

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
  // Resolved on desktop above, so the disagreement is collapsed; open it
  await m.page.getByTestId('conflict-resolved').locator('summary').click()
  const msides = m.page.getByTestId('conflict-resolved').locator('.grid > div')
  const [ma, mb] = [await msides.nth(0).boundingBox(), await msides.nth(1).boundingBox()]
  check(ma && mb && mb.y >= ma.y + ma.height - 1, '375px: conflict passages stacked')
  await m.page.getByTestId('conflict-resolved').locator('.grid button').first().click()
  const drawer = await m.page.getByRole('dialog', { name: 'Evidence' }).boundingBox()
  check(drawer && drawer.width >= 374, '375px: evidence drawer is full width')
  check(await noHorizontalScroll(m.page), '375px: no horizontal scroll with the drawer open')
  await m.page.screenshot({ path: path.join(OUT, 'mobile-evidence.png') })
  await m.page.keyboard.press('Escape')
  await m.page.getByRole('tab', { name: /^All/ }).click()
  await m.page.getByTestId('answer-card').filter({ hasText: 'IAM-04' }).getByRole('button', { name: /access review.*row 27/i }).click()
  await m.page.locator('[data-testid="sheet-row"][data-cited="true"]').waitFor()
  check(await noHorizontalScroll(m.page), '375px: spreadsheet evidence fits the screen')
  await m.page.screenshot({ path: path.join(OUT, 'mobile-sheet-evidence.png') })
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
