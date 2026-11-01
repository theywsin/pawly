-- qhse 1.0.0 — quality, health, safety and environment: incidents and near misses (urgent notification
-- for high/critical), man-hours for frequency rates, risk register (inherent and residual), checklist
-- templates and inspections, non-conformances, corrective/preventive actions verified by someone other than
-- the owner, safety training with attendance, PPE issues. Company-scoped, forced RLS.

CREATE TABLE qhse_settings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL UNIQUE,
  urgent_recipients uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qhse_incidents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('injury', 'near_miss', 'unsafe_condition', 'property_damage', 'environmental')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  occurred_on date NOT NULL,
  occurred_time text NOT NULL DEFAULT '' CHECK (occurred_time = '' OR occurred_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  projects_project_id uuid,
  location text NOT NULL DEFAULT '',
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '',
  injured_count integer NOT NULL DEFAULT 0 CHECK (injured_count BETWEEN 0 AND 1000),
  lost_days integer NOT NULL DEFAULT 0 CHECK (lost_days BETWEEN 0 AND 100000),
  fatality boolean NOT NULL DEFAULT false,
  immediate_action text NOT NULL DEFAULT '',
  root_cause text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'closed')),
  reported_by uuid NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  closed_at timestamptz,
  UNIQUE (company_id, number)
);
CREATE INDEX qhse_incidents_date_idx ON qhse_incidents (company_id, occurred_on);

CREATE TABLE qhse_manhours (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  projects_project_id uuid,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'), -- ISO month (Gregorian) the hours belong to
  hours numeric(14,1) NOT NULL CHECK (hours >= 0),
  headcount integer NOT NULL DEFAULT 0 CHECK (headcount >= 0),
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX qhse_manhours_uq ON qhse_manhours (company_id, coalesce(projects_project_id, '00000000-0000-0000-0000-000000000000'::uuid), month);

CREATE TABLE qhse_risks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  projects_project_id uuid,
  activity text NOT NULL CHECK (length(activity) BETWEEN 2 AND 200),
  hazard text NOT NULL CHECK (length(hazard) BETWEEN 2 AND 300),
  consequence text NOT NULL DEFAULT '',
  likelihood smallint NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  severity smallint NOT NULL CHECK (severity BETWEEN 1 AND 5),
  controls text NOT NULL DEFAULT '',
  residual_likelihood smallint CHECK (residual_likelihood BETWEEN 1 AND 5),
  residual_severity smallint CHECK (residual_severity BETWEEN 1 AND 5),
  owner_id uuid,
  review_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'controlled', 'closed')),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qhse_checklists (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  area text NOT NULL DEFAULT 'safety' CHECK (area IN ('safety', 'quality', 'environment', 'health')),
  items jsonb NOT NULL, -- [{ "text": "..." }]
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE qhse_inspections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  checklist_id uuid NOT NULL REFERENCES qhse_checklists (id) ON DELETE RESTRICT,
  checklist_name text NOT NULL,
  projects_project_id uuid,
  inspected_on date NOT NULL,
  location text NOT NULL DEFAULT '',
  inspector_id uuid NOT NULL,
  results jsonb NOT NULL, -- [{ "text": "...", "result": "ok"|"nok"|"na", "note": "" }]
  ok_count integer NOT NULL,
  nok_count integer NOT NULL,
  score numeric(5,1), -- ok / (ok + nok) × 100; null when every item is n/a
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qhse_ncrs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  number integer NOT NULL,
  source text NOT NULL CHECK (source IN ('inspection', 'incident', 'audit', 'customer', 'other')),
  inspection_id uuid REFERENCES qhse_inspections (id) ON DELETE SET NULL,
  incident_id uuid REFERENCES qhse_incidents (id) ON DELETE SET NULL,
  projects_project_id uuid,
  area text NOT NULL DEFAULT 'quality' CHECK (area IN ('safety', 'quality', 'environment', 'health')),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor', 'major', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  raised_by uuid NOT NULL,
  raised_on date NOT NULL,
  closed_by uuid,
  closed_at timestamptz,
  UNIQUE (company_id, number)
);

CREATE TABLE qhse_actions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('corrective', 'preventive')),
  ncr_id uuid REFERENCES qhse_ncrs (id) ON DELETE CASCADE,
  incident_id uuid REFERENCES qhse_incidents (id) ON DELETE CASCADE,
  projects_project_id uuid,
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 300),
  owner_id uuid NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'verified')),
  done_note text NOT NULL DEFAULT '',
  done_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reminded_on date,
  -- The person who did the work never verifies it.
  CONSTRAINT qhse_actions_verifier CHECK (verified_by IS NULL OR verified_by <> owner_id)
);
CREATE INDEX qhse_actions_due_idx ON qhse_actions (status, due_on);

CREATE TABLE qhse_trainings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  topic text NOT NULL DEFAULT 'safety' CHECK (topic IN ('safety', 'quality', 'environment', 'health', 'induction')),
  held_on date NOT NULL,
  hours numeric(5,1) NOT NULL CHECK (hours > 0 AND hours <= 200),
  trainer text NOT NULL DEFAULT '',
  projects_project_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qhse_training_attendees (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  training_id uuid NOT NULL REFERENCES qhse_trainings (id) ON DELETE CASCADE,
  user_id uuid,
  person_name text NOT NULL CHECK (length(person_name) BETWEEN 2 AND 120)
);

CREATE TABLE qhse_ppe_issues (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid,
  person_name text NOT NULL CHECK (length(person_name) BETWEEN 2 AND 120),
  item text NOT NULL CHECK (length(item) BETWEEN 2 AND 120),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 1000),
  issued_on date NOT NULL,
  replace_on date,
  projects_project_id uuid,
  issued_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE qhse_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_settings AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_settings AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_incidents AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_incidents AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_manhours ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_manhours FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_manhours AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_manhours AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_risks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_risks AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_risks AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_checklists FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_checklists AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_checklists AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_inspections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_inspections AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_inspections AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_ncrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_ncrs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_ncrs AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_ncrs AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_actions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_actions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_trainings AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_trainings AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_training_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_training_attendees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_training_attendees AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_training_attendees AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE qhse_ppe_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE qhse_ppe_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON qhse_ppe_issues AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON qhse_ppe_issues AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
