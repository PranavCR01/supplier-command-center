import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import suppliersRouter from './routes/suppliers.js'
import aiRouter from './routes/ai.js'
import { createSecurityReviewRouter } from './routes/securityReview.js'
import { requireAuth } from './middleware/auth.js'
import { errorHandler } from './middleware/error.js'
import { AnthropicTprmLlm } from './services/tprm/llm.js'
import { SupabaseSecurityReviewStore } from './services/tprm/store.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(helmet())
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.ALLOWED_ORIGIN ?? false)
    : true,
  // Lets the browser read the export filename on cross-origin downloads
  exposedHeaders: ['Content-Disposition'],
}))
app.use(morgan('dev'))
app.use(express.json())

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/api/suppliers', suppliersRouter)
app.use('/api/ai', aiRouter)
app.use('/api/security-review', createSecurityReviewRouter({
  store: new SupabaseSecurityReviewStore(
    createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  ),
  requireAuth,
  samplesDir: path.join(__dirname, '../../test_data/tprm/documents'),
  llm: process.env.ANTHROPIC_API_KEY ? new AnthropicTprmLlm() : null,
}))

app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
