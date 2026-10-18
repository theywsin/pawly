-- Deliberately unsafe (installer must refuse): tenant data without row-level security.
CREATE TABLE hello_module_unsafe (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, secret text);
