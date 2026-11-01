-- Structured details for module operations (upload preview, check results, dependency analysis).
ALTER TABLE core_module_operations ADD COLUMN details jsonb NOT NULL DEFAULT '{}';
ALTER TABLE core_module_operations ADD COLUMN upload_id uuid;
CREATE INDEX core_module_operations_upload ON core_module_operations (upload_id) WHERE upload_id IS NOT NULL;

-- Platform-level audit entries (tenant_id IS NULL) for the console; tenant entries stay behind RLS.
CREATE FUNCTION core_audit_platform(p_limit int, p_before bigint)
RETURNS TABLE (id bigint, actor_type text, actor_id uuid, action text, module_id text, entity_type text, entity_id text, after jsonb, ip text, at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, actor_type, actor_id, action, module_id, entity_type, entity_id, after, ip, at
    FROM core_audit_log WHERE tenant_id IS NULL AND (p_before IS NULL OR id < p_before)
   ORDER BY id DESC LIMIT least(p_limit, 500);
$$;

-- Queue health for the console without exposing event payloads across tenants.
CREATE FUNCTION core_outbox_stats() RETURNS TABLE (status text, n bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT status, count(*) FROM core_outbox GROUP BY status;
$$;

-- SECURITY DEFINER helpers that read across tenants are owned by mohandesyar_definer (NOLOGIN, BYPASSRLS):
-- forced RLS applies even to the table owner, so owner-owned definer functions would see nothing.
GRANT SELECT ON core_memberships, core_tenants, core_companies, core_files TO mohandesyar_definer;
GRANT SELECT, UPDATE ON core_outbox TO mohandesyar_definer;
GRANT SELECT, INSERT ON core_audit_log TO mohandesyar_definer;
GRANT USAGE ON SEQUENCE core_audit_log_id_seq TO mohandesyar_definer;
ALTER FUNCTION core_user_memberships(uuid) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_tenant_usage() OWNER TO mohandesyar_definer;
ALTER FUNCTION core_outbox_claim(int) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_outbox_finish(uuid, boolean, text) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_outbox_stats() OWNER TO mohandesyar_definer;
ALTER FUNCTION core_audit_append(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_audit_verify() OWNER TO mohandesyar_definer;
ALTER FUNCTION core_audit_platform(int, bigint) OWNER TO mohandesyar_definer;
-- Functions are executable by PUBLIC by default; restrict the cross-tenant ones to the app role.
REVOKE EXECUTE ON FUNCTION core_user_memberships(uuid), core_tenant_usage(), core_outbox_claim(int), core_outbox_finish(uuid, boolean, text),
  core_outbox_stats(), core_audit_append(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text), core_audit_verify(), core_audit_platform(int, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core_user_memberships(uuid), core_tenant_usage(), core_outbox_claim(int), core_outbox_finish(uuid, boolean, text),
  core_outbox_stats(), core_audit_append(uuid, text, uuid, text, text, text, text, jsonb, jsonb, text), core_audit_verify(), core_audit_platform(int, bigint) TO mohandesyar_app, mohandesyar_owner;
