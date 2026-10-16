-- hr 1.0.0 — employee files: employment contracts (confidential: salary), records, skills, trainings,
-- leave types and requests (approval through the core workflow), performance reviews. Company-scoped, forced RLS.

CREATE TABLE hr_employees (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  personnel_no text NOT NULL CHECK (length(personnel_no) BETWEEN 1 AND 30),
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  national_id text CHECK (national_id IS NULL OR national_id ~ '^[0-9]{10}$'),
  mobile text,
  email text,
  user_id uuid,
  recruitment_candidate_id uuid,
  department text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT '',
  manager_user_id uuid,
  hired_on date NOT NULL,
  ended_on date,
  end_reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR ended_on >= hired_on),
  UNIQUE (company_id, personnel_no)
);
CREATE UNIQUE INDEX hr_employees_national_id ON hr_employees (tenant_id, national_id) WHERE national_id IS NOT NULL;
CREATE UNIQUE INDEX hr_employees_user ON hr_employees (tenant_id, user_id) WHERE user_id IS NOT NULL AND status = 'active';
CREATE INDEX hr_employees_list ON hr_employees (tenant_id, company_id, status);

-- Employment contracts are confidential (salary): readable only with hr.contract.view.
CREATE TABLE hr_contracts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES hr_employees (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('permanent', 'fixed_term', 'project', 'hourly', 'internship')),
  starts_on date NOT NULL,
  ends_on date,
  monthly_salary numeric(20,0) CHECK (monthly_salary IS NULL OR monthly_salary >= 0),
  weekly_hours numeric(4,1) CHECK (weekly_hours IS NULL OR weekly_hours BETWEEN 1 AND 80),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX hr_contracts_employee ON hr_contracts (tenant_id, employee_id, starts_on);
CREATE INDEX hr_contracts_ending ON hr_contracts (tenant_id, ends_on) WHERE ends_on IS NOT NULL;

CREATE TABLE hr_records (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES hr_employees (id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('hire', 'promotion', 'transfer', 'commendation', 'warning', 'education', 'prior_experience', 'other')),
  occurred_on date,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX hr_records_employee ON hr_records (tenant_id, employee_id);

CREATE TABLE hr_skills (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES hr_employees (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('skill', 'software', 'certificate', 'language')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  level int NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 5),
  UNIQUE (employee_id, kind, name)
);

CREATE TABLE hr_trainings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES hr_employees (id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  provider text NOT NULL DEFAULT '',
  completed_on date NOT NULL,
  hours numeric(6,1) NOT NULL CHECK (hours > 0),
  certificate text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX hr_trainings_employee ON hr_trainings (tenant_id, employee_id, completed_on);

CREATE TABLE hr_leave_types (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  annual_days numeric(5,1) CHECK (annual_days IS NULL OR annual_days >= 0),
  paid boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hr_leave_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES hr_employees (id) ON DELETE RESTRICT,
  type_id uuid NOT NULL REFERENCES hr_leave_types (id) ON DELETE RESTRICT,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  days numeric(5,1) NOT NULL CHECK (days > 0),
  jalali_year int NOT NULL,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  workflow_instance_id uuid,
  requested_by uuid NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX hr_leave_requests_employee ON hr_leave_requests (tenant_id, employee_id, starts_on);
CREATE INDEX hr_leave_requests_status ON hr_leave_requests (tenant_id, company_id, status);

CREATE TABLE hr_reviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES hr_employees (id) ON DELETE RESTRICT,
  period text NOT NULL CHECK (length(period) BETWEEN 2 AND 60),
  reviewer_id uuid NOT NULL,
  criteria jsonb NOT NULL,
  score numeric(5,1),
  strengths text NOT NULL DEFAULT '',
  improvements text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period)
);

CREATE TABLE hr_alerts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  alert_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alert_key)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_employees AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_employees AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_contracts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_contracts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_records AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_records AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_skills FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_skills AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_skills AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_trainings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_trainings AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_trainings AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_types FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_leave_types AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_leave_types AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_leave_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_leave_requests AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_leave_requests AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_reviews AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_reviews AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE hr_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON hr_alerts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hr_alerts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
