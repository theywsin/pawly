-- holding 1.0.0 — saved cross-company comparison views. Values are never stored here: every report is
-- computed on request from the KPI providers of the active modules, only for companies where the viewer
-- holds holding.view. Company-scoped (the view belongs to the company it was saved in), forced RLS.

CREATE TABLE holding_views (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  providers text[] NOT NULL CHECK (cardinality(providers) BETWEEN 1 AND 20),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

ALTER TABLE holding_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE holding_views FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holding_views AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON holding_views AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
