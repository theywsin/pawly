-- taskboard 1.0.0 — recurring duties, assigned tasks with due time, check-off and manager review with score,
-- attendance (check-in / check-out against the working day start), daily work reports with manager score.
-- Company-scoped, forced RLS. Times are timestamptz (UTC); days are dates in the organisation's calendar.

CREATE TABLE taskboard_duties (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '',
  assignee_id uuid NOT NULL,
  recurrence text NOT NULL CHECK (recurrence IN ('daily', 'weekly', 'monthly')),
  -- weekly: JS weekdays (0 = Sunday … 6 = Saturday); monthly: day of the Jalali month (1–31, capped at month end)
  weekdays smallint[] NOT NULL DEFAULT '{}',
  month_day smallint CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31),
  due_time text NOT NULL CHECK (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  skip_days_off boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (recurrence <> 'weekly' OR cardinality(weekdays) > 0),
  CHECK (recurrence <> 'monthly' OR month_day IS NOT NULL)
);
CREATE INDEX taskboard_duties_active ON taskboard_duties (tenant_id, company_id) WHERE active;

CREATE TABLE taskboard_tasks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
  description text NOT NULL DEFAULT '',
  assignee_id uuid NOT NULL,
  created_by uuid NOT NULL,
  duty_id uuid REFERENCES taskboard_duties (id) ON DELETE SET NULL,
  occurrence_on date,
  due_at timestamptz NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'approved', 'returned', 'cancelled')),
  done_at timestamptz,
  done_note text NOT NULL DEFAULT '',
  reviewed_by uuid,
  reviewed_at timestamptz,
  score smallint CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  review_note text NOT NULL DEFAULT '',
  overdue_notified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('done', 'approved') OR done_at IS NOT NULL),
  CHECK (status <> 'approved' OR score IS NOT NULL)
);
CREATE UNIQUE INDEX taskboard_tasks_occurrence ON taskboard_tasks (duty_id, occurrence_on) WHERE duty_id IS NOT NULL;
CREATE INDEX taskboard_tasks_assignee ON taskboard_tasks (tenant_id, company_id, assignee_id, due_at);
CREATE INDEX taskboard_tasks_open ON taskboard_tasks (tenant_id, due_at) WHERE status IN ('todo', 'returned');

CREATE TABLE taskboard_attendance (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day date NOT NULL,
  check_in timestamptz NOT NULL,
  check_out timestamptz,
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  note text NOT NULL DEFAULT '',
  UNIQUE (company_id, user_id, day),
  CHECK (check_out IS NULL OR check_out > check_in)
);
CREATE INDEX taskboard_attendance_day ON taskboard_attendance (tenant_id, company_id, day);

CREATE TABLE taskboard_reports (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  day date NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 5 AND 10000),
  hours numeric(4,1) CHECK (hours IS NULL OR (hours > 0 AND hours <= 24)),
  score smallint CHECK (score IS NULL OR score BETWEEN 1 AND 5),
  scored_by uuid,
  scored_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, day)
);
CREATE INDEX taskboard_reports_day ON taskboard_reports (tenant_id, company_id, day);

-- Row-level security: tenant isolation (restrictive) + company scope.
ALTER TABLE taskboard_duties ENABLE ROW LEVEL SECURITY;
ALTER TABLE taskboard_duties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON taskboard_duties AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON taskboard_duties AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE taskboard_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE taskboard_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON taskboard_tasks AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON taskboard_tasks AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE taskboard_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE taskboard_attendance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON taskboard_attendance AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON taskboard_attendance AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE taskboard_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE taskboard_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON taskboard_reports AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON taskboard_reports AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
