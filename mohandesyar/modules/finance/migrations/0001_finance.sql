-- finance 1.0.0 — management/control finance (not statutory accounting): accounts, counterparties, categories,
-- cost centres, immutable transactions (corrections only by reversal), transfers that are never income or
-- expense, payment requests with separate request / approval / execution, receivables and payables, cheques,
-- versioned project budgets, commitments, EAC with a versioned method, cash-flow forecast (firm vs estimate),
-- bank statement reconciliation. Company-scoped, forced RLS. Amounts: rial, numeric(20,0).

CREATE TABLE finance_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('bank', 'petty_cash', 'cash')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  bank_name text NOT NULL DEFAULT '',
  number text NOT NULL DEFAULT '',
  iban text CHECK (iban IS NULL OR iban ~ '^IR[0-9]{24}$'),
  custodian_id uuid,
  opening_balance numeric(20,0) NOT NULL DEFAULT 0,
  opening_on date NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE TABLE finance_categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income', 'expense')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  parent_id uuid REFERENCES finance_categories (id) ON DELETE RESTRICT,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, name)
);

CREATE TABLE finance_cost_centers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 30),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  archived boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, code)
);

CREATE TABLE finance_counterparties (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'company' CHECK (kind IN ('person', 'company')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  national_id text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  iban text CHECK (iban IS NULL OR iban ~ '^IR[0-9]{24}$'),
  crm_account_id uuid,
  procurement_supplier_id uuid,
  notes text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX finance_counterparties_supplier ON finance_counterparties (company_id, procurement_supplier_id) WHERE procurement_supplier_id IS NOT NULL;

-- Receivables and payables (one table, kind tells them apart). Settled amount = sum of linked transactions.
CREATE TABLE finance_obligations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receivable', 'payable')),
  counterparty_id uuid NOT NULL REFERENCES finance_counterparties (id) ON DELETE RESTRICT,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 500),
  reference text NOT NULL DEFAULT '',
  projects_project_id uuid,
  contracts_contract_id uuid,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'procurement')),
  source_ref text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid, -- null: created by the system from another module's event
  CHECK (due_on >= issued_on)
);
CREATE INDEX finance_obligations_due ON finance_obligations (tenant_id, company_id, kind, status, due_on);
CREATE UNIQUE INDEX finance_obligations_source ON finance_obligations (company_id, source, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE finance_commitments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  projects_project_id uuid,
  category_id uuid REFERENCES finance_categories (id) ON DELETE RESTRICT,
  counterparty_id uuid REFERENCES finance_counterparties (id) ON DELETE RESTRICT,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 500),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'procurement', 'contract')),
  source_ref text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid -- null: created by the system from another module's event
);
CREATE UNIQUE INDEX finance_commitments_source ON finance_commitments (company_id, source, source_ref) WHERE source_ref IS NOT NULL;

-- Transactions are executed money movements and never change: a correction is a reversal row (reverses_id)
-- and the original only records that it was voided. A transfer is two rows of type 'transfer' sharing
-- transfer_group_id and has no category, so it can never count as income or expense.
CREATE TABLE finance_transactions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('receipt', 'payment', 'transfer')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  account_id uuid NOT NULL REFERENCES finance_accounts (id) ON DELETE RESTRICT,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  occurred_on date NOT NULL,
  counterparty_id uuid REFERENCES finance_counterparties (id) ON DELETE RESTRICT,
  category_id uuid REFERENCES finance_categories (id) ON DELETE RESTRICT,
  cost_center_id uuid REFERENCES finance_cost_centers (id) ON DELETE RESTRICT,
  projects_project_id uuid,
  contracts_contract_id uuid,
  obligation_id uuid REFERENCES finance_obligations (id) ON DELETE RESTRICT,
  commitment_id uuid REFERENCES finance_commitments (id) ON DELETE RESTRICT,
  payment_request_id uuid,
  cheque_id uuid,
  transfer_group_id uuid,
  reverses_id uuid REFERENCES finance_transactions (id) ON DELETE RESTRICT,
  description text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  CHECK ((type = 'transfer') = (transfer_group_id IS NOT NULL)),
  CHECK (type <> 'transfer' OR category_id IS NULL),
  CHECK (type = 'transfer' OR category_id IS NOT NULL),
  CHECK (reverses_id IS NOT NULL OR type = 'transfer' OR (type = 'receipt' AND direction = 'in') OR (type = 'payment' AND direction = 'out'))
);
CREATE INDEX finance_transactions_account ON finance_transactions (tenant_id, account_id, occurred_on);
CREATE INDEX finance_transactions_project ON finance_transactions (tenant_id, projects_project_id) WHERE projects_project_id IS NOT NULL;
CREATE INDEX finance_transactions_obligation ON finance_transactions (tenant_id, obligation_id) WHERE obligation_id IS NOT NULL;
CREATE UNIQUE INDEX finance_transactions_one_reversal ON finance_transactions (reverses_id) WHERE reverses_id IS NOT NULL;

CREATE FUNCTION finance_transactions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'finance: executed transactions cannot be deleted; record a reversal' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL
     AND (to_jsonb(NEW) - 'voided_at' - 'voided_by' - 'void_reason') = (to_jsonb(OLD) - 'voided_at' - 'voided_by' - 'void_reason') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finance: executed transactions are immutable; record a reversal' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER finance_transactions_immutable BEFORE UPDATE OR DELETE ON finance_transactions FOR EACH ROW EXECUTE FUNCTION finance_transactions_immutable();

-- Request (user A) → approval workflow with amount thresholds and role limits (B…) → execution (C).
CREATE TABLE finance_payment_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number int NOT NULL,
  counterparty_id uuid NOT NULL REFERENCES finance_counterparties (id) ON DELETE RESTRICT,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  due_on date NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 1000),
  category_id uuid NOT NULL REFERENCES finance_categories (id) ON DELETE RESTRICT,
  cost_center_id uuid REFERENCES finance_cost_centers (id) ON DELETE RESTRICT,
  projects_project_id uuid,
  contracts_contract_id uuid,
  obligation_id uuid REFERENCES finance_obligations (id) ON DELETE RESTRICT,
  commitment_id uuid REFERENCES finance_commitments (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled', 'executed')),
  workflow_instance_id uuid,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approvers uuid[] NOT NULL DEFAULT '{}',
  decided_at timestamptz,
  method text CHECK (method IN ('transfer', 'cash', 'cheque')),
  executed_by uuid,
  executed_at timestamptz,
  transaction_id uuid REFERENCES finance_transactions (id) ON DELETE RESTRICT,
  cheque_id uuid,
  bank_reference text NOT NULL DEFAULT '',
  CHECK (executed_by IS NULL OR (executed_by <> requested_by AND NOT executed_by = ANY (approvers))),
  CHECK (NOT requested_by = ANY (approvers)),
  UNIQUE (company_id, number)
);
CREATE INDEX finance_payment_requests_status ON finance_payment_requests (tenant_id, company_id, status, due_on);

CREATE TABLE finance_cheques (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('received', 'issued')),
  number text NOT NULL CHECK (length(number) BETWEEN 1 AND 40),
  bank_name text NOT NULL DEFAULT '',
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  due_on date NOT NULL,
  counterparty_id uuid NOT NULL REFERENCES finance_counterparties (id) ON DELETE RESTRICT,
  account_id uuid REFERENCES finance_accounts (id) ON DELETE RESTRICT,
  obligation_id uuid REFERENCES finance_obligations (id) ON DELETE RESTRICT,
  payment_request_id uuid REFERENCES finance_payment_requests (id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES finance_categories (id) ON DELETE RESTRICT,
  projects_project_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'bounced', 'cancelled')),
  transaction_id uuid REFERENCES finance_transactions (id) ON DELETE RESTRICT,
  status_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (company_id, direction, bank_name, number)
);
CREATE INDEX finance_cheques_due ON finance_cheques (tenant_id, company_id, status, due_on);

CREATE TABLE finance_budgets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  projects_project_id uuid NOT NULL,
  version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('initial', 'revision')),
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  approved_at timestamptz,
  approved_by uuid,
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  UNIQUE (projects_project_id, version)
);
CREATE UNIQUE INDEX finance_budgets_one_draft ON finance_budgets (projects_project_id) WHERE status = 'draft';

CREATE TABLE finance_budget_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  budget_id uuid NOT NULL REFERENCES finance_budgets (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES finance_categories (id) ON DELETE RESTRICT,
  amount numeric(20,0) NOT NULL CHECK (amount >= 0),
  note text NOT NULL DEFAULT '',
  UNIQUE (budget_id, category_id)
);

-- Estimate-at-completion method, versioned per company: cpi = AC + (BAC − EV) / CPI;
-- budget_rate = AC + (BAC − EV); manual_etc = AC + latest manual ETC of the project.
CREATE TABLE finance_eac_methods (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  version int NOT NULL,
  method text NOT NULL CHECK (method IN ('cpi', 'budget_rate', 'manual_etc')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (company_id, version)
);

CREATE TABLE finance_etc_estimates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  projects_project_id uuid NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount >= 0),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE TABLE finance_variance_notes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  projects_project_id uuid NOT NULL,
  note text NOT NULL CHECK (length(note) BETWEEN 2 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE TABLE finance_forecasts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  expected_on date NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 500),
  projects_project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

-- Imported bank statement lines; reconciliation matches each to one transaction of the same account.
CREATE TABLE finance_statement_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES finance_accounts (id) ON DELETE RESTRICT,
  occurred_on date NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount <> 0),
  reference text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  batch_id uuid NOT NULL,
  transaction_id uuid REFERENCES finance_transactions (id) ON DELETE RESTRICT,
  matched_by uuid,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE UNIQUE INDEX finance_statement_lines_tx ON finance_statement_lines (transaction_id) WHERE transaction_id IS NOT NULL;
CREATE INDEX finance_statement_lines_account ON finance_statement_lines (tenant_id, account_id, occurred_on);

CREATE TABLE finance_alerts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  alert_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alert_key)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE finance_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_accounts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_accounts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_categories AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_categories AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_cost_centers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_cost_centers AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_cost_centers AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_counterparties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_counterparties AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_counterparties AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_obligations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_obligations AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_obligations AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_commitments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_commitments AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_commitments AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_transactions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_transactions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_transactions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_payment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_payment_requests AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_payment_requests AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_cheques FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_cheques AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_cheques AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_budgets AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_budgets AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_budget_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_budget_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_budget_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_eac_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_eac_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_eac_methods AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_eac_methods AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_etc_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_etc_estimates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_etc_estimates AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_etc_estimates AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_variance_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_variance_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_variance_notes AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_variance_notes AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_forecasts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_forecasts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_forecasts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_statement_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_statement_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_statement_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE finance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON finance_alerts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON finance_alerts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
