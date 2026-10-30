-- =============================================
-- Migration: Security review additions (steps 2 and 6)
-- Date: 2026-10-31
-- Touches only tables created by 2026-10-30_security_review.sql:
--   * security_documents: analysis_status + analysis_error
--   * document_findings: allow kind 'access_review_exception'
--   * questionnaire_runs: as_of (date questions were answered on)
--   * questionnaire_answers: unsupported_numbers, errors, question_row
-- Idempotent: safe to re-run. Rollback: 2026-10-31_security_review_additions.down.sql
-- =============================================

BEGIN;

ALTER TABLE security_documents
  ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS analysis_error  text;

ALTER TABLE security_documents DROP CONSTRAINT IF EXISTS security_documents_analysis_status_check;
ALTER TABLE security_documents ADD CONSTRAINT security_documents_analysis_status_check
  CHECK (analysis_status IN ('pending', 'running', 'analyzed', 'failed'));

-- The inline CHECK from the first migration is auto-named document_findings_kind_check
ALTER TABLE document_findings DROP CONSTRAINT IF EXISTS document_findings_kind_check;
ALTER TABLE document_findings ADD CONSTRAINT document_findings_kind_check
  CHECK (kind IN ('control', 'control_exception', 'carve_out', 'pentest_finding',
                  'phishing_metric', 'policy_statement', 'access_review_exception'));

ALTER TABLE questionnaire_runs
  ADD COLUMN IF NOT EXISTS as_of date;

ALTER TABLE questionnaire_answers
  ADD COLUMN IF NOT EXISTS unsupported_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS errors              text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS question_row        integer;

COMMIT;
