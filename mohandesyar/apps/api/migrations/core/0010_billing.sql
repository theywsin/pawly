-- Phase 7: online purchase of plans and modules (invoice → bank gateway → verified payment → activation).
--
-- Amounts are rial (numeric, never float). An invoice is the thing being bought; a payment is one attempt
-- at the bank. Only a payment verified with the bank marks its invoice paid, and that happens once (the
-- pending → verifying claim is atomic), so a replayed bank callback cannot activate anything twice.
-- Billing rows are platform data read by the console across tenants; tenant endpoints always filter by
-- the caller's tenant (same as core_subscriptions).

-- Price of each module bought on its own (added to the current subscription period).
CREATE TABLE core_module_prices (
  module_id text PRIMARY KEY,
  price_monthly numeric(20, 0) NOT NULL CHECK (price_monthly >= 0),
  price_yearly numeric(20, 0) CHECK (price_yearly IS NULL OR price_yearly >= 0),
  purchasable boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE core_invoice_number START 1001;
GRANT USAGE, SELECT ON SEQUENCE core_invoice_number TO mohandesyar_app;

CREATE TABLE core_invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  number bigint NOT NULL UNIQUE DEFAULT nextval('core_invoice_number'),
  kind text NOT NULL CHECK (kind IN ('subscription', 'module')),
  plan_key text REFERENCES core_plans (key),
  module_id text,
  cycle text CHECK (cycle IN ('monthly', 'yearly')),
  months int NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 36),
  items jsonb NOT NULL,
  subtotal numeric(20, 0) NOT NULL CHECK (subtotal >= 0),
  vat_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (vat_percent >= 0 AND vat_percent <= 100),
  vat numeric(20, 0) NOT NULL DEFAULT 0 CHECK (vat >= 0),
  total numeric(20, 0) NOT NULL CHECK (total = subtotal + vat),
  buyer jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'canceled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  CHECK ((kind = 'subscription' AND plan_key IS NOT NULL AND cycle IS NOT NULL) OR (kind = 'module' AND module_id IS NOT NULL))
);
CREATE INDEX core_invoices_tenant ON core_invoices (tenant_id, created_at DESC);

CREATE TABLE core_payments (
  id uuid PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES core_invoices (id),
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  gateway text NOT NULL CHECK (gateway IN ('sep')),
  amount numeric(20, 0) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verifying', 'paid', 'failed')),
  token text,
  ref_num text UNIQUE,
  rrn text,
  trace_no text,
  masked_pan text,
  error text,
  return_to text NOT NULL DEFAULT '/app/billing',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX core_payments_invoice ON core_payments (invoice_id);
CREATE INDEX core_payments_pending ON core_payments (created_at) WHERE status IN ('pending', 'verifying');

INSERT INTO platform_settings (key, value) VALUES
  ('billing', '{"vatPercent": 0, "trialDays": null, "gateway": {"enabled": false, "terminalId": "", "sandbox": false}}')
ON CONFLICT DO NOTHING;
