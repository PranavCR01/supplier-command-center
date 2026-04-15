import { Router, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { streamDraft } from '../services/claude.js'
import { buildUserMessage } from '../services/contextBuilder.js'

const router = Router()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/ai/draft/:requestId — return existing draft if one exists
router.get('/draft/:requestId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', req.userId)
      .single()

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }

    const { data: existing } = await supabase
      .from('ai_responses')
      .select('id, draft_content, status, tokens_used, created_at')
      .eq('request_id', req.params.requestId)
      .eq('supplier_id', supplier.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (!existing || !existing.draft_content) {
      res.status(404).json({ error: 'No draft found' })
      return
    }

    res.json({ draft: existing.draft_content, tokens: existing.tokens_used })
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /api/ai/draft/:requestId — generate new draft, stream via SSE
router.post('/draft/:requestId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', req.userId)
      .single()

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }

    // Verify the request belongs to this supplier
    const { data: inboxRequest } = await supabase
      .from('inbox_requests')
      .select('*')
      .eq('id', req.params.requestId)
      .eq('supplier_id', supplier.id)
      .single()

    if (!inboxRequest) {
      res.status(404).json({ error: 'Request not found' })
      return
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    let fullText = ''

    try {
      const userMessage = await buildUserMessage(supplier.id, inboxRequest, supabase)

      const { inputTokens, outputTokens } = await streamDraft(
        userMessage,
        (chunk) => {
          fullText += chunk
          sendEvent({ type: 'delta', text: chunk })
        }
      )

      const totalTokens = inputTokens + outputTokens

      // Persist draft
      await supabase.from('ai_responses').insert({
        request_id: req.params.requestId,
        supplier_id: supplier.id,
        draft_content: fullText,
        status: 'draft',
        tokens_used: totalTokens,
      })

      sendEvent({ type: 'done', tokens: totalTokens })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed'
      sendEvent({ type: 'error', message })
    }

    res.end()
  } catch {
    // SSE headers already sent — can't change status code
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    }
    res.end()
  }
})

export default router
