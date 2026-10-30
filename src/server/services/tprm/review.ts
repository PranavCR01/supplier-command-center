import * as z from 'zod/v4'
import type { QuestionnaireAnswerRow } from '../../../types/index.js'
import { SecurityReviewStore } from './store.js'

const MAX_TEXT = 4000

const text = z.string().trim().min(1, 'Text is required').max(MAX_TEXT)

export const ReviewSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('edit'), final_text: text }),
  // A conflict is resolved by choosing a side (or neither) and writing the answer to send
  z.object({ action: z.literal('resolve'), choice: z.enum(['a', 'b', 'custom']), final_text: text, note: z.string().trim().max(1000).optional() }),
  z.object({ action: z.literal('reject'), note: z.string().trim().max(1000).optional() }),
])
export type ReviewAction = z.infer<typeof ReviewSchema>

export class ReviewRejected extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message)
  }
}

const EVENT: Record<ReviewAction['action'], string> = {
  approve: 'answer_approved',
  edit: 'answer_edited',
  resolve: 'conflict_resolved',
  reject: 'answer_rejected',
}

// A human decision on one drafted answer. The AI's readiness and reasons stay on the row and
// go into the event, so the timeline shows what the reviewer overrode.
export async function reviewAnswer(
  store: SecurityReviewStore,
  ctx: { supplierId: string; requestId: string; userId: string | null },
  answer: QuestionnaireAnswerRow,
  body: unknown,
): Promise<QuestionnaireAnswerRow> {
  const parsed = ReviewSchema.safeParse(body)
  if (!parsed.success) throw new ReviewRejected(parsed.error.issues[0]?.message ?? 'Invalid review action', 400)
  const action = parsed.data
  const isConflict = answer.readiness === 'conflict'

  if (isConflict && (action.action === 'approve' || action.action === 'edit')) {
    throw new ReviewRejected('Resolve the conflict first: choose which document is right, then write the answer', 409)
  }
  if (!isConflict && action.action === 'resolve') throw new ReviewRejected('This answer has no conflict to resolve', 409)
  if (action.action === 'approve' && !answer.response_text?.trim()) {
    throw new ReviewRejected('There is no drafted text to approve; edit the answer instead', 409)
  }

  const patch: Pick<Partial<QuestionnaireAnswerRow>, 'review_status' | 'final_text' | 'reviewed_at'> = {
    reviewed_at: new Date().toISOString(),
    ...(action.action === 'approve' && { review_status: 'approved', final_text: null }),
    ...((action.action === 'edit' || action.action === 'resolve') && { review_status: 'edited', final_text: action.final_text }),
    ...(action.action === 'reject' && { review_status: 'rejected' }),
  }
  await store.updateAnswer(answer.id, patch)
  await store.logEvent({
    supplier_id: ctx.supplierId, request_id: ctx.requestId, actor: 'user', actor_id: ctx.userId,
    event_type: EVENT[action.action], entity_type: 'questionnaire_answer', entity_id: answer.id,
    payload: {
      question_ref: answer.question_ref, run_id: answer.run_id,
      ai_readiness: answer.readiness, ai_reasons: answer.reasons,
      ...(action.action === 'resolve' && { choice: action.choice }),
      ...('note' in action && action.note && { note: action.note }),
    },
  })
  return { ...answer, ...patch }
}
