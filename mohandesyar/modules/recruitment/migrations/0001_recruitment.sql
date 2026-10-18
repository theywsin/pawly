-- recruitment 1.0.0 — resume bank and hiring: candidates (structured resume, consent and retention), duplicate
-- detection and merge, jobs with a transparent scoring profile, configurable pipeline stages, applications
-- with score breakdown, configurable interview forms and interviews. Company-scoped, forced RLS.
-- Deliberately NOT stored anywhere: age/birth date, gender, marital status, ethnicity, religion, health.

CREATE TABLE recruitment_candidates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  name_norm text NOT NULL,
  mobile text,
  email text,
  city text NOT NULL DEFAULT '',
  desired_position text NOT NULL DEFAULT '',
  expected_salary numeric(20,0) CHECK (expected_salary IS NULL OR expected_salary >= 0),
  available_from date,
  referrer text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'referral', 'website', 'job_board', 'university', 'other')),
  portfolio_url text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  consent_on date NOT NULL,
  consent_note text NOT NULL DEFAULT '',
  retention_until date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hired', 'archived', 'merged', 'anonymized')),
  merged_into uuid REFERENCES recruitment_candidates (id) ON DELETE RESTRICT,
  search_doc tsvector NOT NULL DEFAULT ''::tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recruitment_candidates_list ON recruitment_candidates (tenant_id, company_id, status, created_at);
CREATE INDEX recruitment_candidates_mobile ON recruitment_candidates (tenant_id, mobile) WHERE mobile IS NOT NULL;
CREATE INDEX recruitment_candidates_email ON recruitment_candidates (tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX recruitment_candidates_name ON recruitment_candidates (tenant_id, name_norm);
CREATE INDEX recruitment_candidates_retention ON recruitment_candidates (tenant_id, retention_until) WHERE status <> 'anonymized';
CREATE INDEX recruitment_candidates_search ON recruitment_candidates USING gin (search_doc);

CREATE TABLE recruitment_educations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  degree text NOT NULL CHECK (degree IN ('diploma', 'associate', 'bachelor', 'master', 'phd', 'other')),
  field text NOT NULL CHECK (length(field) BETWEEN 2 AND 120),
  institution text NOT NULL DEFAULT '',
  end_year int CHECK (end_year IS NULL OR end_year BETWEEN 1300 AND 1500)
);
CREATE INDEX recruitment_educations_candidate ON recruitment_educations (tenant_id, candidate_id);

CREATE TABLE recruitment_experiences (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  employer text NOT NULL CHECK (length(employer) BETWEEN 2 AND 160),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  started_on date NOT NULL,
  ended_on date,
  description text NOT NULL DEFAULT '',
  CHECK (ended_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX recruitment_experiences_candidate ON recruitment_experiences (tenant_id, candidate_id);

CREATE TABLE recruitment_candidate_projects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  role text NOT NULL DEFAULT '',
  client text NOT NULL DEFAULT '',
  year int CHECK (year IS NULL OR year BETWEEN 1300 AND 1500),
  description text NOT NULL DEFAULT ''
);
CREATE INDEX recruitment_candidate_projects_candidate ON recruitment_candidate_projects (tenant_id, candidate_id);

-- Skills, software, certificates and languages share one shape (name + level 1..5); "kind" tells them apart.
CREATE TABLE recruitment_skills (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('skill', 'software', 'certificate', 'language')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  name_norm text NOT NULL,
  level int NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 5),
  detail text NOT NULL DEFAULT ''
);
CREATE INDEX recruitment_skills_candidate ON recruitment_skills (tenant_id, candidate_id);
CREATE INDEX recruitment_skills_name ON recruitment_skills (tenant_id, kind, name_norm);

CREATE TABLE recruitment_files (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  file_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('resume', 'portfolio', 'certificate', 'other')),
  name text NOT NULL,
  size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (file_id)
);
CREATE INDEX recruitment_files_candidate ON recruitment_files (tenant_id, candidate_id);

-- Suspected duplicate pairs (a < b) found by rule; resolved by merge or dismissal.
CREATE TABLE recruitment_duplicates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  a_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  b_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE CASCADE,
  rules text[] NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (a_id < b_id),
  UNIQUE (a_id, b_id)
);
CREATE INDEX recruitment_duplicates_open ON recruitment_duplicates (tenant_id, company_id, status);

-- A job with its scoring profile (whitelisted criteria only; validated by the module before saving).
CREATE TABLE recruitment_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 160),
  department text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  employment text NOT NULL DEFAULT 'full_time' CHECK (employment IN ('full_time', 'part_time', 'contract', 'internship', 'project')),
  openings int NOT NULL DEFAULT 1 CHECK (openings BETWEEN 1 AND 500),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'on_hold', 'closed')),
  scoring jsonb NOT NULL DEFAULT '[]',
  scoring_version int NOT NULL DEFAULT 1,
  interview_form_id uuid,
  opened_on date NOT NULL,
  closed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX recruitment_jobs_list ON recruitment_jobs (tenant_id, company_id, status) WHERE deleted_at IS NULL;

CREATE TABLE recruitment_stages (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  sort int NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'hired', 'rejected')),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recruitment_stages_company ON recruitment_stages (tenant_id, company_id, sort);

CREATE TABLE recruitment_applications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  candidate_id uuid NOT NULL REFERENCES recruitment_candidates (id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES recruitment_jobs (id) ON DELETE RESTRICT,
  stage_id uuid NOT NULL REFERENCES recruitment_stages (id) ON DELETE RESTRICT,
  score numeric(5,1),
  score_breakdown jsonb NOT NULL DEFAULT '[]',
  scoring_version int,
  scored_at timestamptz,
  rejection_reason text NOT NULL DEFAULT '',
  hired_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, job_id)
);
CREATE INDEX recruitment_applications_job ON recruitment_applications (tenant_id, job_id, stage_id);

CREATE TABLE recruitment_application_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES recruitment_applications (id) ON DELETE CASCADE,
  from_stage_id uuid REFERENCES recruitment_stages (id) ON DELETE RESTRICT,
  to_stage_id uuid NOT NULL REFERENCES recruitment_stages (id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recruitment_application_events_app ON recruitment_application_events (tenant_id, application_id, changed_at);

CREATE TABLE recruitment_interview_forms (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  criteria jsonb NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE TABLE recruitment_interviews (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  application_id uuid NOT NULL REFERENCES recruitment_applications (id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES recruitment_interview_forms (id) ON DELETE RESTRICT,
  interviewer_id uuid NOT NULL,
  scheduled_at timestamptz NOT NULL,
  mode text NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person', 'online', 'phone')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled')),
  ratings jsonb NOT NULL DEFAULT '{}',
  score numeric(5,1),
  recommendation text CHECK (recommendation IN ('strong_yes', 'yes', 'no', 'strong_no')),
  notes text NOT NULL DEFAULT '',
  evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX recruitment_interviews_interviewer ON recruitment_interviews (tenant_id, interviewer_id, status, scheduled_at);
CREATE INDEX recruitment_interviews_application ON recruitment_interviews (tenant_id, application_id);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE recruitment_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_candidates AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_candidates AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_educations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_educations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_educations AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_educations AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_experiences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_experiences AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_experiences AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_candidate_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_candidate_projects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_candidate_projects AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_candidate_projects AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_skills FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_skills AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_skills AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_files AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_files AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_duplicates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_duplicates AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_duplicates AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_jobs AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_jobs AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_stages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_stages AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_stages AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_applications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_applications AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_applications AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_application_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_application_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_application_events AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_application_events AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_interview_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_interview_forms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_interview_forms AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_interview_forms AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE recruitment_interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruitment_interviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recruitment_interviews AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON recruitment_interviews AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
