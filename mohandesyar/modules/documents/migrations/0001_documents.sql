-- documents 1.0.0 — document management: folder tree, categories, tags, Persian full-text search, versions
-- (immutable once approved) with approval through the core workflow, confidentiality levels with per-document
-- access lists, expiry reminders, links to project / contract / payment / user, a view and download log for
-- sensitive documents, and retention policies (a document under retention cannot be deleted; disposal after
-- retention is a manual, logged step). Company-scoped, forced RLS.

CREATE TABLE documents_folders (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  parent_id uuid REFERENCES documents_folders (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE UNIQUE INDEX documents_folders_name_uq ON documents_folders (company_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

CREATE TABLE documents_retention_policies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  years integer NOT NULL CHECK (years BETWEEN 1 AND 100),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE documents_categories (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  requires_approval boolean NOT NULL DEFAULT true,
  retention_policy_id uuid REFERENCES documents_retention_policies (id) ON DELETE RESTRICT,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE documents_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 60),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 300),
  description text NOT NULL DEFAULT '',
  folder_id uuid REFERENCES documents_folders (id) ON DELETE RESTRICT,
  category_id uuid REFERENCES documents_categories (id) ON DELETE RESTRICT,
  tags text[] NOT NULL DEFAULT '{}',
  confidentiality text NOT NULL DEFAULT 'internal' CHECK (confidentiality IN ('internal', 'confidential', 'secret')),
  owner_id uuid NOT NULL,
  -- status of the document as a whole: draft (no approved version yet), active, obsolete, disposed.
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'obsolete', 'disposed')),
  current_version integer,
  expires_on date,
  remind_days integer NOT NULL DEFAULT 30 CHECK (remind_days BETWEEN 0 AND 365),
  reminded_for date,
  effective_on date, -- date the first version was approved; retention counts from here
  retention_until date,
  retention_notified boolean NOT NULL DEFAULT false,
  search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  disposed_at timestamptz,
  disposed_by uuid,
  UNIQUE (company_id, code)
);
CREATE INDEX documents_documents_folder_idx ON documents_documents (folder_id);
CREATE INDEX documents_documents_expiry_idx ON documents_documents (expires_on) WHERE expires_on IS NOT NULL;
CREATE INDEX documents_documents_search_idx ON documents_documents USING gin (to_tsvector('simple', search_text));
CREATE INDEX documents_documents_trgm_idx ON documents_documents USING gin (search_text gin_trgm_ops);

CREATE TABLE documents_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents_documents (id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  file_id uuid,
  file_name text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  mime text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  workflow_instance_id uuid,
  approvers uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  decided_at timestamptz,
  UNIQUE (document_id, version)
);

-- An approved version never changes (file, number, note); only its status may move to superseded, and
-- its file reference may be cleared when the document is disposed after retention.
CREATE FUNCTION documents_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved', 'superseded') THEN
    IF NEW.version <> OLD.version OR NEW.file_name <> OLD.file_name OR NEW.note <> OLD.note OR NEW.document_id <> OLD.document_id
       OR (NEW.file_id IS DISTINCT FROM OLD.file_id AND NEW.file_id IS NOT NULL)
       OR NEW.status NOT IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'documents: approved version is immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER documents_versions_guard BEFORE UPDATE ON documents_versions FOR EACH ROW EXECUTE FUNCTION documents_versions_guard();

CREATE TABLE documents_links (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents_documents (id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('project', 'contract', 'payment', 'user')),
  entity_id uuid NOT NULL,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  UNIQUE (document_id, entity_type, entity_id)
);
CREATE INDEX documents_links_entity_idx ON documents_links (entity_type, entity_id);

-- Access list for confidential and secret documents: named users with view or edit right (roles: later, A51).
CREATE TABLE documents_access (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents_documents (id) ON DELETE CASCADE,
  principal_type text NOT NULL DEFAULT 'user' CHECK (principal_type = 'user'),
  principal text NOT NULL CHECK (length(principal) BETWEEN 1 AND 100),
  can_edit boolean NOT NULL DEFAULT false,
  UNIQUE (document_id, principal_type, principal)
);

-- Who opened or downloaded a confidential/secret document (in addition to the core audit log).
CREATE TABLE documents_access_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES documents_documents (id) ON DELETE CASCADE,
  version integer,
  action text NOT NULL CHECK (action IN ('view', 'download')),
  user_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_access_log_doc_idx ON documents_access_log (document_id, at DESC);

CREATE FUNCTION documents_access_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'documents: access log is append-only';
END $$;
CREATE TRIGGER documents_access_log_guard BEFORE UPDATE ON documents_access_log FOR EACH ROW EXECUTE FUNCTION documents_access_log_guard();

ALTER TABLE documents_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_folders AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_folders AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_retention_policies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_retention_policies AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_retention_policies AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_categories AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_categories AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_documents AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_documents AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_versions AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_versions AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_links AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_links AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_access AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_access AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE documents_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents_access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents_access_log AS RESTRICTIVE FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON documents_access_log AS PERMISSIVE FOR ALL USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
