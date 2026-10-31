-- Rollback for 2026-11-01_final_answer.sql
ALTER TABLE questionnaire_answers DROP COLUMN IF EXISTS final_answer;
