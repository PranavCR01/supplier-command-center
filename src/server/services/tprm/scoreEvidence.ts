import type { EvidencePassage } from '../../../types/index.js'
import type { QuestionEvidence } from './evidence.js'

// Scores step 3 output (gathered evidence + conflict check) against test_data/tprm/gold.json.

export interface GoldLocation {
  doc: string
  page?: number
  sheet?: string
  row?: number
  anchor: string
}

export interface GoldQuestion {
  ref: string
  expected_answer: string
  expected_readiness: 'ready' | 'needs_evidence' | 'conflict'
  acceptable_readiness?: string[]
  decoy_conflict?: boolean
  evidence: GoldLocation[]
  conflict?: { a: GoldLocation; b: GoldLocation[] }
}

export interface GoldEvidence {
  documents: Record<string, { file: string }>
  questions: GoldQuestion[]
}

export interface ConflictOutcome {
  ref: string
  detected: boolean
  pairCorrect: boolean | null      // null when not detected or no gold pair
  explanation: string | null
}

export interface EvidenceScore {
  evidenceRecall: { hit: number; total: number }
  perQuestionRecall: { ref: string; hit: number; total: number; missed: string[] }[]
  conflictRecall: { caught: number; total: number; outcomes: ConflictOutcome[] }
  optionalConflicts: ConflictOutcome[]           // gold accepts Conflict or Needs Evidence
  falsePositives: ConflictOutcome[]              // conflict flagged where gold says none
  decoys: ConflictOutcome[]
  trapSupports: { ref: string; passages: string[] }[]   // "supports" evidence on not-addressed questions
  quotes: { verified: number; total: number }
  failures: string[]
}

export function passageMatches(p: EvidencePassage, goldDocFile: string, g: GoldLocation): boolean {
  if (!p.quote_verified || !p.locator || p.filename !== goldDocFile) return false
  if (g.page !== undefined) return 'page' in p.locator && p.locator.page === g.page
  if (g.sheet !== undefined && g.row !== undefined) {
    return 'sheet' in p.locator && p.locator.sheet === g.sheet && g.row >= p.locator.row_start && g.row <= p.locator.row_end
  }
  return false
}

function describe(g: GoldLocation): string {
  return g.page !== undefined ? `${g.doc} p.${g.page}` : `${g.doc} ${g.sheet} row ${g.row}`
}

export function scoreEvidence(gold: GoldEvidence, results: QuestionEvidence[]): EvidenceScore {
  const file = (key: string) => gold.documents[key]?.file ?? key
  const byRef = new Map(results.map((r) => [r.ref, r]))
  const score: EvidenceScore = {
    evidenceRecall: { hit: 0, total: 0 }, perQuestionRecall: [], conflictRecall: { caught: 0, total: 0, outcomes: [] },
    optionalConflicts: [], falsePositives: [], decoys: [], trapSupports: [], quotes: { verified: 0, total: 0 }, failures: [],
  }

  for (const q of gold.questions) {
    const r = byRef.get(q.ref)
    if (!r) {
      score.failures.push(`${q.ref}: no result`)
      continue
    }
    if (r.status === 'failed') score.failures.push(`${q.ref}: ${r.error}`)
    if (r.conflict.status === 'failed') score.failures.push(`${q.ref}: ${r.conflict.error}`)

    const missed = q.evidence.filter((g) => !r.passages.some((p) => passageMatches(p, file(g.doc), g)))
    const hit = q.evidence.length - missed.length
    score.evidenceRecall.hit += hit
    score.evidenceRecall.total += q.evidence.length
    if (q.evidence.length) score.perQuestionRecall.push({ ref: q.ref, hit, total: q.evidence.length, missed: missed.map(describe) })

    const detected = r.conflict.status === 'detected'
    let pairCorrect: boolean | null = null
    if (detected && q.conflict && r.conflict.status === 'detected') {
      const { a, b } = r.conflict.conflict
      const goldA = file(q.conflict.a.doc)
      const goldB = new Set(q.conflict.b.map((x) => file(x.doc)))
      pairCorrect = Boolean(a && b) && ((a!.filename === goldA && goldB.has(b!.filename)) || (b!.filename === goldA && goldB.has(a!.filename)))
    }
    const outcome: ConflictOutcome = {
      ref: q.ref, detected, pairCorrect,
      explanation: r.conflict.status === 'detected' ? r.conflict.conflict.explanation : r.conflict.status === 'none' ? r.conflict.explanation : null,
    }

    const conflictOk = q.expected_readiness === 'conflict' || (q.acceptable_readiness ?? []).includes('conflict')
    const conflictRequired = q.expected_readiness === 'conflict' && !(q.acceptable_readiness ?? []).includes('needs_evidence')
    if (conflictRequired) {
      score.conflictRecall.total++
      if (detected) score.conflictRecall.caught++
      score.conflictRecall.outcomes.push(outcome)
    } else if (conflictOk) {
      score.optionalConflicts.push(outcome)
    } else if (detected) {
      score.falsePositives.push(outcome)
    }
    if (q.decoy_conflict) score.decoys.push(outcome)

    if (q.expected_answer === 'not_addressed') {
      const supports = r.passages.filter((p) => p.quote_verified && p.stance === 'supports')
      if (supports.length) score.trapSupports.push({ ref: q.ref, passages: supports.map((p) => `${p.filename}: ${p.quote}`) })
    }

    score.quotes.total += r.passages.length
    score.quotes.verified += r.passages.filter((p) => p.quote_verified).length
  }
  return score
}
