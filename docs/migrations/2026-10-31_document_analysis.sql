-- =============================================
-- Migration: Security review step 2 (document analysis)
-- Date: 2026-10-31
-- Touches only tables created by 2026-10-30_security_review.sql:
--   * security_documents: analysis_status + analysis_error
--   * document_findings: allow kind 'access_review_exception'
-- Idempotent: safe to re-run. Rollback: 2026-10-31_document_analysis.down.sql
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

COMMIT;
