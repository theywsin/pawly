-- Work calendar: weekly days off per organisation (JS weekday numbers; Friday = 5) and organisation holidays
-- (lunar official holidays and company days off). Fixed solar official holidays are computed, not stored.
ALTER TABLE core_tenants ADD COLUMN weekly_off smallint[] NOT NULL DEFAULT '{5}';

CREATE TABLE core_holidays (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id) ON DELETE CASCADE,
  date date NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  kind text NOT NULL DEFAULT 'official' CHECK (kind IN ('official', 'company')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, date)
);
ALTER TABLE core_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core_holidays AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY tenant_rows ON core_holidays AS PERMISSIVE USING (true) WITH CHECK (true);
