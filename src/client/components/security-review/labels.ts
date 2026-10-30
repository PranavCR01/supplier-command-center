import type { AnswerValue, Locator, Readiness, ReadinessReason, ReviewStatus, SecurityDocType } from '../../../types'

export const READINESS_LABEL: Record<Readiness, string> = {
  ready: 'Ready',
  needs_evidence: 'Needs evidence',
  conflict: 'Conflict',
}

// Badges follow the design system: emerald = good, amber = attention, red = critical
export const READINESS_CLASS: Record<Readiness, string> = {
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  needs_evidence: 'bg-amber-50 text-amber-800 border-amber-200',
  conflict: 'bg-red-50 text-red-700 border-red-200',
}

export const ANSWER_LABEL: Record<AnswerValue, string> = {
  yes: 'Yes',
  no: 'No',
  partial: 'Partial',
  not_addressed: 'Not addressed',
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  edited: 'Edited and approved',
  rejected: 'Rejected',
}

// What each code check means, in words a reviewer can act on
export const REASON_LABEL: Record<ReadinessReason, string> = {
  CONFLICT: 'Documents disagree',
  SCHEMA_INVALID: 'AI step failed — check manually',
  NO_EVIDENCE: 'No evidence in the documents',
  PAGE_OUT_OF_RANGE: 'Cited page does not exist',
  QUOTE_NOT_FOUND: 'Quote not found where cited',
  LOW_TEXT: 'Cited page is a scan with no text',
  UNSUPPORTED_NUMBER: 'Number not in the cited pages',
  CONTROL_EXCEPTION: 'Relies on an auditor exception or open finding',
  CARVE_OUT: 'Relies on a carved-out subservice provider',
  GAP_DISCLOSED: 'Admits a gap — vendor sign-off needed',
  VERIFIER_UNSUPPORTED: 'Second check: not supported',
  VERIFIER_PARTIAL: 'Second check: overstated',
  LOW_CONFIDENCE: 'Low model confidence',
}

export const DOC_TYPE_LABEL: Record<SecurityDocType, string> = {
  soc2_report: 'SOC 2 report',
  pentest_summary: 'Pen test summary',
  phishing_summary: 'Phishing / awareness',
  security_policy: 'Security policy',
  access_review: 'Access review',
  questionnaire: 'Questionnaire',
  other: 'Other',
}

export const SETTABLE_DOC_TYPES: SecurityDocType[] = [
  'soc2_report', 'pentest_summary', 'phishing_summary', 'security_policy', 'access_review', 'other',
]

export function locatorLabel(locator: Locator | null): string {
  if (!locator) return 'no location'
  if ('page' in locator) return `p. ${locator.page}`
  return locator.row_start === locator.row_end
    ? `${locator.sheet}, row ${locator.row_start}`
    : `${locator.sheet}, rows ${locator.row_start}–${locator.row_end}`
}

export const shortName = (filename: string) => filename.replace(/\.(pdf|xlsx)$/i, '').replace(/[_-]+/g, ' ')

export const EVENT_LABEL: Record<string, string> = {
  document_uploaded: 'Document uploaded',
  document_parsed: 'Document parsed',
  document_parse_failed: 'Document could not be parsed',
  document_storage_failed: 'Original file not stored',
  document_classified: 'AI classified document',
  findings_extracted: 'AI extracted findings',
  document_summarized: 'AI summarized document',
  document_analysis_failed: 'Document analysis failed',
  document_type_set: 'Document type corrected',
  questionnaire_run_started: 'Questionnaire run started',
  questionnaire_run_completed: 'Questionnaire run completed',
  questionnaire_run_failed: 'Questionnaire run failed',
  answer_conflict_detected: 'AI flagged a conflict',
  answer_approved: 'Answer approved',
  answer_edited: 'Answer edited and approved',
  conflict_resolved: 'Conflict resolved',
  answer_rejected: 'Answer rejected',
  remediation_generated: 'Remediation items generated',
  remediation_updated: 'Remediation item updated',
}
