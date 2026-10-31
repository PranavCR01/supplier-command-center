// Shared setup for browser runs of the security review page without Supabase: starts the dev API
// (scripts/tprm/dev-server.ts) and Vite, and opens pages with a stubbed Supabase session.
// Used by ui-check.mjs and record-demo.mjs. Playwright is the machine's global install (NODE_PATH).

import { spawn } from 'child_process'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
export const { chromium } = require('playwright')

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const API_PORT = 3101
export const WEB_PORT = 5174
const SUPABASE = 'http://supabase.test'
const USER_ID = '00000000-0000-4000-8000-000000000001'
export const REQUEST_ID = '00000000-0000-4000-8000-0000000000aa'
export const PAGE = `http://localhost:${WEB_PORT}/inbox/${REQUEST_ID}/security-review`

const children = []

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

// real: the dev API uses Claude (needs ANTHROPIC_API_KEY) instead of the fake model
export async function startServers({ real = false } = {}) {
  await start('npx', ['tsx', 'scripts/tprm/dev-server.ts', '--port', String(API_PORT), ...(real ? ['--real'] : [])], {}, 'dev API on')
  await start('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], {
    VITE_SUPABASE_URL: SUPABASE, VITE_SUPABASE_ANON_KEY: 'anon', VITE_API_BASE_URL: `http://localhost:${API_PORT}`,
  }, 'Local:')
}

export function stopServers() {
  for (const c of children) {
    try { process.kill(-c.pid, 'SIGTERM') } catch { /* already gone */ }
  }
}

// The one inbox request the stubbed Supabase returns (shape of an inbox_requests row)
const INBOX_REQUEST = {
  id: REQUEST_ID, supplier_id: 'sup-dev', type: 'compliance', priority: 'high', deadline: '2026-11-13',
  received_at: '2026-10-27T15:30:00Z', from_buyer: 'Clearfield Financial', from_contact: 'Priya Anand',
  from_email: 'p.anand@clearfieldfinancial.com', from_platform: 'Email / Manual',
  subject: 'Vendor Security Questionnaire (SIG-Lite)', body: 'Please complete the attached questionnaire.',
  status: 'pending_response', tags: ['security-review'], attachments: ['clearfield_vendor_security_questionnaire.xlsx'],
}

const session = {
  access_token: 'dev-token', refresh_token: 'dev-refresh', token_type: 'bearer', expires_in: 3600 * 24 * 365,
  expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365,
  user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'dev@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
}

export async function newPage(browser, contextOptions) {
  const context = await browser.newContext(contextOptions)
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), ['sb-supabase-auth-token', JSON.stringify(session)])
  await context.route(`${SUPABASE}/**`, (route) => {
    const url = route.request().url()
    // supabase-js asks for one object with .single(), otherwise a list
    const single = (route.request().headers().accept ?? '').includes('vnd.pgrst.object')
    const row = url.includes('/rest/v1/suppliers') ? { id: 'sup-dev', company_name: 'Acme Tech Solutions Inc.' }
      : url.includes('/rest/v1/inbox_requests') ? INBOX_REQUEST
      : null
    const body = row ? (single ? row : [row]) : url.includes('/auth/v1/user') ? session.user : {}
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
