-- Phase 2: landing content managed from the console, demo/contact leads, signup policy and onboarding.

-- Tenants awaiting platform approval (signup mode "approval") and onboarding completion.
ALTER TABLE core_tenants DROP CONSTRAINT core_tenants_status_check;
ALTER TABLE core_tenants ADD CONSTRAINT core_tenants_status_check CHECK (status IN ('pending', 'trial', 'active', 'suspended', 'closed'));
ALTER TABLE core_tenants ADD COLUMN onboarding_completed_at timestamptz;
ALTER TABLE core_companies ADD COLUMN economic_code text;
ALTER TABLE core_companies ADD COLUMN phone text;
ALTER TABLE core_companies ADD COLUMN address text;

-- Leads from the public demo/contact forms (platform data; no tenant).
CREATE TABLE platform_leads (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('demo', 'contact')),
  full_name text NOT NULL,
  company text,
  company_size text,
  phone text,
  email text,
  message text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost', 'spam')),
  spam_reason text,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX platform_leads_status ON platform_leads (status, created_at DESC);

CREATE TABLE platform_lead_notes (
  id uuid PRIMARY KEY,
  lead_id uuid NOT NULL REFERENCES platform_leads (id) ON DELETE CASCADE,
  admin_id uuid NOT NULL REFERENCES platform_admins (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_lead_notes_lead ON platform_lead_notes (lead_id, created_at);

-- Landing FAQ and site content (contact info, about/terms/privacy pages). Empty by default: the landing
-- hides sections that have no published content rather than showing placeholder text.
CREATE TABLE platform_faq (
  id uuid PRIMARY KEY,
  question text NOT NULL CHECK (length(question) BETWEEN 3 AND 300),
  answer text NOT NULL CHECK (length(answer) BETWEEN 1 AND 4000),
  sort int NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_content (
  key text PRIMARY KEY CHECK (key IN ('contact', 'about', 'terms', 'privacy')),
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO platform_settings (key, value) VALUES ('signup', '{"mode": "open"}') ON CONFLICT DO NOTHING;
