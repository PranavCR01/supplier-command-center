-- =============================================
-- Supplier Command Center — Supabase Schema
-- Run this in Supabase SQL Editor (full run)
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- TABLES
-- =============================================

CREATE TABLE suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name    text NOT NULL,
  dba             text,
  founded_year    integer,
  headquarters    text,
  employees       integer,
  annual_revenue  text,
  website         text,
  ein             text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE supplier_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  name          text NOT NULL,
  title         text,
  email         text,
  phone         text,
  is_primary    boolean DEFAULT false,
  type          text DEFAULT 'primary'  -- primary | ar | legal | technical
);

CREATE TABLE certifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  name          text NOT NULL,
  issuer        text,
  cert_number   text,
  issued_date   date,
  expiry_date   date,
  status        text DEFAULT 'active',  -- active | expiring_soon | critical | expired
  category      text DEFAULT 'certification',  -- certification | insurance | diversity
  required_by   text[] DEFAULT '{}'
);

CREATE TABLE buyer_relationships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id   uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  buyer_name    text NOT NULL,
  platform      text,
  vendor_id     text,
  since_date    date,
  annual_spend  text,
  status        text DEFAULT 'approved'  -- preferred | approved | onboarding | inactive
);

CREATE TABLE inbox_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  type            text NOT NULL,       -- rfp | rfq | rfi | compliance | onboarding | survey
  priority        text DEFAULT 'medium',  -- urgent | high | medium | low
  deadline        date,
  received_at     timestamptz DEFAULT now(),
  from_buyer      text,
  from_contact    text,
  from_email      text,
  from_platform   text,
  subject         text,
  body            text,
  status          text DEFAULT 'pending_response',  -- pending_response | in_progress | submitted | urgent_action
  tags            text[] DEFAULT '{}',
  attachments     text[] DEFAULT '{}'  -- Supabase storage paths
);

CREATE TABLE ai_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      uuid REFERENCES inbox_requests(id) ON DELETE CASCADE,
  supplier_id     uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  draft_content   text,
  final_content   text,
  status          text DEFAULT 'draft',  -- draft | edited | submitted
  tokens_used     integer,
  created_at      timestamptz DEFAULT now()
);

-- =============================================
-- AUTO-UPDATE updated_at ON suppliers
-- =============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================

ALTER TABLE suppliers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_responses        ENABLE ROW LEVEL SECURITY;

-- suppliers: own row only
CREATE POLICY "owner" ON suppliers
  FOR ALL USING (auth.uid() = user_id);

-- all child tables: access via parent supplier
CREATE POLICY "owner" ON supplier_contacts
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "owner" ON certifications
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "owner" ON buyer_relationships
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "owner" ON inbox_requests
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "owner" ON ai_responses
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

-- =============================================
-- INDEXES (performance)
-- =============================================

CREATE INDEX idx_suppliers_user_id         ON suppliers(user_id);
CREATE INDEX idx_contacts_supplier_id      ON supplier_contacts(supplier_id);
CREATE INDEX idx_certs_supplier_id         ON certifications(supplier_id);
CREATE INDEX idx_certs_expiry              ON certifications(expiry_date);
CREATE INDEX idx_buyers_supplier_id        ON buyer_relationships(supplier_id);
CREATE INDEX idx_requests_supplier_id      ON inbox_requests(supplier_id);
CREATE INDEX idx_requests_status           ON inbox_requests(status);
CREATE INDEX idx_requests_deadline         ON inbox_requests(deadline);
CREATE INDEX idx_responses_request_id      ON ai_responses(request_id);
