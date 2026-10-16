-- Integrations: API keys for the module REST APIs and outgoing webhooks for module events.
--
-- An API key acts for the member who created it, in one company, with the intersection of that member's
-- current permissions and the key's explicit scopes; only a SHA-256 of the secret is stored. Webhooks
-- deliver selected events of their company, signed with HMAC-SHA256 (secret stored encrypted).
CREATE TABLE core_api_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  prefix text NOT NULL UNIQUE CHECK (prefix ~ '^[a-z0-9]{10}$'),
  secret_hash text NOT NULL,
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 200),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core_webhooks (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  url text NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 500),
  events text[] NOT NULL CHECK (cardinality(events) BETWEEN 1 AND 100),
  secret_enc text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core_webhook_deliveries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  webhook_id uuid NOT NULL REFERENCES core_webhooks (id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'ok', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  response_status int,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  UNIQUE (webhook_id, event_id)
);
CREATE INDEX core_webhook_deliveries_pending ON core_webhook_deliveries (available_at) WHERE status = 'pending';
CREATE INDEX core_webhook_deliveries_hook ON core_webhook_deliveries (webhook_id, created_at DESC);

ALTER TABLE core_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core_api_keys AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON core_api_keys AS PERMISSIVE USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE core_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_webhooks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core_webhooks AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON core_webhooks AS PERMISSIVE USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));
ALTER TABLE core_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core_webhook_deliveries AS RESTRICTIVE USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());
CREATE POLICY company_scope ON core_webhook_deliveries AS PERMISSIVE USING (company_id = ANY (core_current_companies())) WITH CHECK (company_id = ANY (core_current_companies()));

-- Key lookup happens before the tenant is known (the key itself names it): by its public prefix only.
CREATE FUNCTION core_api_key_lookup(p_prefix text)
  RETURNS TABLE (id uuid, tenant_id uuid, company_id uuid, user_id uuid, secret_hash text, scopes text[], expires_at timestamptz, revoked_at timestamptz)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, tenant_id, company_id, user_id, secret_hash, scopes, expires_at, revoked_at FROM core_api_keys WHERE prefix = p_prefix;
$$;
CREATE FUNCTION core_api_key_touch(p_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_api_keys SET last_used_at = now() WHERE id = p_id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
$$;

-- The sender works across tenants: claims due deliveries with their webhook's address and secret.
CREATE FUNCTION core_webhook_claim(p_limit int)
  RETURNS TABLE (id uuid, tenant_id uuid, event_id uuid, event_type text, body text, attempts int, url text, secret_enc text)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_webhook_deliveries d SET status = 'sending', attempts = d.attempts + 1
    FROM core_webhooks w
   WHERE w.id = d.webhook_id
     AND d.id IN (SELECT x.id FROM core_webhook_deliveries x WHERE x.status = 'pending' AND x.available_at <= now() ORDER BY x.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING d.id, d.tenant_id, d.event_id, d.event_type, d.body, d.attempts, w.url, w.secret_enc;
$$;
CREATE FUNCTION core_webhook_finish(p_id uuid, p_ok boolean, p_status int, p_error text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_webhook_deliveries SET
    status = CASE WHEN p_ok THEN 'ok' WHEN attempts >= 6 THEN 'failed' ELSE 'pending' END,
    response_status = p_status,
    last_error = left(p_error, 500),
    delivered_at = CASE WHEN p_ok THEN now() END,
    available_at = now() + (interval '30 seconds' * power(2, attempts))
  WHERE id = p_id;
$$;
GRANT SELECT, UPDATE ON core_api_keys, core_webhooks, core_webhook_deliveries TO mohandesyar_definer;
ALTER FUNCTION core_api_key_lookup(text) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_api_key_touch(uuid) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_webhook_claim(int) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_webhook_finish(uuid, boolean, int, text) OWNER TO mohandesyar_definer;
