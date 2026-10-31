-- =============================================
-- Migration: reviewer-chosen Response value (Yes / No / Partial / N/A)
-- Date: 2026-11-01
-- Additive: one nullable column on questionnaire_answers. The AI's own label stays in `answer`.
-- Idempotent: safe to re-run. Rollback: 2026-11-01_final_answer.down.sql
-- =============================================

ALTER TABLE questionnaire_answers
  ADD COLUMN IF NOT EXISTS final_answer text CHECK (final_answer IN ('yes', 'no', 'partial', 'n/a'));
