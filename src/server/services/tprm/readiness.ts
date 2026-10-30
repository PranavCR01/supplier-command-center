import type { CitationFailure, Readiness, ReadinessReason, VerifierVerdict } from '../../../types/index.js'
import { READINESS_REASONS } from '../../../types/index.js'

export const MIN_CONFIDENCE = 0.7

export interface ReadinessInput {
  conflictDetected: boolean
  // A model call failed or returned output that failed validation (gather, conflict, draft, verify)
  callFailed: boolean
  // Verified passages the answer cites; 0 means the answer stands on nothing checked
  citedVerified: number
  answerNotAddressed: boolean
  // "partial" or "no": the vendor is admitting a gap to a customer, which the vendor signs off on
  answerAdmitsGap: boolean
  // The draft cited a passage number that was never given to it
  citedOutOfRange: boolean
  // Failed quote checks that matter: adverse passages that never reached the drafter, or
  // every passage when none verified
  quoteFailures: CitationFailure[]
  unsupportedNumbers: string[]
  reliesOnException: boolean
  reliesOnCarveOut: boolean
  verifierVerdict: VerifierVerdict | null
  confidence: number | null
}

const FAILURE_REASON: Record<CitationFailure, ReadinessReason> = {
  NO_LOCATION: 'PAGE_OUT_OF_RANGE',
  PAGE_OUT_OF_RANGE: 'PAGE_OUT_OF_RANGE',
  QUOTE_NOT_FOUND: 'QUOTE_NOT_FOUND',
  LOW_TEXT: 'LOW_TEXT',
}

// The readiness rules from docs/security-review-plan.md, in code. Every rule that applies is
// recorded; the first in rule order sets readiness. Model confidence is checked last and can
// only ever hold an answer back, never make it Ready.
export function decideReadiness(i: ReadinessInput): { readiness: Readiness; reasons: ReadinessReason[] } {
  const hit = new Set<ReadinessReason>()
  if (i.conflictDetected) hit.add('CONFLICT')
  if (i.callFailed) hit.add('SCHEMA_INVALID')
  if (i.citedVerified === 0 || i.answerNotAddressed) hit.add('NO_EVIDENCE')
  if (i.citedOutOfRange) hit.add('PAGE_OUT_OF_RANGE')
  for (const f of i.quoteFailures) hit.add(FAILURE_REASON[f])
  if (i.unsupportedNumbers.length > 0) hit.add('UNSUPPORTED_NUMBER')
  if (i.reliesOnException) hit.add('CONTROL_EXCEPTION')
  if (i.reliesOnCarveOut) hit.add('CARVE_OUT')
  if (i.answerAdmitsGap) hit.add('GAP_DISCLOSED')
  if (i.verifierVerdict === 'unsupported') hit.add('VERIFIER_UNSUPPORTED')
  if (i.verifierVerdict === 'partially_supported') hit.add('VERIFIER_PARTIAL')
  if (i.confidence === null || i.confidence < MIN_CONFIDENCE) hit.add('LOW_CONFIDENCE')

  // Ready needs a positive verdict, not just the absence of a negative one: if a code path ever
  // skips the verifier, the answer must not become Ready by default
  if (hit.size === 0 && i.verifierVerdict !== 'supported') hit.add('VERIFIER_UNSUPPORTED')

  const reasons = READINESS_REASONS.filter((r) => hit.has(r))
  if (reasons[0] === 'CONFLICT') return { readiness: 'conflict', reasons }
  return { readiness: reasons.length === 0 ? 'ready' : 'needs_evidence', reasons }
}
