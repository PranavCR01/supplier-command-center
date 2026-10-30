// Browser check of the security review page, end to end through the real client and the real
// security-review router (in-memory store, fake model). Supabase is stubbed: a session in
// localStorage and canned rows for the two table reads the page makes.
//
// Usage: npm run tprm:ui-check            (screenshots to $UI_CHECK_OUT or ./ui-check-output)
// Plain JS because Playwright is the machine's global install (NODE_PATH), not a project dependency.

import { spawn } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = process.env.UI_CHECK_OUT ?? path.join(ROOT, 'ui-check-output')
const API_PORT = 3101
const WEB_PORT = 5174
const SUPABASE = 'http://supabase.test'
const TOKEN = 'dev-token'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const REQUEST_ID = '00000000-0000-4000-8000-0000000000aa'
const PAGE = `http://localhost:${WEB_PORT}/inbox/${REQUEST_ID}/security-review`

fs.mkdirSync(OUT, { recursive: true })
const children = []
let failures = 0
const ok = (m) => console.log(`✓ ${m}`)
const bad = (m) => { failures++; console.log(`✗ ${m}`) }
const check = (cond, m) => (cond ? ok(m) : bad(m))

function start(cmd, args, env, readyText) {
  return new Promise((resolve, reject) => {
    // detached: own process group, so the npx wrapper and the server it starts are stopped together
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    children.push(child)
    let log = ''
    const timer = setTimeout(() => reject(new Error(`${cmd} did not start:\n${log}`)), 60000)
    const onData = (d) => {
      log += d.toString()
      if (log.includes(readyText)) { clearTimeout(timer); resolve(child) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => reject(new Error(`${cmd} exited ${code}:\n${log}`)))
  })
}

const session = {
  access_token: TOKEN, refresh_token: 'dev-refresh', token_type: 'bearer', expires_in: 3600 * 24 * 365,
  expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
  user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'dev@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), ['sb-supabase-auth-token', JSON.stringify(session)])
  await context.route(`${SUPABASE}/**`, (route) => {
    const url = route.request().url()
    const body = url.includes('/rest/v1/suppliers') ? { company_name: 'Acme Tech Solutions Inc.' }
      : url.includes('/rest/v1/inbox_requests') ? { id: REQUEST_ID, subject: 'Vendor security questionnaire', from_buyer: 'Clearfield Financial', deadline: null }
      : url.includes('/auth/v1/user') ? session.user
      : {}
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  // Fonts come from Google; offline they fail, which is not a page error
  await context.route('https://fonts.googleapis.com/**', (r) => r.abort())
  await context.route('https://fonts.gstatic.com/**', (r) => r.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_FAILED|net::/.test(m.text())) errors.push(`console: ${m.text()}`) })
  return { context, page, errors }
}

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function main() {
  await start('npx', ['tsx', 'scripts/tprm/dev-server.ts', '--port', String(API_PORT)], {}, 'dev API on')
  await start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
    VITE_SUPABASE_URL: SUPABASE, VITE_SUPABASE_ANON_KEY: 'anon', VITE_API_BASE_URL: `http://localhost:${API_PORT}`,
  }, 'Local:')
  const browser = await chromium.launch()

  // ── Desktop: the whole flow ──────────────────────────────────────────────
  const { context, page, errors } = await newPage(browser, { width: 1280, height: 900 })
  await page.goto(PAGE)
  await page.getByRole('heading', { name: 'Security review' }).waitFor()
  const subjectShown = await page.getByText('Vendor security questionnaire').waitFor({ timeout: 5000 }).then(() => true, () => false)
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

  await page.getByRole('tab', { name: 'Activity' }).click()
  await page.getByTestId('activity-event').first().waitFor()
  const activity = await page.getByTestId('activity-event').allTextContents()
  check(activity.some((t) => t.includes('Conflict resolved') && t.includes('IAM-01')), 'activity shows the conflict resolution')
  check(activity.some((t) => t.includes('Answer approved')), 'activity shows the approval')
  check(activity.some((t) => t.includes('AI flagged a conflict')), 'activity shows the AI conflict flag')

  await page.goto(`${PAGE}?tab=answers`)
  await page.getByTestId('answer-card').nth(21).waitFor()
  check(await page.getByText('Edited and approved').count() === 1, 'reviews persist after reload')
  check(errors.length === 0, `no console errors on desktop${errors.length ? `: ${errors.join(' | ')}` : ''}`)
  await context.close()

  // ── Mobile 375px ─────────────────────────────────────────────────────────
  const m = await newPage(browser, { width: 375, height: 812 })
  for (const tab of ['documents', 'answers', 'activity']) {
    await m.page.goto(`${PAGE}?tab=${tab}`)
    await m.page.getByRole('heading', { name: 'Security review' }).waitFor()
    await m.page.waitForLoadState('networkidle')
    check(await noHorizontalScroll(m.page), `375px ${tab}: no horizontal scroll`)
    // No-scroll alone passed while a fixed sidebar squeezed the page into 60px; check the content width
    const tabs = await m.page.getByRole('tablist', { name: 'Security review sections' }).boundingBox()
    check(tabs && tabs.width >= 330, `375px ${tab}: content uses the screen width (${Math.round(tabs?.width ?? 0)}px)`)
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
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ }
  }
}
console.log(failures ? `\n${failures} check(s) failed` : `\nAll UI checks passed. Screenshots in ${path.relative(ROOT, OUT) || OUT}`)
process.exit(failures ? 1 : 0)
