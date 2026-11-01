-- Deliberately broken (rollback test): creates a table, then fails on a column that does not exist.
CREATE TABLE hello_module_leftover (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
UPDATE hello_module_notes SET no_such_column = 1;
