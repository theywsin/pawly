-- Phase 7: images managed from the console (blog, client logos) and the "our customers" strip.
--
-- Images are platform data (no tenant). Objects live in the same bucket under p/<id> and are served by
-- the API at /api/public/media/<id> (raster formats only: SVG can carry script, so it is refused).
CREATE TABLE platform_media (
  id uuid PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  name text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  size int NOT NULL CHECK (size > 0),
  alt text NOT NULL DEFAULT '',
  uploaded_by uuid NOT NULL REFERENCES platform_admins (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Logos on the landing page. The section stays hidden until at least one logo is published.
CREATE TABLE platform_clients (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  logo_id uuid NOT NULL REFERENCES platform_media (id),
  url text CHECK (url IS NULL OR (url ~ '^https?://' AND length(url) <= 300)),
  sort int NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
