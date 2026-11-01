-- procurement 1.0.0 — suppliers and categories, purchase requests (project / cost centre / contract, approval),
-- RFQs with quotes and comparison, purchase orders (approval by amount), receipts with shortage/rejection,
-- supplier invoices with three-way match (order / receipt / invoice), supplier ratings. Company-scoped, forced RLS.
-- Quantities numeric(14,3); amounts rial numeric(20,0).

CREATE TABLE procurement_categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  UNIQUE (company_id, name)
);

CREATE TABLE procurement_suppliers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  national_id text NOT NULL DEFAULT '',
  economic_code text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  iban text CHECK (iban IS NULL OR iban ~ '^IR[0-9]{24}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  block_reason text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX procurement_suppliers_name ON procurement_suppliers (tenant_id, company_id, name);

CREATE TABLE procurement_supplier_categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES procurement_categories (id) ON DELETE CASCADE,
  UNIQUE (supplier_id, category_id)
);

CREATE TABLE procurement_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number int NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  projects_project_id uuid,
  contracts_contract_id uuid,
  cost_center text NOT NULL DEFAULT '',
  needed_by date,
  justification text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'closed')),
  workflow_instance_id uuid,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (company_id, number)
);
CREATE INDEX procurement_requests_status ON procurement_requests (tenant_id, company_id, status);

CREATE TABLE procurement_request_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES procurement_requests (id) ON DELETE CASCADE,
  line_no int NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 300),
  unit text NOT NULL CHECK (length(unit) BETWEEN 1 AND 30),
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  estimated_unit_price numeric(20,0) CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0),
  category_id uuid REFERENCES procurement_categories (id) ON DELETE RESTRICT,
  UNIQUE (request_id, line_no)
);

CREATE TABLE procurement_rfqs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number int NOT NULL,
  request_id uuid NOT NULL REFERENCES procurement_requests (id) ON DELETE RESTRICT,
  title text NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'cancelled')),
  awarded_quote_id uuid,
  award_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (company_id, number)
);

CREATE TABLE procurement_quotes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  rfq_id uuid NOT NULL REFERENCES procurement_rfqs (id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers (id) ON DELETE RESTRICT,
  received_on date NOT NULL,
  valid_until date,
  delivery_days int CHECK (delivery_days IS NULL OR delivery_days >= 0),
  payment_terms text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE procurement_quote_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  quote_id uuid NOT NULL REFERENCES procurement_quotes (id) ON DELETE CASCADE,
  request_line_id uuid NOT NULL REFERENCES procurement_request_lines (id) ON DELETE RESTRICT,
  unit_price numeric(20,0) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (quote_id, request_line_id)
);

CREATE TABLE procurement_orders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number int NOT NULL,
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers (id) ON DELETE RESTRICT,
  request_id uuid REFERENCES procurement_requests (id) ON DELETE RESTRICT,
  rfq_id uuid REFERENCES procurement_rfqs (id) ON DELETE RESTRICT,
  projects_project_id uuid,
  contracts_contract_id uuid,
  ordered_on date NOT NULL,
  expected_on date NOT NULL,
  delivery_address text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'closed')),
  workflow_instance_id uuid,
  approvers uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  decided_at timestamptz,
  CHECK (expected_on >= ordered_on),
  UNIQUE (company_id, number)
);
CREATE INDEX procurement_orders_status ON procurement_orders (tenant_id, company_id, status, expected_on);

CREATE TABLE procurement_order_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES procurement_orders (id) ON DELETE CASCADE,
  line_no int NOT NULL,
  request_line_id uuid REFERENCES procurement_request_lines (id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (length(description) BETWEEN 2 AND 300),
  unit text NOT NULL,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(20,0) NOT NULL CHECK (unit_price >= 0),
  category_id uuid REFERENCES procurement_categories (id) ON DELETE RESTRICT,
  UNIQUE (order_id, line_no)
);

CREATE TABLE procurement_receipts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES procurement_orders (id) ON DELETE RESTRICT,
  received_on date NOT NULL,
  document_no text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE TABLE procurement_receipt_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  receipt_id uuid NOT NULL REFERENCES procurement_receipts (id) ON DELETE CASCADE,
  order_line_id uuid NOT NULL REFERENCES procurement_order_lines (id) ON DELETE RESTRICT,
  accepted numeric(14,3) NOT NULL CHECK (accepted >= 0),
  rejected numeric(14,3) NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  note text NOT NULL DEFAULT '',
  CHECK (accepted + rejected > 0)
);

CREATE TABLE procurement_invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers (id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES procurement_orders (id) ON DELETE RESTRICT,
  number text NOT NULL CHECK (length(number) BETWEEN 1 AND 60),
  issued_on date NOT NULL,
  due_on date NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  match jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  override_reason text NOT NULL DEFAULT '',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CHECK (decided_by IS NULL OR decided_by <> created_by),
  CHECK (due_on >= issued_on),
  UNIQUE (supplier_id, number)
);

CREATE TABLE procurement_invoice_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES procurement_invoices (id) ON DELETE CASCADE,
  order_line_id uuid NOT NULL REFERENCES procurement_order_lines (id) ON DELETE RESTRICT,
  quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(20,0) NOT NULL CHECK (unit_price >= 0),
  UNIQUE (invoice_id, order_line_id)
);

CREATE TABLE procurement_ratings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES procurement_suppliers (id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES procurement_orders (id) ON DELETE CASCADE,
  quality int NOT NULL CHECK (quality BETWEEN 1 AND 5),
  delivery int NOT NULL CHECK (delivery BETWEEN 1 AND 5),
  price int NOT NULL CHECK (price BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  rated_by uuid NOT NULL,
  rated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE procurement_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_categories AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_categories AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_suppliers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_suppliers AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_suppliers AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_supplier_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_supplier_categories AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_supplier_categories AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_requests AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_requests AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_request_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_request_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_request_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_rfqs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_rfqs AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_rfqs AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_quotes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_quotes AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_quotes AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_quote_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_quote_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_quote_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_orders AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_orders AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_order_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_order_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_receipts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_receipts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipt_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_receipt_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_receipt_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_invoices AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_invoices AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_invoice_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_invoice_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE procurement_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_ratings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON procurement_ratings AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON procurement_ratings AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
