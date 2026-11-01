-- meetings 1.0.0 — meetings, attendees, agenda, minutes, resolutions with owner and deadline, sent reminders.

CREATE TABLE meetings_meetings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  kind text NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'client', 'site', 'board', 'coordination', 'other')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  location text NOT NULL DEFAULT '',
  online_link text NOT NULL DEFAULT '',
  projects_project_id uuid,
  organizer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'held', 'cancelled')),
  minutes text NOT NULL DEFAULT '',
  minutes_finalized_at timestamptz,
  minutes_finalized_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (ends_at > starts_at)
);
CREATE INDEX meetings_meetings_time ON meetings_meetings (tenant_id, company_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX meetings_meetings_project ON meetings_meetings (tenant_id, projects_project_id) WHERE deleted_at IS NULL;

CREATE TABLE meetings_attendees (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  meeting_id uuid NOT NULL REFERENCES meetings_meetings (id) ON DELETE RESTRICT,
  user_id uuid,
  external_name text NOT NULL DEFAULT '',
  external_org text NOT NULL DEFAULT '',
  attendance text NOT NULL DEFAULT 'unknown' CHECK (attendance IN ('unknown', 'present', 'absent')),
  CHECK (user_id IS NOT NULL OR length(external_name) >= 2)
);
CREATE UNIQUE INDEX meetings_attendees_user ON meetings_attendees (meeting_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX meetings_attendees_member ON meetings_attendees (tenant_id, user_id);

CREATE TABLE meetings_agenda_items (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  meeting_id uuid NOT NULL REFERENCES meetings_meetings (id) ON DELETE RESTRICT,
  sort int NOT NULL DEFAULT 0,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  presenter_id uuid
);
CREATE INDEX meetings_agenda_meeting ON meetings_agenda_items (tenant_id, meeting_id, sort);

CREATE TABLE meetings_resolutions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  meeting_id uuid NOT NULL REFERENCES meetings_meetings (id) ON DELETE RESTRICT,
  number int NOT NULL CHECK (number > 0),
  body text NOT NULL CHECK (length(body) BETWEEN 2 AND 2000),
  owner_id uuid NOT NULL,
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  done_on date,
  follow_up text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, number),
  CHECK (status <> 'done' OR done_on IS NOT NULL)
);
CREATE INDEX meetings_resolutions_owner ON meetings_resolutions (tenant_id, owner_id, status, due_on);
CREATE INDEX meetings_resolutions_due ON meetings_resolutions (tenant_id, status, due_on);

CREATE TABLE meetings_alerts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  alert_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alert_key)
);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE meetings_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings_meetings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings_meetings AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON meetings_meetings AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE meetings_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings_attendees FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings_attendees AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON meetings_attendees AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE meetings_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings_agenda_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings_agenda_items AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON meetings_agenda_items AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE meetings_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings_resolutions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings_resolutions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON meetings_resolutions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE meetings_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meetings_alerts AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON meetings_alerts AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
