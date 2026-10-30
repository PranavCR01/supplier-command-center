import type { DraftedAnswer, Readiness } from '../../../types/index.js'
import { GoldEvidence, GoldLocation, GoldQuestion, passageMatches } from './scoreEvidence.js'

// Scores drafted answers (steps 3-4) against test_data/tprm/gold.json. Headline metrics are the
// safety ones from docs/security-review-plan.md; accuracy metrics are secondary.

export interface GoldAnswerQuestion extends GoldQuestion {
  acceptable_answers?: string[]
  expected_reasons?: string[]
  must_mention?: string[]
}

export interface GoldAnswers extends GoldEvidence {
  version: string
  questions: GoldAnswerQuestion[]
}

export interface QuestionOutcome {
  ref: string
  readiness: Readiness
  expected: Readiness
  readinessOk: boolean
  answer: string | null
  expectedAnswer: string
  answerOk: boolean
  unsafe: boolean
  reasons: string[]
  missingReasons: string[]          // expected_reasons not produced (informational)
  missingMentions: string[]
  citations: { correct: number; total: number }
}

export interface AnswerScore {
  unsafeReady: string[]
  conflictRecall: { caught: string[]; missed: string[] }
  conflictFalsePositives: string[]
  decoysFlagged: string[]
  needsEvidenceRecall: { caught: string[]; missed: string[] }
  readinessAccuracy: { correct: number; total: number }
  answerAccuracy: { correct: number; total: number }
  citationAccuracy: { correct: number; total: number }
  mustMention: { correct: number; total: number }
  readyCount: number
  outcomes: QuestionOutcome[]
}

const accepts = (q: GoldAnswerQuestion, r: Readiness) => q.expected_readiness === r || (q.acceptable_readiness ?? []).includes(r)

export function scoreAnswers(gold: GoldAnswers, answers: DraftedAnswer[]): AnswerScore {
  const file = (key: string) => gold.documents[key]?.file ?? key
  const byRef = new Map(answers.map((a) => [a.question_ref, a]))
  const score: AnswerScore = {
    unsafeReady: [], conflictRecall: { caught: [], missed: [] }, conflictFalsePositives: [], decoysFlagged: [],
    needsEvidenceRecall: { caught: [], missed: [] }, readinessAccuracy: { correct: 0, total: 0 },
    answerAccuracy: { correct: 0, total: 0 }, citationAccuracy: { correct: 0, total: 0 }, mustMention: { correct: 0, total: 0 },
    readyCount: 0, outcomes: [],
  }

  for (const q of gold.questions) {
    // A missing answer counts as held back (needs_evidence) with no answer: it can't be unsafe
    const a = byRef.get(q.ref)
    const readiness: Readiness = a?.readiness ?? 'needs_evidence'
    const answer = a?.answer ?? null
    const answerOk = answer !== null && (answer === q.expected_answer || (q.acceptable_answers ?? []).includes(answer))
    const readinessOk = accepts(q, readiness)
    // Ready is unsafe if gold never allows Ready here, or if the answer itself is wrong
    const unsafe = readiness === 'ready' && (!accepts(q, 'ready') || !answerOk)

    const goldLocations: GoldLocation[] = [...q.evidence, ...(q.conflict ? [q.conflict.a, ...q.conflict.b] : [])]
    const cited = (a?.evidence ?? []).filter((e) => e.cited)
    const citationsCorrect = cited.filter((p) => goldLocations.some((g) => passageMatches(p, file(g.doc), g))).length

    const text = (a?.response_text ?? '').toLowerCase()
    const missingMentions = (q.must_mention ?? []).filter((m) => !text.includes(m.toLowerCase()))

    const outcome: QuestionOutcome = {
      ref: q.ref, readiness, expected: q.expected_readiness, readinessOk, answer, expectedAnswer: q.expected_answer,
      answerOk, unsafe, reasons: a?.reasons ?? [],
      missingReasons: (q.expected_reasons ?? []).filter((r) => !(a?.reasons ?? []).includes(r as never)),
      missingMentions, citations: { correct: citationsCorrect, total: cited.length },
    }
    score.outcomes.push(outcome)

    if (unsafe) score.unsafeReady.push(q.ref)
    if (readiness === 'ready') score.readyCount++
    const conflictRequired = q.expected_readiness === 'conflict' && !(q.acceptable_readiness ?? []).includes('needs_evidence')
    if (conflictRequired) (readiness === 'conflict' ? score.conflictRecall.caught : score.conflictRecall.missed).push(q.ref)
    if (readiness === 'conflict' && !accepts(q, 'conflict')) score.conflictFalsePositives.push(q.ref)
    if (q.decoy_conflict && readiness === 'conflict') score.decoysFlagged.push(q.ref)
    if (q.expected_readiness === 'needs_evidence') {
      (readiness !== 'ready' ? score.needsEvidenceRecall.caught : score.needsEvidenceRecall.missed).push(q.ref)
    }

    score.readinessAccuracy.total++
    if (readinessOk) score.readinessAccuracy.correct++
    score.answerAccuracy.total++
    if (answerOk) score.answerAccuracy.correct++
    score.citationAccuracy.correct += citationsCorrect
    score.citationAccuracy.total += cited.length
    score.mustMention.total += (q.must_mention ?? []).length
    score.mustMention.correct += (q.must_mention ?? []).length - missingMentions.length
  }
  return score
}
