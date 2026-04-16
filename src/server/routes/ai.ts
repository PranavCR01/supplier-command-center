import { Router, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, AuthRequest } from '../middleware/auth.js'
import { streamDraft, callJson } from '../services/claude.js'
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

const GAP_SYSTEM_PROMPT =
  'You are a procurement analyst. Analyze RFP requirements against a supplier profile. Return ONLY valid JSON, no other text.'

const TONE_SYSTEM_PROMPT =
  'You are a procurement communication analyst. Analyze buyer messages. Return ONLY valid JSON, no other text.'

// POST /api/ai/analyze-gap — gap analysis for rfp/rfq/onboarding
router.post('/analyze-gap', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.body as { requestId: string }

    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', req.userId)
      .single()

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }

    const [{ data: inboxRequest }, { data: certs }] = await Promise.all([
      supabase
        .from('inbox_requests')
        .select('type, body')
        .eq('id', requestId)
        .eq('supplier_id', supplier.id)
        .single(),
      supabase
        .from('certifications')
        .select('name, status')
        .eq('supplier_id', supplier.id),
    ])

    if (!inboxRequest) {
      res.status(404).json({ error: 'Request not found' })
      return
    }

    const certList = (certs ?? []).map((c) => `${c.name} (${c.status})`).join(', ')

    const userMessage =
      `Request type: ${inboxRequest.type}\n` +
      `Request body (first 1500 chars): ${(inboxRequest.body ?? '').slice(0, 1500)}\n` +
      `Supplier certifications: ${certList || 'none'}\n` +
      `Supplier capabilities: []\n\n` +
      `Return JSON: {"strengths":["string (max 3, one sentence each)"],"gaps":["string (max 3, one sentence each)"]}`

    const raw = await callJson(GAP_SYSTEM_PROMPT, userMessage, 300)
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned) as { strengths: string[]; gaps: string[] }

    res.json(parsed)
  } catch {
    res.status(500).json({ error: 'Analysis failed' })
  }
})

// POST /api/ai/analyze-tone — communication tone analysis
router.post('/analyze-tone', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.body as { requestId: string }

    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', req.userId)
      .single()

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }

    const { data: inboxRequest } = await supabase
      .from('inbox_requests')
      .select('subject, type, body')
      .eq('id', requestId)
      .eq('supplier_id', supplier.id)
      .single()

    if (!inboxRequest) {
      res.status(404).json({ error: 'Request not found' })
      return
    }

    const userMessage =
      `Subject: ${inboxRequest.subject ?? ''}\n` +
      `Type: ${inboxRequest.type}\n` +
      `Message: ${(inboxRequest.body ?? '').slice(0, 800)}\n\n` +
      `Return JSON: {"urgency":"low"|"medium"|"high"|"critical","sentiment":"positive"|"neutral"|"concerned"|"demanding","relationship_risk":"low"|"medium"|"high","recommended_tone":"string (max 12 words)","key_deadline":"string or null"}`

    const raw = await callJson(TONE_SYSTEM_PROMPT, userMessage, 300)
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned) as {
      urgency: string
      sentiment: string
      relationship_risk: string
      recommended_tone: string
      key_deadline: string | null
    }

    res.json(parsed)
  } catch {
    res.status(500).json({ error: 'Analysis failed' })
  }
})

const SURVEY_SYSTEM_PROMPT =
  'You are a procurement compliance assistant. Help suppliers complete ESG and diversity surveys using their profile data. Return ONLY valid JSON, no other text.'

// POST /api/ai/auto-complete-survey — ESG/diversity survey auto-fill
router.post('/auto-complete-survey', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { requestId } = req.body as { requestId: string }

    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id, company_name, headquarters, employees, founded_year')
      .eq('user_id', req.userId)
      .single()

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }

    const [{ data: inboxRequest }, { data: certs }] = await Promise.all([
      supabase
        .from('inbox_requests')
        .select('body')
        .eq('id', requestId)
        .eq('supplier_id', supplier.id)
        .single(),
      supabase
        .from('certifications')
        .select('name, issuer, expiry_date')
        .eq('supplier_id', supplier.id)
        .eq('category', 'diversity'),
    ])

    if (!inboxRequest) {
      res.status(404).json({ error: 'Request not found' })
      return
    }

    const certLines = (certs ?? [])
      .map((c) => `- ${c.name} (issuer: ${c.issuer ?? 'N/A'}, expires: ${c.expiry_date ?? 'N/A'})`)
      .join('\n')

    const userMessage =
      `Survey questions/body: ${(inboxRequest.body ?? '').slice(0, 800)}\n` +
      `Supplier diversity certifications:\n${certLines || 'none'}\n` +
      `Company: ${supplier.company_name}, HQ: ${supplier.headquarters ?? 'N/A'}, ` +
      `Employees: ${supplier.employees ?? 'N/A'}, Founded: ${supplier.founded_year ?? 'N/A'}\n\n` +
      `Return JSON array of answered questions:\n` +
      `[{ "question": "string", "answer": "string" }]\n` +
      `Max 8 items. Keep answers concise, professional, factual. Only answer what can be supported by the profile data provided.`

    const raw = await callJson(SURVEY_SYSTEM_PROMPT, userMessage, 800)
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(cleaned) as { question: string; answer: string }[]

    if (!Array.isArray(parsed)) {
      res.status(500).json({ error: 'Invalid response format' })
      return
    }

    res.json({ answers: parsed })
  } catch {
    res.status(500).json({ error: 'Auto-complete failed' })
  }
})

export default router
