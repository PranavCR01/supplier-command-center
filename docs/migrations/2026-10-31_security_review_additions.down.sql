-- Rollback for 2026-10-31_security_review_additions.sql
-- Deletes access_review_exception findings so the original kind CHECK can be restored.

BEGIN;

ALTER TABLE questionnaire_answers
  DROP COLUMN IF EXISTS question_row,
  DROP COLUMN IF EXISTS errors,
  DROP COLUMN IF EXISTS unsupported_numbers;
ALTER TABLE questionnaire_runs DROP COLUMN IF EXISTS as_of;

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
