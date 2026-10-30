// Local API for the security review UI without Supabase: the real security-review router on the
// in-memory store, with a fixed dev token instead of Supabase auth. Used by the UI check
// (scripts/tprm/ui-check.mjs) and for demoing the page offline. Production uses src/server/index.ts.
//
// Usage: npx tsx scripts/tprm/dev-server.ts [--real] [--port 3101]
//   default model: fake (instant, deterministic; IAM-01 is a conflict, everything else Ready)
//   --real: Claude Haiku via ANTHROPIC_API_KEY
// Auth: send "Authorization: Bearer dev-token". Supplier and request ids are fixed (see below).

import cors from 'cors'
import express, { RequestHandler } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AuthRequest } from '../../src/server/middleware/auth.js'
import { createSecurityReviewRouter } from '../../src/server/routes/securityReview.js'
import { AnthropicTprmLlm } from '../../src/server/services/tprm/llm.js'
import { MemorySecurityReviewStore } from '../../src/server/services/tprm/memoryStore.js'
import { fakePipelineLlm } from '../../src/server/services/tprm/testing/fakeLlm.js'

export const DEV_TOKEN = 'dev-token'
export const DEV_USER_ID = '00000000-0000-4000-8000-000000000001'
export const DEV_REQUEST_ID = '00000000-0000-4000-8000-0000000000aa'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const real = args.includes('--real')
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.PORT) || 3101

if (real && !process.env.ANTHROPIC_API_KEY) {
  console.error('--real needs ANTHROPIC_API_KEY')
  process.exit(2)
}

const store = new MemorySecurityReviewStore()
store.suppliers.set(DEV_USER_ID, 'sup-dev')
store.requests.set(DEV_REQUEST_ID, 'sup-dev')

const devAuth: RequestHandler = (req, res, next) => {
  if (req.header('authorization') !== `Bearer ${DEV_TOKEN}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  ;(req as AuthRequest).userId = DEV_USER_ID
  next()
}

const app = express()
app.use(cors())
app.use(express.json())
app.get('/health', (_req, res) => res.json({ status: 'ok' }))
app.use('/api/security-review', createSecurityReviewRouter({
  store,
  requireAuth: devAuth,
  samplesDir: path.join(ROOT, 'test_data/tprm/documents'),
  llm: real ? new AnthropicTprmLlm() : fakePipelineLlm({}, 40),
}))
app.listen(port, () => console.log(`security review dev API on http://localhost:${port} (${real ? 'Claude' : 'fake model'})`))
