-- Phase 7: blog managed from the console.
--
-- The body is a list of typed blocks (paragraph, heading, list, quote, image) stored as JSON and rendered
-- by React; no HTML from the editor ever reaches a page. A post is public when it is published and its
-- publish time has passed, so a future time schedules it.
CREATE TABLE platform_blog_categories (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 80),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE platform_blog_posts (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 120),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 200),
  excerpt text NOT NULL DEFAULT '' CHECK (length(excerpt) <= 500),
  cover_id uuid REFERENCES platform_media (id),
  category_id uuid REFERENCES platform_blog_categories (id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  body jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  author_name text NOT NULL DEFAULT '' CHECK (length(author_name) <= 120),
  seo_title text NOT NULL DEFAULT '' CHECK (length(seo_title) <= 200),
  seo_description text NOT NULL DEFAULT '' CHECK (length(seo_description) <= 300),
  created_by uuid NOT NULL REFERENCES platform_admins (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR published_at IS NOT NULL)
);
CREATE INDEX platform_blog_posts_public ON platform_blog_posts (published_at DESC) WHERE status = 'published';
CREATE INDEX platform_blog_posts_tags ON platform_blog_posts USING gin (tags);
