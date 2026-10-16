-- Outgoing email (SMTP). Rows are written in the same transaction as the notification, so an email is
-- never sent for work that was rolled back; a background sender claims and delivers them with retries.
CREATE TABLE core_email_queue (
  id uuid PRIMARY KEY,
  tenant_id uuid,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX core_email_queue_pending ON core_email_queue (available_at) WHERE status = 'pending';
ALTER TABLE core_email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_email_queue FORCE ROW LEVEL SECURITY;
-- The app writes a tenant's rows only within that tenant (platform mail has no tenant and is written by the migrator role).
CREATE POLICY tenant_rows ON core_email_queue FOR ALL USING (tenant_id = core_current_tenant()) WITH CHECK (tenant_id = core_current_tenant());

CREATE FUNCTION core_email_claim(p_limit int) RETURNS SETOF core_email_queue LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_email_queue SET status = 'sending', attempts = attempts + 1
   WHERE id IN (SELECT id FROM core_email_queue WHERE status = 'pending' AND available_at <= now() ORDER BY created_at LIMIT p_limit FOR UPDATE SKIP LOCKED)
  RETURNING *;
$$;
CREATE FUNCTION core_email_finish(p_id uuid, p_ok boolean, p_error text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE core_email_queue SET
    status = CASE WHEN p_ok THEN 'sent' WHEN attempts >= 6 THEN 'failed' ELSE 'pending' END,
    sent_at = CASE WHEN p_ok THEN now() END,
    last_error = left(p_error, 500),
    available_at = now() + (interval '30 seconds' * power(2, attempts))
  WHERE id = p_id;
$$;
CREATE FUNCTION core_email_stats() RETURNS TABLE (status text, n bigint) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT status, count(*) FROM core_email_queue GROUP BY status;
$$;
GRANT SELECT, UPDATE ON core_email_queue TO mohandesyar_definer;
ALTER FUNCTION core_email_claim(int) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_email_finish(uuid, boolean, text) OWNER TO mohandesyar_definer;
ALTER FUNCTION core_email_stats() OWNER TO mohandesyar_definer;
REVOKE EXECUTE ON FUNCTION core_email_claim(int), core_email_finish(uuid, boolean, text), core_email_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core_email_claim(int), core_email_finish(uuid, boolean, text), core_email_stats() TO mohandesyar_app, mohandesyar_owner;

-- Users can turn off email copies of their notifications (in-app notifications always stay).
ALTER TABLE core_users ADD COLUMN email_notifications boolean NOT NULL DEFAULT true;
