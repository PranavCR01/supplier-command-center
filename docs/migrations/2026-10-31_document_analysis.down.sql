-- Rollback for 2026-10-31_document_analysis.sql
-- Deletes access_review_exception findings so the original kind CHECK can be restored.

BEGIN;

DELETE FROM document_findings WHERE kind = 'access_review_exception';
ALTER TABLE document_findings DROP CONSTRAINT IF EXISTS document_findings_kind_check;
ALTER TABLE document_findings ADD CONSTRAINT document_findings_kind_check
  CHECK (kind IN ('control', 'control_exception', 'carve_out', 'pentest_finding',
                  'phishing_metric', 'policy_statement'));

ALTER TABLE security_documents DROP CONSTRAINT IF EXISTS security_documents_analysis_status_check;
ALTER TABLE security_documents
  DROP COLUMN IF EXISTS analysis_error,
  DROP COLUMN IF EXISTS analysis_status;

COMMIT;
