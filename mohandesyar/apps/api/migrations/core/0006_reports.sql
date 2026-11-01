-- Saved reports (a module report + its filters, optionally on a schedule) and their deliveries. A scheduled
-- report is run separately for every recipient with that recipient's own permissions; the file of each
-- delivery belongs to that recipient alone.
CREATE TABLE core_saved_reports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  module_id text NOT NULL,
  report_key text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  params jsonb NOT NULL, -- { range: 'last_7_days'|'last_month'|'month_to_date'|'year_to_date'|'custom', from?, to?, filters: {} }
  schedule text NOT NULL DEFAULT 'none' CHECK (schedule IN ('none', 'daily', 'weekly', 'monthly')),
  recipients uuid[] NOT NULL DEFAULT '{}',
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, owner_id, name)
);
CREATE INDEX core_saved_reports_due ON core_saved_reports (next_run_at) WHERE schedule <> 'none';

CREATE TABLE core_report_runs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  saved_report_id uuid NOT NULL REFERENCES core_saved_reports (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  period_from date,
  period_to date,
  status text NOT NULL CHECK (status IN ('ok', 'failed')),
  row_count integer NOT NULL DEFAULT 0,
  file_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX core_report_runs_recipient ON core_report_runs (recipient_id, created_at DESC);

ALTER TABLE core_saved_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_saved_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core_saved_reports AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON core_saved_reports AS PERMISSIVE USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE core_report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_report_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core_report_runs AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON core_report_runs AS PERMISSIVE USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));

-- The scheduler works across tenants: it claims due reports (moving next_run_at forward so no other worker
-- takes them) and gets only ids; each run then happens inside that tenant's RLS context.
CREATE FUNCTION core_reports_claim(p_limit int) RETURNS TABLE (id uuid, tenant_id uuid, company_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_saved_reports r SET next_run_at = now() + interval '10 minutes'
   WHERE r.id IN (SELECT x.id FROM core_saved_reports x WHERE x.schedule <> 'none' AND x.next_run_at <= now() ORDER BY x.next_run_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING r.id, r.tenant_id, r.company_id;
$$;
GRANT SELECT, UPDATE ON core_saved_reports TO mohandesyar_definer;
ALTER FUNCTION core_reports_claim(int) OWNER TO mohandesyar_definer;
