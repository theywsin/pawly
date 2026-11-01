-- hello-module 1.0.0: notes table, company-scoped, with forced RLS (required by the installer).
CREATE TABLE hello_module_notes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  deleted_at timestamptz,
  version int NOT NULL DEFAULT 1
);
CREATE INDEX hello_module_notes_list ON hello_module_notes (tenant_id, company_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX hello_module_notes_title ON hello_module_notes USING gin (title gin_trgm_ops);

ALTER TABLE hello_module_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hello_module_notes FORCE ROW LEVEL SECURITY;
-- core_current_tenant()/core_current_companies() are provided by the core and fail closed when unset.
CREATE POLICY tenant_isolation ON hello_module_notes AS RESTRICTIVE FOR ALL
  USING (tenant_id = core_current_tenant())
  WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON hello_module_notes AS PERMISSIVE FOR ALL
  USING (company_id = ANY (core_current_companies()))
  WITH CHECK (company_id = ANY (core_current_companies()));
