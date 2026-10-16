-- Phase 7: support tickets between an organisation's members and the platform team.
--
-- Platform data like billing: the console reads it across organisations, and tenant endpoints always
-- filter by the caller's tenant (and by author unless the member may see all tickets).
CREATE SEQUENCE platform_ticket_number START 1001;
GRANT USAGE, SELECT ON SEQUENCE platform_ticket_number TO mohandesyar_app;

CREATE TABLE platform_tickets (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  number bigint NOT NULL UNIQUE DEFAULT nextval('platform_ticket_number'),
  created_by uuid NOT NULL REFERENCES core_users (id),
  subject text NOT NULL CHECK (length(subject) BETWEEN 3 AND 200),
  category text NOT NULL CHECK (category IN ('technical', 'billing', 'feature', 'other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'customer_reply', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_tickets_tenant ON platform_tickets (tenant_id, updated_at DESC);
CREATE INDEX platform_tickets_status ON platform_tickets (status, updated_at DESC);

CREATE TABLE platform_ticket_messages (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES platform_tickets (id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('user', 'admin')),
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_ticket_messages_ticket ON platform_ticket_messages (ticket_id, created_at);

-- Attachments are uploaded first (message_id NULL) and attached when the message is sent.
CREATE TABLE platform_ticket_files (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES core_tenants (id),
  ticket_id uuid REFERENCES platform_tickets (id) ON DELETE CASCADE,
  message_id uuid REFERENCES platform_ticket_messages (id) ON DELETE CASCADE,
  uploader_type text NOT NULL CHECK (uploader_type IN ('user', 'admin')),
  uploaded_by uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  name text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL CHECK (size > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_ticket_files_message ON platform_ticket_files (message_id);
