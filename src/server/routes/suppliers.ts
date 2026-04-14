import { Router, Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, AuthRequest } from '../middleware/auth'

const router = Router()

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/suppliers/me — get current user's supplier profile
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('user_id', req.userId)
      .single()

    if (error) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }
    res.json(data)
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PATCH /api/suppliers/me — update supplier profile
router.patch('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const allowedFields = [
      'company_name', 'dba', 'founded_year', 'headquarters',
      'employees', 'annual_revenue', 'website', 'ein',
    ]
    const updates: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (field in req.body) updates[field] = req.body[field]
    }
    updates.updated_at = new Date().toISOString()

    const { data: supplier } = await supabase
      .from('suppliers')
      .select('id')
      .eq('user_id', req.userId)
      .single()

    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found' })
      return
    }

    const { data, error } = await supabase
      .from('suppliers')
      .update(updates)
      .eq('id', supplier.id)
      .select()
      .single()

    if (error) {
      res.status(400).json({ error: error.message })
      return
    }
    res.json(data)
  } catch {
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
