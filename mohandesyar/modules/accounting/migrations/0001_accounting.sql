-- accounting 1.0.0 — double-entry general ledger (group / ledger / subsidiary accounts + detail accounts),
-- fiscal years, vouchers (draft → posted, reversal instead of edit), treasury and cheques, items and
-- sale/purchase invoices with VAT, perpetual inventory at moving average cost, fixed assets with monthly
-- depreciation, year-end closing. Amounts are rial numeric(20,0); quantities numeric(18,3). Company-scoped, forced RLS.

CREATE TABLE accounting_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[0-9]{1,8}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  -- group (گروه) → ledger (کل) → subsidiary (معین); only subsidiaries take voucher lines
  level text NOT NULL CHECK (level IN ('group', 'ledger', 'subsidiary')),
  parent_id uuid REFERENCES accounting_accounts (id),
  -- statement section, inherited from the group
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense', 'memo')),
  nature text NOT NULL DEFAULT 'none' CHECK (nature IN ('debit', 'credit', 'none')),
  -- whether lines on this account need a detail account (طرف‌حساب، پروژه، ...)
  needs_detail boolean NOT NULL DEFAULT false,
  -- stable role used by automatic vouchers (cash, bank, receivable, payable, vat_out, ...)
  system_key text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK ((level = 'group') = (parent_id IS NULL))
);
CREATE UNIQUE INDEX accounting_accounts_system ON accounting_accounts (company_id, system_key) WHERE system_key IS NOT NULL;
CREATE INDEX accounting_accounts_parent ON accounting_accounts (parent_id);

CREATE TABLE accounting_details (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[0-9]{1,10}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  kind text NOT NULL CHECK (kind IN ('person', 'company', 'project', 'cost_center', 'bank', 'cash', 'employee', 'other')),
  -- seasonal VAT report fields (معاملات فصلی)
  national_id text NOT NULL DEFAULT '',
  economic_code text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  source_ref text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX accounting_details_source ON accounting_details (company_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE accounting_fiscal_years (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 100),
  start_on date NOT NULL,
  end_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_on > start_on)
);

CREATE TABLE accounting_vouchers (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  fiscal_year_id uuid NOT NULL REFERENCES accounting_fiscal_years (id),
  -- permanent number, given in order when the voucher is posted
  number integer,
  date date NOT NULL,
  description text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'opening', 'closing', 'income_closing', 'reversal')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  -- where an automatic voucher came from (invoice, treasury, cheque, depreciation, procurement, finance, ...)
  source text NOT NULL DEFAULT 'manual',
  source_ref text,
  reverses_id uuid REFERENCES accounting_vouchers (id),
  total numeric(20,0) NOT NULL DEFAULT 0,
  created_by uuid,
  posted_by uuid,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fiscal_year_id, number),
  CHECK (status = 'draft' OR (number IS NOT NULL AND posted_at IS NOT NULL))
);
CREATE UNIQUE INDEX accounting_vouchers_source ON accounting_vouchers (company_id, source, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX accounting_vouchers_date ON accounting_vouchers (tenant_id, company_id, date);

CREATE TABLE accounting_voucher_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  voucher_id uuid NOT NULL REFERENCES accounting_vouchers (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  account_id uuid NOT NULL REFERENCES accounting_accounts (id),
  detail_id uuid REFERENCES accounting_details (id),
  description text NOT NULL DEFAULT '',
  debit numeric(20,0) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20,0) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  UNIQUE (voucher_id, line_no),
  CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX accounting_lines_account ON accounting_voucher_lines (account_id);
CREATE INDEX accounting_lines_detail ON accounting_voucher_lines (detail_id) WHERE detail_id IS NOT NULL;

-- Posted vouchers are immutable: lines of a non-draft voucher cannot change, and a voucher may only become
-- posted when balanced; once posted only the move to 'reversed' is allowed.
CREATE FUNCTION accounting_guard_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM accounting_vouchers WHERE id = COALESCE(NEW.voucher_id, OLD.voucher_id);
  IF s IS NOT NULL AND s <> 'draft' THEN
    RAISE EXCEPTION 'accounting: lines of a posted voucher are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER accounting_guard_lines BEFORE INSERT OR UPDATE OR DELETE ON accounting_voucher_lines FOR EACH ROW EXECUTE FUNCTION accounting_guard_lines();

CREATE FUNCTION accounting_guard_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'accounting: posted voucher cannot be deleted' USING ERRCODE = 'check_violation'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' AND NOT (NEW.status = 'reversed' AND NEW.number = OLD.number AND NEW.date = OLD.date AND NEW.total = OLD.total) THEN
    RAISE EXCEPTION 'accounting: posted voucher is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'reversed' THEN RAISE EXCEPTION 'accounting: reversed voucher is immutable' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.status = 'draft' AND NEW.status = 'posted' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n FROM accounting_voucher_lines WHERE voucher_id = NEW.id;
    IF n < 2 OR d <> c OR d = 0 THEN RAISE EXCEPTION 'accounting: unbalanced voucher' USING ERRCODE = 'check_violation'; END IF;
    NEW.total := d;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounting_guard_voucher BEFORE UPDATE OR DELETE ON accounting_vouchers FOR EACH ROW EXECUTE FUNCTION accounting_guard_voucher();

-- ---------------------------------------------------------------- treasury

CREATE TABLE accounting_treasury_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash', 'bank')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  bank_name text NOT NULL DEFAULT '',
  account_no text NOT NULL DEFAULT '',
  iban text NOT NULL DEFAULT '',
  account_id uuid NOT NULL REFERENCES accounting_accounts (id),
  detail_id uuid NOT NULL REFERENCES accounting_details (id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounting_treasury_docs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt', 'payment', 'transfer')),
  date date NOT NULL,
  -- receipt/payment: counter side (party + account); transfer: from treasury_id to to_treasury_id
  detail_id uuid REFERENCES accounting_details (id),
  counter_account_id uuid REFERENCES accounting_accounts (id),
  method text NOT NULL CHECK (method IN ('cash', 'transfer', 'cheque')),
  treasury_id uuid REFERENCES accounting_treasury_accounts (id),
  to_treasury_id uuid REFERENCES accounting_treasury_accounts (id),
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  description text NOT NULL DEFAULT '',
  reference text NOT NULL DEFAULT '',
  voucher_id uuid REFERENCES accounting_vouchers (id),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, number),
  CHECK (kind <> 'transfer' OR (treasury_id IS NOT NULL AND to_treasury_id IS NOT NULL AND treasury_id <> to_treasury_id)),
  CHECK (kind = 'transfer' OR (detail_id IS NOT NULL AND counter_account_id IS NOT NULL)),
  CHECK (method = 'cheque' OR treasury_id IS NOT NULL)
);

CREATE TABLE accounting_cheques (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('received', 'issued')),
  number text NOT NULL CHECK (length(number) BETWEEN 1 AND 30),
  sayad_id text NOT NULL DEFAULT '' CHECK (sayad_id = '' OR sayad_id ~ '^[0-9]{16}$'),
  bank_name text NOT NULL DEFAULT '',
  due_on date NOT NULL,
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  detail_id uuid NOT NULL REFERENCES accounting_details (id),
  -- issued cheques: the bank account they are drawn on; received: the bank they were deposited to
  treasury_id uuid REFERENCES accounting_treasury_accounts (id),
  doc_id uuid REFERENCES accounting_treasury_docs (id),
  -- received: in_hand → deposited → cleared | bounced (from in_hand/deposited) | returned (to the payer)
  -- issued:   issued → cleared | bounced | returned (cancelled by the payee)
  status text NOT NULL CHECK (status IN ('in_hand', 'deposited', 'issued', 'cleared', 'bounced', 'returned')),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (direction <> 'issued' OR treasury_id IS NOT NULL)
);
CREATE INDEX accounting_cheques_due ON accounting_cheques (tenant_id, company_id, due_on) WHERE status IN ('in_hand', 'deposited', 'issued');

CREATE TABLE accounting_cheque_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  cheque_id uuid NOT NULL REFERENCES accounting_cheques (id),
  date date NOT NULL,
  from_status text,
  to_status text NOT NULL,
  voucher_id uuid REFERENCES accounting_vouchers (id),
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- items, inventory and invoices

CREATE TABLE accounting_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 30),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  kind text NOT NULL CHECK (kind IN ('goods', 'service')),
  unit text NOT NULL DEFAULT 'عدد',
  sale_price numeric(20,0) NOT NULL DEFAULT 0 CHECK (sale_price >= 0),
  vat_exempt boolean NOT NULL DEFAULT false,
  -- service purchases go to this account (default: general purchase expenses)
  expense_account_id uuid REFERENCES accounting_accounts (id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE accounting_warehouses (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- Perpetual inventory: moves in entry order; cost of an issue = moving average at that moment.
CREATE TABLE accounting_stock_moves (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  seq bigserial,
  item_id uuid NOT NULL REFERENCES accounting_items (id),
  warehouse_id uuid NOT NULL REFERENCES accounting_warehouses (id),
  date date NOT NULL,
  qty numeric(18,3) NOT NULL CHECK (qty <> 0),
  -- total cost of the move (rial, + for receipts, − for issues)
  cost numeric(20,0) NOT NULL,
  source text NOT NULL CHECK (source IN ('invoice', 'adjustment', 'opening', 'reversal')),
  source_id uuid NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounting_stock_item ON accounting_stock_moves (company_id, item_id, seq);

CREATE TABLE accounting_invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sale', 'purchase', 'sale_return', 'purchase_return')),
  number integer NOT NULL,
  date date NOT NULL,
  detail_id uuid NOT NULL REFERENCES accounting_details (id),
  warehouse_id uuid REFERENCES accounting_warehouses (id),
  reference text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  subtotal numeric(20,0) NOT NULL DEFAULT 0,
  discount numeric(20,0) NOT NULL DEFAULT 0,
  vat numeric(20,0) NOT NULL DEFAULT 0,
  total numeric(20,0) NOT NULL DEFAULT 0,
  voucher_id uuid REFERENCES accounting_vouchers (id),
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, number),
  CHECK (status <> 'approved' OR approved_by IS NOT NULL)
);
CREATE INDEX accounting_invoices_date ON accounting_invoices (tenant_id, company_id, date);

CREATE TABLE accounting_invoice_lines (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES accounting_invoices (id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES accounting_items (id),
  description text NOT NULL DEFAULT '',
  qty numeric(18,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(20,0) NOT NULL CHECK (unit_price >= 0),
  discount numeric(20,0) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  vat_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  amount numeric(20,0) NOT NULL,
  vat numeric(20,0) NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, line_no),
  CHECK (discount <= amount + discount)
);

-- ---------------------------------------------------------------- fixed assets

CREATE TABLE accounting_assets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 30),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  category text NOT NULL DEFAULT '',
  acquired_on date NOT NULL,
  cost numeric(20,0) NOT NULL CHECK (cost > 0),
  salvage numeric(20,0) NOT NULL DEFAULT 0 CHECK (salvage >= 0),
  -- straight_line over useful_life_months, or declining at annual rate_percent of book value
  method text NOT NULL CHECK (method IN ('straight_line', 'declining')),
  useful_life_months integer CHECK (useful_life_months IS NULL OR useful_life_months BETWEEN 1 AND 1200),
  rate_percent numeric(5,2) CHECK (rate_percent IS NULL OR (rate_percent > 0 AND rate_percent <= 100)),
  -- depreciation already booked before using this system
  opening_depreciation numeric(20,0) NOT NULL DEFAULT 0 CHECK (opening_depreciation >= 0),
  asset_account_id uuid NOT NULL REFERENCES accounting_accounts (id),
  depreciation_account_id uuid NOT NULL REFERENCES accounting_accounts (id),
  expense_account_id uuid NOT NULL REFERENCES accounting_accounts (id),
  detail_id uuid REFERENCES accounting_details (id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  disposed_on date,
  disposal_voucher_id uuid REFERENCES accounting_vouchers (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code),
  CHECK (salvage + opening_depreciation <= cost),
  CHECK ((method = 'straight_line' AND useful_life_months IS NOT NULL) OR (method = 'declining' AND rate_percent IS NOT NULL))
);

CREATE TABLE accounting_depreciation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES accounting_assets (id),
  -- Jalali month, e.g. 1405-07
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric(20,0) NOT NULL CHECK (amount > 0),
  voucher_id uuid NOT NULL REFERENCES accounting_vouchers (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_accounts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_accounts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_details FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_details AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_details AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_fiscal_years FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_fiscal_years AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_fiscal_years AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_vouchers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_vouchers AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_vouchers AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_voucher_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_voucher_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_voucher_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_voucher_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_treasury_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_treasury_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_treasury_accounts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_treasury_accounts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_treasury_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_treasury_docs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_treasury_docs AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_treasury_docs AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_cheques FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_cheques AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_cheques AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_cheque_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_cheque_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_cheque_events AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_cheque_events AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_items AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_items AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_warehouses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_warehouses AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_warehouses AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_stock_moves FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_stock_moves AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_stock_moves AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_invoices AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_invoices AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_invoice_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_invoice_lines AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_invoice_lines AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_assets AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_assets AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE accounting_depreciation ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_depreciation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON accounting_depreciation AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON accounting_depreciation AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
