-- crm 1.0.0 — accounts (people/companies), contacts, interactions, leads, configurable pipeline stages,
-- opportunities with stage history, versioned proposals, follow-up alerts. Company-scoped, forced RLS.

CREATE TABLE crm_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('company', 'person')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  national_id text NOT NULL DEFAULT '',
  economic_code text NOT NULL DEFAULT '',
  industry text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX crm_accounts_list ON crm_accounts (tenant_id, company_id, name) WHERE deleted_at IS NULL;
CREATE INDEX crm_accounts_search ON crm_accounts USING gin (name gin_trgm_ops);

CREATE TABLE crm_contacts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES crm_accounts (id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  position text NOT NULL DEFAULT '',
  mobile text,
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX crm_contacts_account ON crm_contacts (tenant_id, account_id) WHERE deleted_at IS NULL;
-- Duplicate detection (a warning, not a constraint): same normalised mobile in the tenant.
CREATE INDEX crm_contacts_mobile ON crm_contacts (tenant_id, mobile) WHERE deleted_at IS NULL AND mobile IS NOT NULL;

CREATE TABLE crm_pipeline_stages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  sort int NOT NULL DEFAULT 0,
  probability int NOT NULL CHECK (probability BETWEEN 0 AND 100),
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_pipeline_stages_company ON crm_pipeline_stages (tenant_id, company_id, sort);

CREATE TABLE crm_leads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  account_id uuid REFERENCES crm_accounts (id) ON DELETE RESTRICT,
  organization_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  mobile text,
  email text NOT NULL DEFAULT '',
  source text NOT NULL CHECK (source IN ('website', 'referral', 'tender', 'exhibition', 'call', 'social', 'existing_customer', 'other')),
  need text NOT NULL DEFAULT '',
  estimated_budget numeric(20,0) CHECK (estimated_budget IS NULL OR estimated_budget >= 0),
  score int NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  owner_id uuid,
  next_contact_on date,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
  lost_reason text NOT NULL DEFAULT '',
  opportunity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (status <> 'lost' OR length(lost_reason) >= 2)
);
CREATE INDEX crm_leads_list ON crm_leads (tenant_id, company_id, status, next_contact_on) WHERE deleted_at IS NULL;

CREATE TABLE crm_opportunities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  account_id uuid NOT NULL REFERENCES crm_accounts (id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES crm_contacts (id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES crm_leads (id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES crm_pipeline_stages (id) ON DELETE RESTRICT,
  amount numeric(20,0) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  probability int CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  expected_close_on date,
  owner_id uuid,
  next_contact_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  lost_reason text NOT NULL DEFAULT '',
  closed_on date,
  source text NOT NULL DEFAULT '',
  projects_project_id uuid,
  contracts_contract_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  version int NOT NULL DEFAULT 1,
  CHECK (status <> 'lost' OR length(lost_reason) >= 2)
);
CREATE INDEX crm_opportunities_list ON crm_opportunities (tenant_id, company_id, status, stage_id) WHERE deleted_at IS NULL;
CREATE INDEX crm_opportunities_account ON crm_opportunities (tenant_id, account_id) WHERE deleted_at IS NULL;

CREATE TABLE crm_stage_history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE RESTRICT,
  from_stage_id uuid REFERENCES crm_pipeline_stages (id) ON DELETE RESTRICT,
  to_stage_id uuid NOT NULL REFERENCES crm_pipeline_stages (id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid
);
CREATE INDEX crm_stage_history_opportunity ON crm_stage_history (tenant_id, opportunity_id, changed_at);

CREATE TABLE crm_interactions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  account_id uuid REFERENCES crm_accounts (id) ON DELETE RESTRICT,
  lead_id uuid REFERENCES crm_leads (id) ON DELETE RESTRICT,
  opportunity_id uuid REFERENCES crm_opportunities (id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES crm_contacts (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('call', 'meeting', 'visit', 'email', 'message', 'note')),
  occurred_on date NOT NULL,
  summary text NOT NULL CHECK (length(summary) BETWEEN 2 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CHECK (account_id IS NOT NULL OR lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
);
CREATE INDEX crm_interactions_account ON crm_interactions (tenant_id, account_id, occurred_on DESC);
CREATE INDEX crm_interactions_lead ON crm_interactions (tenant_id, lead_id, occurred_on DESC);
CREATE INDEX crm_interactions_opportunity ON crm_interactions (tenant_id, opportunity_id, occurred_on DESC);

CREATE TABLE crm_proposals (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE RESTRICT,
  number int NOT NULL CHECK (number > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  kind text NOT NULL CHECK (kind IN ('technical', 'financial', 'technical_financial')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz,
  UNIQUE (opportunity_id, number)
);

-- Every change to a proposal is a new version; a version that was sent is never edited.
CREATE TABLE crm_proposal_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  proposal_id uuid NOT NULL REFERENCES crm_proposals (id) ON DELETE RESTRICT,
  version int NOT NULL CHECK (version > 0),
  amount numeric(20,0) CHECK (amount IS NULL OR amount >= 0),
  valid_until date,
  content text NOT NULL DEFAULT '',
  sent_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (proposal_id, version)
);

CREATE TABLE crm_alerts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  alert_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alert_key)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_accounts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_accounts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_contacts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_contacts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_pipeline_stages AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_pipeline_stages AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_leads AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_leads AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_opportunities AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_opportunities AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_stage_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_stage_history AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_stage_history AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_interactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_interactions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_interactions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_proposals AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_proposals AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_proposal_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_proposal_versions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_proposal_versions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE crm_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_alerts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON crm_alerts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
