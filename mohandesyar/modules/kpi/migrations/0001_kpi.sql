-- kpi 1.0.0 — KPI definitions (versioned; manual, provider or safe formula source), targets and values per
-- Jalali period and subject, value approval, scorecards with review/approval and versions, versioned reward
-- rules and suggested (never paid) reward coefficients. Company-scoped, forced RLS.

CREATE TABLE kpi_definitions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  description text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'count',
  direction text NOT NULL CHECK (direction IN ('higher', 'lower')),
  level text NOT NULL CHECK (level IN ('org', 'unit', 'project', 'role', 'person')),
  frequency text NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  source text NOT NULL CHECK (source IN ('manual', 'provider', 'formula')),
  provider_key text,
  formula text,
  weight int NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 100),
  good_pct numeric(5,1) NOT NULL DEFAULT 100 CHECK (good_pct > 0),
  warning_pct numeric(5,1) NOT NULL DEFAULT 80 CHECK (warning_pct > 0),
  is_gate boolean NOT NULL DEFAULT false,
  owner_user_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (warning_pct <= good_pct),
  CHECK ((source = 'provider') = (provider_key IS NOT NULL)),
  CHECK ((source = 'formula') = (formula IS NOT NULL)),
  UNIQUE (company_id, code)
);

-- Every saved change of a definition keeps the previous one (values record the version they used).
CREATE TABLE kpi_definition_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  definition_id uuid NOT NULL REFERENCES kpi_definitions (id) ON DELETE RESTRICT,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (definition_id, version)
);

CREATE TABLE kpi_targets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  definition_id uuid NOT NULL REFERENCES kpi_definitions (id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (period ~ '^[0-9]{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$'),
  subject_type text NOT NULL CHECK (subject_type IN ('org', 'unit', 'project', 'role', 'person')),
  subject_id text NOT NULL,
  subject_name text NOT NULL,
  target numeric(20,4) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE (definition_id, period, subject_type, subject_id)
);

CREATE TABLE kpi_values (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  definition_id uuid NOT NULL REFERENCES kpi_definitions (id) ON DELETE RESTRICT,
  definition_version int NOT NULL,
  period text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  subject_name text NOT NULL,
  value numeric(20,4) NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'provider', 'formula')),
  provider_snapshot jsonb,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  entered_by uuid NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  CHECK (decided_by IS NULL OR status = 'submitted' OR decided_by <> entered_by),
  UNIQUE (definition_id, period, subject_type, subject_id)
);
CREATE INDEX kpi_values_period ON kpi_values (tenant_id, company_id, period, status);

CREATE TABLE kpi_value_history (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  value_id uuid NOT NULL REFERENCES kpi_values (id) ON DELETE CASCADE,
  value numeric(20,4) NOT NULL,
  status text NOT NULL,
  action text NOT NULL,
  actor_id uuid NOT NULL,
  note text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kpi_value_history_value ON kpi_value_history (tenant_id, value_id, at);

CREATE TABLE kpi_scorecards (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('org', 'unit', 'project', 'role', 'person')),
  subject_id text NOT NULL,
  subject_name text NOT NULL,
  period text NOT NULL,
  version int NOT NULL DEFAULT 1,
  score numeric(6,1),
  complete boolean NOT NULL,
  gate_failed boolean NOT NULL,
  breakdown jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved', 'superseded')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  computed_by uuid NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  comment text NOT NULL DEFAULT '',
  CHECK (approved_by IS NULL OR approved_by <> reviewed_by),
  UNIQUE (company_id, subject_type, subject_id, period, version)
);
CREATE INDEX kpi_scorecards_period ON kpi_scorecards (tenant_id, company_id, period, status);

CREATE TABLE kpi_reward_rules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  version int NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  bands jsonb NOT NULL,
  gate_coefficient numeric(6,3) NOT NULL DEFAULT 0 CHECK (gate_coefficient >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (company_id, version)
);

-- Suggestions only: there is no payment, amount or payroll link anywhere in this module.
CREATE TABLE kpi_reward_results (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  scorecard_id uuid NOT NULL REFERENCES kpi_scorecards (id) ON DELETE RESTRICT,
  rule_id uuid NOT NULL REFERENCES kpi_reward_rules (id) ON DELETE RESTRICT,
  coefficient numeric(6,3) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scorecard_id)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_definitions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_definitions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_definition_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_definition_versions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_definition_versions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_targets AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_targets AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_values FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_values AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_values AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_value_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_value_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_value_history AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_value_history AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_scorecards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_scorecards AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_scorecards AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_reward_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_reward_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_reward_rules AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_reward_rules AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE kpi_reward_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_reward_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_reward_results AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON kpi_reward_results AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
