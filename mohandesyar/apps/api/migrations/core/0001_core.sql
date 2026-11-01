-- Core schema (docs/05-data-model.md §1). Runs as mohandesyar_owner inside one transaction.
-- Tables are either PLATFORM tables (no tenant_id, no RLS, reached only through platform/core code)
-- or TENANT tables (tenant_id + forced RLS). Grants to mohandesyar_app are applied by the runner.

-- ============================================================ helpers
CREATE FUNCTION core_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION core_current_companies() RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('app.company_ids', true), '')::uuid[], '{}'::uuid[]) $$;

-- ============================================================ identity (platform tables)
CREATE TABLE core_users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  mobile text,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_enc text,
  totp_enabled boolean NOT NULL DEFAULT false,
  locale text NOT NULL DEFAULT 'fa',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX core_users_email ON core_users (lower(email));
CREATE UNIQUE INDEX core_users_mobile ON core_users (mobile) WHERE mobile IS NOT NULL;

CREATE TABLE platform_admins (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  full_name text NOT NULL,
  password_hash text NOT NULL,
  totp_secret_enc text,
  totp_enabled boolean NOT NULL DEFAULT false,
  roles text[] NOT NULL CHECK (roles <@ ARRAY['super_admin', 'tech_admin', 'sales_admin', 'support']::text[]),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_admins_email ON platform_admins (lower(email));

CREATE TABLE core_sessions (
  id uuid PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'admin')),
  subject_id uuid NOT NULL,
  tenant_id uuid,
  family_id uuid NOT NULL,
  refresh_hash text NOT NULL,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE UNIQUE INDEX core_sessions_refresh ON core_sessions (refresh_hash);
CREATE INDEX core_sessions_subject ON core_sessions (subject_type, subject_id);
CREATE INDEX core_sessions_family ON core_sessions (family_id);

-- ============================================================ tenancy
CREATE TABLE core_tenants (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'suspended', 'closed')),
  timezone text NOT NULL DEFAULT 'Asia/Tehran',
  number_style text NOT NULL DEFAULT 'fa' CHECK (number_style IN ('fa', 'latn')),
  branding jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core_companies (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  name text NOT NULL,
  legal_name text,
  national_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX core_companies_tenant ON core_companies (tenant_id);

CREATE TABLE core_org_units (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES core_companies (id),
  parent_id uuid REFERENCES core_org_units (id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX core_org_units_tenant ON core_org_units (tenant_id, company_id);

CREATE TABLE core_memberships (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  user_id uuid NOT NULL REFERENCES core_users (id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  title text,
  org_unit_id uuid REFERENCES core_org_units (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX core_memberships_user ON core_memberships (user_id);

-- ============================================================ access control
CREATE TABLE core_permissions (
  key text PRIMARY KEY,
  module_id text NOT NULL,
  label_fa text NOT NULL,
  scopes text[] NOT NULL,
  sensitive boolean NOT NULL DEFAULT false
);

CREATE TABLE core_roles (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  key text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  module_id text,
  approval_limit numeric(20, 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE core_role_permissions (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES core_roles (id) ON DELETE CASCADE,
  permission text NOT NULL,           -- exact key or wildcard pattern (e.g. "hello-module.*", "*")
  scope text NOT NULL DEFAULT 'company' CHECK (scope IN ('company', 'unit', 'project', 'own')),
  PRIMARY KEY (role_id, permission)
);
CREATE INDEX core_role_permissions_tenant ON core_role_permissions (tenant_id);

CREATE TABLE core_role_assignments (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL REFERENCES core_memberships (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES core_roles (id) ON DELETE CASCADE,
  company_id uuid REFERENCES core_companies (id),   -- NULL = every company of the tenant
  org_unit_id uuid REFERENCES core_org_units (id),
  project_ref uuid,
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX core_role_assignments_membership ON core_role_assignments (tenant_id, membership_id);

CREATE TABLE core_company_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL REFERENCES core_memberships (id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES core_companies (id),
  permissions text[] NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX core_company_grants_membership ON core_company_grants (tenant_id, membership_id);

-- ============================================================ modules (platform tables)
CREATE TABLE core_trusted_keys (
  key_id text PRIMARY KEY,
  public_key text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE core_modules (
  id text PRIMARY KEY,
  name jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('installed', 'failed', 'uninstalled_data_retained', 'uninstalled')),
  active_version text,
  previous_version text,
  globally_enabled boolean NOT NULL DEFAULT false,
  installed_at timestamptz,
  installed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core_module_versions (
  module_id text NOT NULL,
  version text NOT NULL,
  manifest jsonb NOT NULL,
  package_sha256 text NOT NULL,
  signer_key_id text NOT NULL,
  store_path text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'active', 'superseded', 'removed')),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid,
  PRIMARY KEY (module_id, version)
);

CREATE TABLE core_module_migrations (
  module_id text NOT NULL,
  file text NOT NULL,
  checksum text NOT NULL,
  version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  duration_ms int NOT NULL,
  PRIMARY KEY (module_id, file)
);

CREATE TABLE core_module_operations (
  id uuid PRIMARY KEY,
  module_id text NOT NULL,
  op text NOT NULL CHECK (op IN ('upload', 'install', 'upgrade', 'rollback', 'enable_global', 'disable_global', 'enable_tenant', 'disable_tenant', 'uninstall', 'purge')),
  target_tenant_id uuid,
  version text,
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  log jsonb NOT NULL DEFAULT '[]',
  error text,
  actor_admin_id uuid,
  actor_user_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX core_module_operations_module ON core_module_operations (module_id, started_at DESC);

CREATE TABLE core_module_runtime_status (
  instance_id text NOT NULL,
  module_id text NOT NULL,
  version text,
  status text NOT NULL CHECK (status IN ('loaded', 'load_failed', 'skipped')),
  error text,
  booted_at timestamptz NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, module_id)
);

-- Commercial metadata per tenant: visible to the platform panel, contains no business data.
CREATE TABLE core_tenant_modules (
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  module_id text NOT NULL REFERENCES core_modules (id),
  enabled boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('plan', 'addon', 'manual', 'trial')),
  settings jsonb NOT NULL DEFAULT '{}',
  seeded_version text,
  enabled_at timestamptz,
  disabled_at timestamptz,
  PRIMARY KEY (tenant_id, module_id)
);

-- ============================================================ subscription (platform tables)
CREATE TABLE core_plans (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_monthly numeric(20, 0),
  price_yearly numeric(20, 0),
  user_limit int,
  storage_gb int,
  features jsonb NOT NULL DEFAULT '{}',
  is_public boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))
);

CREATE TABLE core_plan_modules (
  plan_key text NOT NULL REFERENCES core_plans (key),
  module_id text NOT NULL,
  included boolean NOT NULL DEFAULT true,
  addon_price numeric(20, 0),
  PRIMARY KEY (plan_key, module_id)
);

CREATE TABLE core_subscriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES core_tenants (id),
  plan_key text NOT NULL REFERENCES core_plans (key),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'expired', 'canceled')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  trial_end timestamptz,
  user_limit_extra int NOT NULL DEFAULT 0,
  storage_extra_gb int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core_subscription_addons (
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  module_id text NOT NULL,
  price numeric(20, 0),
  valid_to timestamptz,
  PRIMARY KEY (tenant_id, module_id)
);

CREATE TABLE core_tenant_grants (
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  module_id text NOT NULL,
  reason text NOT NULL,
  valid_to timestamptz,
  created_by uuid,
  PRIMARY KEY (tenant_id, module_id)
);

-- ============================================================ audit (append-only, hash chained)
CREATE TABLE core_audit_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'support')),
  actor_id uuid,
  action text NOT NULL,
  module_id text,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash text NOT NULL,
  hash text NOT NULL
);
CREATE INDEX core_audit_log_tenant ON core_audit_log (tenant_id, at DESC);
CREATE INDEX core_audit_log_entity ON core_audit_log (entity_type, entity_id);

CREATE FUNCTION core_audit_append(
  p_tenant uuid, p_actor_type text, p_actor uuid, p_action text, p_module text,
  p_entity_type text, p_entity_id text, p_before jsonb, p_after jsonb, p_ip text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev text;
  v_at timestamptz := clock_timestamp();
  v_hash text;
  v_id bigint;
BEGIN
  -- Serialise appends so the chain is linear.
  PERFORM pg_advisory_xact_lock(7710001);
  SELECT hash INTO v_prev FROM core_audit_log ORDER BY id DESC LIMIT 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  v_hash := encode(sha256(convert_to(concat_ws('|', v_prev, p_tenant, p_actor_type, p_actor, p_action, p_module,
    p_entity_type, p_entity_id, p_before::text, p_after::text, p_ip, to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex');
  INSERT INTO core_audit_log (tenant_id, actor_type, actor_id, action, module_id, entity_type, entity_id, before, after, ip, at, prev_hash, hash)
  VALUES (p_tenant, p_actor_type, p_actor, p_action, p_module, p_entity_type, p_entity_id, p_before, p_after, p_ip, v_at, v_prev, v_hash)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Recomputes the chain; returns the first broken id or NULL when intact.
CREATE FUNCTION core_audit_verify() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_prev text := repeat('0', 64);
  v_hash text;
BEGIN
  FOR r IN SELECT * FROM core_audit_log ORDER BY id LOOP
    v_hash := encode(sha256(convert_to(concat_ws('|', v_prev, r.tenant_id, r.actor_type, r.actor_id, r.action, r.module_id,
      r.entity_type, r.entity_id, r.before::text, r.after::text, r.ip, to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')), 'UTF8')), 'hex');
    IF r.prev_hash <> v_prev OR r.hash <> v_hash THEN RETURN r.id; END IF;
    v_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ============================================================ events (transactional outbox)
CREATE TABLE core_outbox (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid,
  module_id text NOT NULL,
  event_type text NOT NULL,
  version int NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'dispatched', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX core_outbox_pending ON core_outbox (available_at) WHERE status = 'pending';

CREATE TABLE core_event_consumptions (
  event_id uuid NOT NULL,
  consumer text NOT NULL,
  tenant_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('done', 'skipped', 'failed')),
  error text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, consumer)
);

-- Dispatcher claims across tenants without being able to read business tables.
CREATE FUNCTION core_outbox_claim(p_limit int) RETURNS SETOF core_outbox LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_outbox SET status = 'processing', attempts = attempts + 1
   WHERE id IN (SELECT id FROM core_outbox WHERE status = 'pending' AND available_at <= now()
                ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING *;
$$;
CREATE FUNCTION core_outbox_finish(p_id uuid, p_ok boolean, p_error text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_outbox SET
    status = CASE WHEN p_ok THEN 'dispatched' WHEN attempts >= 8 THEN 'failed' ELSE 'pending' END,
    dispatched_at = CASE WHEN p_ok THEN now() END,
    last_error = p_error,
    available_at = now() + (interval '2 seconds' * power(2, attempts))
  WHERE id = p_id;
$$;

-- ============================================================ notifications, tasks, files, settings
CREATE TABLE core_notifications (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,
  module_id text,
  title text NOT NULL,
  body text,
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX core_notifications_user ON core_notifications (tenant_id, user_id, created_at DESC);

CREATE TABLE core_tasks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  assignee_id uuid,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'canceled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  source_module text,
  source_entity_type text,
  source_entity_id text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX core_tasks_assignee ON core_tasks (tenant_id, assignee_id, status);

CREATE TABLE core_files (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  object_key text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  scan_status text NOT NULL DEFAULT 'skipped' CHECK (scan_status IN ('pending', 'clean', 'infected', 'skipped')),
  confidentiality text NOT NULL DEFAULT 'internal' CHECK (confidentiality IN ('public', 'internal', 'confidential', 'secret')),
  owner_module text,
  owner_entity_type text,
  owner_entity_id text,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX core_files_owner ON core_files (tenant_id, owner_module, owner_entity_type, owner_entity_id);

CREATE TABLE core_settings (
  tenant_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('tenant', 'company', 'user')),
  scope_id uuid NOT NULL,
  module_id text NOT NULL DEFAULT 'core',
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (tenant_id, scope, scope_id, module_id)
);

CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ workflow engine
CREATE TABLE core_workflow_defs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  module_id text NOT NULL,
  version int NOT NULL,
  definition jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key, version)
);

CREATE TABLE core_workflow_instances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  def_id uuid NOT NULL REFERENCES core_workflow_defs (id),
  module_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  amount numeric(20, 0),
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected', 'canceled')),
  current_step int NOT NULL DEFAULT 0,
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX core_workflow_instances_entity ON core_workflow_instances (tenant_id, module_id, entity_type, entity_id);

CREATE TABLE core_workflow_steps (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  instance_id uuid NOT NULL REFERENCES core_workflow_instances (id) ON DELETE CASCADE,
  step_index int NOT NULL,
  step_key text NOT NULL,
  approver_role text,
  approver_user_id uuid,
  decision text CHECK (decision IN ('approve', 'reject')),
  comment text,
  decided_by uuid,
  decided_at timestamptz,
  UNIQUE (instance_id, step_index)
);

-- ============================================================ cross-tenant read helpers (SECURITY DEFINER, minimal output)
CREATE FUNCTION core_user_memberships(p_user uuid)
RETURNS TABLE (membership_id uuid, tenant_id uuid, tenant_name text, tenant_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, t.id, t.name, t.status FROM core_memberships m JOIN core_tenants t ON t.id = m.tenant_id
   WHERE m.user_id = p_user AND m.status = 'active' ORDER BY t.name;
$$;

CREATE FUNCTION core_tenant_usage()
RETURNS TABLE (tenant_id uuid, active_users bigint, companies bigint, storage_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id,
         (SELECT count(*) FROM core_memberships m WHERE m.tenant_id = t.id AND m.status = 'active'),
         (SELECT count(*) FROM core_companies c WHERE c.tenant_id = t.id),
         (SELECT coalesce(sum(size), 0)::bigint FROM core_files f WHERE f.tenant_id = t.id AND f.deleted_at IS NULL)
    FROM core_tenants t;
$$;

-- ============================================================ RLS for tenant tables
DO $$
DECLARE t text;
BEGIN
  -- tenant-level tables (no company scope)
  FOREACH t IN ARRAY ARRAY['core_companies', 'core_org_units', 'core_memberships', 'core_roles', 'core_role_permissions',
                           'core_role_assignments', 'core_company_grants', 'core_notifications', 'core_settings',
                           'core_workflow_defs', 'core_workflow_steps', 'core_outbox', 'core_event_consumptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant())', t);
    EXECUTE format('CREATE POLICY tenant_rows ON %I AS PERMISSIVE USING (true) WITH CHECK (true)', t);
  END LOOP;
  -- company-scoped tables
  FOREACH t IN ARRAY ARRAY['core_tasks', 'core_files', 'core_workflow_instances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant())', t);
    EXECUTE format('CREATE POLICY company_scope ON %I AS PERMISSIVE USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()))', t);
  END LOOP;
END $$;

-- The audit log is append-only for the app role and readable per tenant; appends go through core_audit_append.
ALTER TABLE core_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON core_audit_log FOR SELECT USING (tenant_id = core_current_tenant());
