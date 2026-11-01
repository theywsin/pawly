-- projects 1.0.0 — projects, team, WBS activities with dependencies and CPM results, dated progress entries,
-- phases and handovers, issues/delays, risks, daily reports, change requests. Company-scoped, forced RLS.

CREATE TABLE projects_projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  project_type text NOT NULL DEFAULT 'building' CHECK (project_type IN ('building', 'infrastructure', 'industrial', 'road', 'water', 'energy', 'consulting', 'other')),
  employer_name text NOT NULL DEFAULT '',
  crm_account_id uuid,
  contracts_contract_id uuid,
  manager_id uuid,
  province text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  specs text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  planned_start date,
  planned_finish date,
  actual_start date,
  actual_finish date,
  budget_amount numeric(20,0) CHECK (budget_amount IS NULL OR budget_amount >= 0),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  schedule_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  version int NOT NULL DEFAULT 1,
  CHECK (planned_finish IS NULL OR planned_start IS NULL OR planned_finish >= planned_start)
);
CREATE UNIQUE INDEX projects_projects_code ON projects_projects (tenant_id, company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX projects_projects_list ON projects_projects (tenant_id, company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX projects_projects_search ON projects_projects USING gin ((code || ' ' || title || ' ' || employer_name) gin_trgm_ops);

CREATE TABLE projects_members (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'engineer', 'supervisor', 'site', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
CREATE INDEX projects_members_user ON projects_members (tenant_id, user_id);

CREATE TABLE projects_activities (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES projects_activities (id) ON DELETE RESTRICT,
  sort int NOT NULL DEFAULT 0,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  duration_days int NOT NULL DEFAULT 1 CHECK (duration_days BETWEEN 0 AND 3650),
  weight numeric(9,4) NOT NULL DEFAULT 1 CHECK (weight >= 0),
  assignee_id uuid,
  progress numeric(7,4) NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  actual_start date,
  actual_finish date,
  es int, ef int, ls int, lf int, total_float int,
  critical boolean NOT NULL DEFAULT false,
  planned_start date,
  planned_finish date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX projects_activities_project ON projects_activities (tenant_id, project_id, sort) WHERE deleted_at IS NULL;

CREATE TABLE projects_dependencies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  predecessor_id uuid NOT NULL REFERENCES projects_activities (id) ON DELETE RESTRICT,
  successor_id uuid NOT NULL REFERENCES projects_activities (id) ON DELETE RESTRICT,
  type text NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days int NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN -3650 AND 3650),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (predecessor_id <> successor_id),
  UNIQUE (predecessor_id, successor_id)
);
CREATE INDEX projects_dependencies_project ON projects_dependencies (tenant_id, project_id);

-- Each entry records the activity's cumulative actual percent on a date; history drives the S-curve.
CREATE TABLE projects_progress_entries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL REFERENCES projects_activities (id) ON DELETE RESTRICT,
  entry_date date NOT NULL,
  percent numeric(7,4) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX projects_progress_entries_activity ON projects_progress_entries (tenant_id, activity_id, entry_date);
CREATE INDEX projects_progress_entries_project ON projects_progress_entries (tenant_id, project_id, entry_date);

CREATE TABLE projects_phases (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'phase' CHECK (kind IN ('phase', 'temporary_handover', 'final_handover')),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  planned_date date,
  delivered_on date,
  client_approved_on date,
  notes text NOT NULL DEFAULT '',
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz,
  CHECK (client_approved_on IS NULL OR delivered_on IS NOT NULL)
);
CREATE INDEX projects_phases_project ON projects_phases (tenant_id, project_id) WHERE deleted_at IS NULL;

CREATE TABLE projects_issues (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('delay', 'obstacle', 'issue')),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '',
  cause text NOT NULL DEFAULT '',
  impact_days int NOT NULL DEFAULT 0 CHECK (impact_days >= 0),
  owner_id uuid,
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz
);
CREATE INDEX projects_issues_project ON projects_issues (tenant_id, project_id, status) WHERE deleted_at IS NULL;

CREATE TABLE projects_risks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  probability int NOT NULL CHECK (probability BETWEEN 1 AND 5),
  impact int NOT NULL CHECK (impact BETWEEN 1 AND 5),
  response text NOT NULL DEFAULT '',
  owner_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX projects_risks_project ON projects_risks (tenant_id, project_id) WHERE deleted_at IS NULL;

CREATE TABLE projects_daily_reports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  report_date date NOT NULL,
  weather text NOT NULL DEFAULT '',
  workforce int NOT NULL DEFAULT 0 CHECK (workforce >= 0),
  equipment text NOT NULL DEFAULT '',
  work_done text NOT NULL CHECK (length(work_done) >= 2),
  problems text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX projects_daily_reports_day ON projects_daily_reports (project_id, report_date) WHERE deleted_at IS NULL;

CREATE TABLE projects_change_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES projects_projects (id) ON DELETE RESTRICT,
  number int NOT NULL CHECK (number > 0),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '',
  cost_impact numeric(20,0) NOT NULL DEFAULT 0,
  time_impact_days int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  workflow_instance_id uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  deleted_at timestamptz,
  UNIQUE (project_id, number)
);
CREATE INDEX projects_change_requests_project ON projects_change_requests (tenant_id, project_id) WHERE deleted_at IS NULL;

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE projects_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_projects AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_projects AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_members AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_members AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_activities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_activities AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_activities AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_dependencies AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_dependencies AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_progress_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_progress_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_progress_entries AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_progress_entries AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_phases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_phases AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_phases AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_issues AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_issues AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_risks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_risks AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_risks AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_daily_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_daily_reports AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_daily_reports AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE projects_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON projects_change_requests AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON projects_change_requests AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
