-- =============================================
-- Migration: Security review (vendor-side TPRM)
-- Date: 2026-10-30
-- Additive only: creates new tables, one private storage bucket, RLS, indexes.
-- Does NOT alter any existing table. Safe to run on the live project.
-- Idempotent: safe to re-run. Rollback: 2026-10-30_security_review.down.sql
-- =============================================

BEGIN;

-- ---------------------------------------------
-- Documents uploaded against a request
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS security_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id      uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  request_id       uuid REFERENCES inbox_requests(id) ON DELETE CASCADE,
  filename         text NOT NULL,
  storage_path     text,                      -- path in the security-docs bucket
  mime_type        text NOT NULL,
  sha256           text NOT NULL,
  role             text NOT NULL DEFAULT 'evidence'
                     CHECK (role IN ('evidence', 'questionnaire')),
  doc_type         text
                     CHECK (doc_type IN ('soc2_report', 'pentest_summary', 'phishing_summary',
                                         'security_policy', 'access_review', 'questionnaire', 'other')),
  doc_type_source  text CHECK (doc_type_source IN ('ai', 'user')),
  parse_status     text NOT NULL DEFAULT 'pending'
                     CHECK (parse_status IN ('pending', 'parsed', 'failed')),
  parse_error      text,
  unit_count       integer,
  summary          jsonb,                     -- structured summary card
  summary_prompt_version text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, sha256)
);

-- Parsed text, one row per PDF page or spreadsheet row range
CREATE TABLE IF NOT EXISTS document_units (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES security_documents(id) ON DELETE CASCADE,
  unit_index   integer NOT NULL,
  locator      jsonb NOT NULL,   -- {"page": 4} or {"sheet": "Q2", "row_start": 2, "row_end": 40}
  text         text NOT NULL,
  UNIQUE (document_id, unit_index)
);

-- Structured findings extracted from each document
CREATE TABLE IF NOT EXISTS document_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id      uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  document_id      uuid NOT NULL REFERENCES security_documents(id) ON DELETE CASCADE,
  kind             text NOT NULL
                     CHECK (kind IN ('control', 'control_exception', 'carve_out',
                                     'pentest_finding', 'phishing_metric', 'policy_statement')),
  ref              text,          -- control ID (CC6.2), finding ID (PT-03), etc.
  title            text NOT NULL,
  stated_severity  text,          -- copied from the source document, never inferred
  status           text,          -- e.g. no_exceptions | exceptions_noted | open | remediated
  detail           text,
  locator          jsonb NOT NULL,
  quote            text,
  quote_verified   boolean NOT NULL DEFAULT false,
  prompt_version   text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------
-- Questionnaire answering
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS questionnaire_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id           uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  request_id            uuid NOT NULL REFERENCES inbox_requests(id) ON DELETE CASCADE,
  questionnaire_doc_id  uuid NOT NULL REFERENCES security_documents(id) ON DELETE CASCADE,
  status                text NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'completed', 'failed')),
  model                 text NOT NULL,
  prompt_versions       jsonb NOT NULL,
  stats                 jsonb,      -- counts per readiness, tokens, cache hits, duration
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE TABLE IF NOT EXISTS questionnaire_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  run_id          uuid NOT NULL REFERENCES questionnaire_runs(id) ON DELETE CASCADE,
  question_ref    text NOT NULL,     -- e.g. "IAM-03"
  domain          text,
  question_text   text NOT NULL,
  answer          text CHECK (answer IN ('yes', 'no', 'partial', 'not_addressed')),
  response_text   text,
  evidence        jsonb NOT NULL DEFAULT '[]',
                  -- [{document_id, locator, quote, quote_verified, stance}]
  conflict        jsonb,             -- {a: evidence, b: evidence, explanation}
  verifier        jsonb,             -- {verdict, reason}
  model_confidence numeric(3,2),
  readiness       text NOT NULL
                    CHECK (readiness IN ('ready', 'needs_evidence', 'conflict')),
  reasons         text[] NOT NULL DEFAULT '{}',
  review_status   text NOT NULL DEFAULT 'pending'
                    CHECK (review_status IN ('pending', 'approved', 'edited', 'rejected')),
  final_text      text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, question_ref)
);

DROP TRIGGER IF EXISTS questionnaire_answers_updated_at ON questionnaire_answers;
CREATE TRIGGER questionnaire_answers_updated_at
  BEFORE UPDATE ON questionnaire_answers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------
-- Remediation items (Jira-style export)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS remediation_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id       uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  request_id        uuid REFERENCES inbox_requests(id) ON DELETE SET NULL,
  finding_id        uuid REFERENCES document_findings(id) ON DELETE SET NULL,
  title             text NOT NULL,
  description       text,
  severity          text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  owner_contact_id  uuid REFERENCES supplier_contacts(id) ON DELETE SET NULL,
  owner_name        text,
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'in_progress', 'done', 'risk_accepted')),
  due_date          date,
  source            text NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'user')),
  external_key      text,              -- e.g. Jira issue key after import
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id)
);

DROP TRIGGER IF EXISTS remediation_items_updated_at ON remediation_items;
CREATE TRIGGER remediation_items_updated_at
  BEFORE UPDATE ON remediation_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------
-- Activity timeline (append-only)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS activity_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  request_id   uuid REFERENCES inbox_requests(id) ON DELETE CASCADE,
  actor        text NOT NULL CHECK (actor IN ('user', 'ai', 'system')),
  actor_id     uuid,                  -- auth user id when actor = 'user'
  event_type   text NOT NULL,         -- document_uploaded, answer_drafted, conflict_detected,
                                      -- answer_approved, answer_edited, remediation_created, ...
  entity_type  text,
  entity_id    uuid,
  payload      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Block UPDATE on the log, including from the service role.
-- Users cannot DELETE (no RLS delete policy); rows still go away via
-- ON DELETE CASCADE when the supplier or request is deleted.
CREATE OR REPLACE FUNCTION activity_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'activity_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activity_events_no_update ON activity_events;
CREATE TRIGGER activity_events_no_update
  BEFORE UPDATE ON activity_events
  FOR EACH ROW EXECUTE FUNCTION activity_events_append_only();

-- ---------------------------------------------
-- Row level security
-- ---------------------------------------------
ALTER TABLE security_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_units         ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_findings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE questionnaire_answers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE remediation_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['security_documents', 'document_units', 'document_findings',
                           'questionnaire_runs', 'questionnaire_answers', 'remediation_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "owner" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "owner" ON %I FOR ALL USING (supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid()))',
      t);
  END LOOP;
END $$;

-- activity_events: read and insert only, no update/delete policy
DROP POLICY IF EXISTS "owner_select" ON activity_events;
CREATE POLICY "owner_select" ON activity_events
  FOR SELECT USING (supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "owner_insert" ON activity_events;
CREATE POLICY "owner_insert" ON activity_events
  FOR INSERT WITH CHECK (supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid()));

-- ---------------------------------------------
-- Indexes
-- ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_secdocs_request        ON security_documents(request_id);
CREATE INDEX IF NOT EXISTS idx_secdocs_supplier       ON security_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_units_document         ON document_units(document_id);
CREATE INDEX IF NOT EXISTS idx_findings_document      ON document_findings(document_id);
CREATE INDEX IF NOT EXISTS idx_runs_request           ON questionnaire_runs(request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answers_run            ON questionnaire_answers(run_id);
CREATE INDEX IF NOT EXISTS idx_answers_readiness      ON questionnaire_answers(run_id, readiness);
CREATE INDEX IF NOT EXISTS idx_remediation_request    ON remediation_items(request_id);
CREATE INDEX IF NOT EXISTS idx_activity_request_time  ON activity_events(request_id, created_at DESC);

-- ---------------------------------------------
-- Storage: private bucket for original files
-- No storage.objects policies: only the server (service role) reads/writes,
-- and the browser gets short-lived signed URLs.
-- ---------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'security-docs', 'security-docs', false, 10485760,
  ARRAY['application/pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO NOTHING;

COMMIT;
