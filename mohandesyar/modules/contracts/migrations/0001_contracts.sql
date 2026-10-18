-- contracts 1.0.0 — contracts, amendments, guarantees, payment terms, obligations, progress statements,
-- change history and sent alerts. All tables are company-scoped with forced RLS. Amounts: numeric(20,0) rial.

CREATE TABLE contracts_contracts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  kind text NOT NULL CHECK (kind IN ('employer', 'contractor', 'consulting', 'purchase', 'service', 'other')),
  direction text NOT NULL CHECK (direction IN ('income', 'expense')),
  counterparty_name text NOT NULL CHECK (length(counterparty_name) BETWEEN 2 AND 200),
  crm_account_id uuid,
  projects_project_id uuid,
  owner_id uuid,
  initial_amount numeric(20,0) NOT NULL CHECK (initial_amount >= 0),
  prepayment_amount numeric(20,0) NOT NULL DEFAULT 0 CHECK (prepayment_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'IRR',
  signed_on date,
  start_on date,
  end_on date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'terminated')),
  good_performance_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK (good_performance_pct BETWEEN 0 AND 100),
  insurance_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK (insurance_pct BETWEEN 0 AND 100),
  tax_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK (tax_pct BETWEEN 0 AND 100),
  vat_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK (vat_pct BETWEEN 0 AND 100),
  prepayment_recovery_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK (prepayment_recovery_pct BETWEEN 0 AND 100),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  version int NOT NULL DEFAULT 1,
  CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on),
  CHECK (status = 'draft' OR signed_on IS NOT NULL)
);
CREATE UNIQUE INDEX contracts_contracts_code ON contracts_contracts (tenant_id, company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX contracts_contracts_list ON contracts_contracts (tenant_id, company_id, status, end_on) WHERE deleted_at IS NULL;
CREATE INDEX contracts_contracts_project ON contracts_contracts (tenant_id, projects_project_id) WHERE deleted_at IS NULL;
CREATE INDEX contracts_contracts_account ON contracts_contracts (tenant_id, crm_account_id) WHERE deleted_at IS NULL;
CREATE INDEX contracts_contracts_search ON contracts_contracts USING gin ((code || ' ' || title || ' ' || counterparty_name) gin_trgm_ops);

CREATE TABLE contracts_amendments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES contracts_contracts (id) ON DELETE RESTRICT,
  number int NOT NULL CHECK (number > 0),
  kind text NOT NULL CHECK (kind IN ('amount', 'time', 'renewal', 'scope', 'other')),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  amount_delta numeric(20,0) NOT NULL DEFAULT 0,
  new_end_on date,
  signed_on date NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (contract_id, number)
);
CREATE INDEX contracts_amendments_contract ON contracts_amendments (tenant_id, contract_id);

CREATE TABLE contracts_guarantees (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES contracts_contracts (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('bid', 'performance', 'prepayment', 'good_performance', 'other')),
  number text NOT NULL DEFAULT '',
  issuer text NOT NULL DEFAULT '',
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  issued_on date,
  expires_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'seized', 'expired')),
  status_changed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX contracts_guarantees_contract ON contracts_guarantees (tenant_id, contract_id) WHERE deleted_at IS NULL;
CREATE INDEX contracts_guarantees_expiry ON contracts_guarantees (tenant_id, expires_on) WHERE deleted_at IS NULL AND status = 'active';

CREATE TABLE contracts_payment_terms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES contracts_contracts (id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  amount numeric(20,0) CHECK (amount IS NULL OR amount >= 0),
  percent numeric(7,4) CHECK (percent IS NULL OR percent BETWEEN 0 AND 100),
  due_on date,
  condition text NOT NULL DEFAULT '',
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX contracts_payment_terms_contract ON contracts_payment_terms (tenant_id, contract_id) WHERE deleted_at IS NULL;

CREATE TABLE contracts_obligations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES contracts_contracts (id) ON DELETE RESTRICT,
  party text NOT NULL CHECK (party IN ('us', 'counterparty')),
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 1000),
  due_on date,
  done_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX contracts_obligations_contract ON contracts_obligations (tenant_id, contract_id) WHERE deleted_at IS NULL;

-- Progress statements (صورت‌وضعیت): cumulative gross to date; deductions apply to this period's gross.
CREATE TABLE contracts_statements (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES contracts_contracts (id) ON DELETE RESTRICT,
  number int NOT NULL CHECK (number > 0),
  period_from date,
  period_to date NOT NULL,
  cumulative_gross numeric(20,0) NOT NULL CHECK (cumulative_gross >= 0),
  period_gross numeric(20,0) NOT NULL,
  good_performance numeric(20,0) NOT NULL DEFAULT 0,
  insurance numeric(20,0) NOT NULL DEFAULT 0,
  tax numeric(20,0) NOT NULL DEFAULT 0,
  prepayment_recovery numeric(20,0) NOT NULL DEFAULT 0,
  other_deductions numeric(20,0) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  vat numeric(20,0) NOT NULL DEFAULT 0,
  net_payable numeric(20,0) NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  workflow_instance_id uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (contract_id, number)
);
CREATE INDEX contracts_statements_contract ON contracts_statements (tenant_id, contract_id) WHERE deleted_at IS NULL;

CREATE TABLE contracts_history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  contract_id uuid NOT NULL REFERENCES contracts_contracts (id) ON DELETE RESTRICT,
  action text NOT NULL,
  summary text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contracts_history_contract ON contracts_history (tenant_id, contract_id, created_at DESC);

-- One row per alert already sent, so the daily job notifies once per threshold.
CREATE TABLE contracts_alerts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  alert_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alert_key)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE contracts_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_contracts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_contracts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_amendments AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_amendments AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_guarantees ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_guarantees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_guarantees AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_guarantees AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_payment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_payment_terms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_payment_terms AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_payment_terms AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_obligations AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_obligations AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_statements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_statements AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_statements AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_history AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_history AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE contracts_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts_alerts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON contracts_alerts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
