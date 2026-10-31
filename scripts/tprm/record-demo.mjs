// Records a walkthrough video of the security review page with the real model (backup for a live
// demo). Same offline setup as the UI check: dev API on the in-memory store, Vite, Supabase stubbed.
// Captions are an overlay injected by this script, not part of the app.
//
// Usage (ANTHROPIC_API_KEY from the environment or .env): npm run tprm:record-demo   (~5 minutes; writes $DEMO_OUT or ./demo-output)

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { chromium, newPage, PAGE, ROOT, startServers, stopServers } from './browser-harness.mjs'

const OUT = process.env.DEMO_OUT ?? path.join(ROOT, 'demo-output')
const SIZE = { width: 1280, height: 800 }
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set')
  process.exit(2)
}
fs.mkdirSync(OUT, { recursive: true })

const pause = (page, ms = 2500) => page.waitForTimeout(ms)

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-caption')
    if (!el) {
      el = document.createElement('div')
      el.id = 'demo-caption'
      el.setAttribute('style', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:900px;' +
        'background:rgba(15,23,42,0.92);color:#fff;font:600 16px/1.4 "Plus Jakarta Sans",system-ui,sans-serif;' +
        'padding:12px 18px;border-radius:10px;box-shadow:0 10px 15px rgba(0,0,0,0.2);pointer-events:none;text-align:center')
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`)
}

async function scrollThrough(page, steps = 6, dy = 350) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy)
    await page.waitForTimeout(900)
  }
}

async function optional(label, fn) {
  try { await fn() } catch (err) { console.log(`  (skipped ${label}: ${err.message.split('\n')[0]})`) }
}

let videoPath = null
try {
  await startServers({ real: true })
  const browser = await chromium.launch()
  const { context, page } = await newPage(browser, { viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } })
  await page.mouse.move(640, 400)

  await page.goto(PAGE)
  await page.getByRole('heading', { name: 'Security review' }).waitFor()
  await caption(page, 'Clearfield Financial sent a 22-question security questionnaire. Start with the evidence.')
  await pause(page, 3500)
  await page.getByRole('button', { name: 'Use sample documents' }).click()
  await page.getByTestId('document-card').nth(5).waitFor()
  await caption(page, 'SOC 2 report, pen test, phishing results, policy and access review, plus the buyer’s questionnaire.')
  await pause(page, 3500)

  await caption(page, 'Each document is classified, its findings extracted and summarized. Every quote is checked against the page by code.')
  await page.getByRole('button', { name: /Analyze \d+ documents/ }).click()
  await page.getByRole('button', { name: 'All documents analyzed' }).waitFor({ timeout: 240000 })
  await caption(page, 'Summary cards surface exceptions first: auditor exceptions, open Critical/High findings, missed targets.')
  await scrollThrough(page, 8)
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.getByRole('tab', { name: 'Answers' }).click()
  await caption(page, 'Per question: gather evidence from every document, verify quotes, check for conflicts, draft, then verify again.')
  await page.getByRole('button', { name: 'Answer questionnaire' }).click()
  await page.getByRole('button', { name: 'Run again' }).waitFor({ timeout: 360000 })
  await caption(page, 'Readiness is decided by code rules, not the model’s confidence. Only fully checked answers are Ready.')
  await pause(page, 3500)

  await optional('conflict', async () => {
    await page.getByRole('tab', { name: /^Conflict/ }).click()
    const card = page.getByTestId('answer-card').filter({ hasText: 'IAM-01' })
    await card.scrollIntoViewIfNeeded()
    await caption(page, 'The policy says MFA everywhere. The pen test found the admin portal accepts a password alone. Flagged before the buyer sees it.')
    await pause(page, 5000)
    await card.getByTestId('conflict-view').locator('.grid > div').nth(1).getByRole('button').click()
    await page.getByTestId('evidence-highlight').waitFor()
    await caption(page, 'Every citation opens the page it came from, with the quote highlighted.')
    await pause(page, 4500)
    await page.keyboard.press('Escape')
    await card.getByLabel('B (evidence against)').check()
    await card.getByLabel('Note for the record (optional)').fill('Pen test reflects current state; MFA rollout to admin portal planned for Q4.')
    await caption(page, 'A person resolves the conflict and the decision is logged.')
    await pause(page, 2000)
    await card.getByRole('button', { name: 'Resolve conflict' }).click()
    await card.getByText('Edited and approved').waitFor()
    await pause(page, 2000)
  })

  await optional('needs evidence', async () => {
    await page.getByRole('tab', { name: /^Needs evidence/ }).click()
    await caption(page, 'Held back with reasons: no evidence (RTO/RPO), auditor exceptions, AWS carve-out, overstated answers.')
    await scrollThrough(page, 6)
    await page.evaluate(() => window.scrollTo(0, 0))
  })

  await page.getByRole('tab', { name: 'Remediation' }).click()
  await caption(page, 'Open Critical/High findings and SOC 2 exceptions become tickets, due by the vendor’s own SLA. PT-01 is overdue.')
  await page.getByRole('button', { name: 'Generate from findings' }).click()
  await page.getByTestId('remediation-item').first().waitFor()
  await scrollThrough(page, 4)
  await page.evaluate(() => window.scrollTo(0, 0))

  await page.getByRole('tab', { name: 'Response' }).click()
  await page.getByTestId('response-summary').waitFor()
  await caption(page, 'Only Ready or human-approved answers go into the buyer’s questionnaire. Everything else is withheld.')
  await pause(page, 4500)

  await page.getByRole('tab', { name: 'Activity' }).click()
  await caption(page, 'Every AI step and human decision is on the timeline.')
  await pause(page, 4000)

  videoPath = await page.video().path()
  await context.close()
  await browser.close()
} finally {
  stopServers()
}

if (videoPath) {
  const target = path.join(OUT, 'security-review-demo.webm')
  fs.renameSync(videoPath, target)
  console.log(`\nWrote ${target} (${(fs.statSync(target).size / 1e6).toFixed(1)} MB)`)
}
