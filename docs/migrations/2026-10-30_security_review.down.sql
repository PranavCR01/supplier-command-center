-- Rollback for 2026-10-30_security_review.sql
-- Drops only what that migration created. Deletes all security-review data.
-- Delete the 'security-docs' bucket in the Dashboard (Storage -> bucket -> Delete);
-- Supabase blocks direct SQL deletes on storage tables.

BEGIN;

DROP TABLE IF EXISTS activity_events        CASCADE;
DROP TABLE IF EXISTS remediation_items      CASCADE;
DROP TABLE IF EXISTS questionnaire_answers  CASCADE;
DROP TABLE IF EXISTS questionnaire_runs     CASCADE;
DROP TABLE IF EXISTS document_findings      CASCADE;
DROP TABLE IF EXISTS document_units         CASCADE;
DROP TABLE IF EXISTS security_documents     CASCADE;
DROP FUNCTION IF EXISTS activity_events_append_only();

COMMIT;
