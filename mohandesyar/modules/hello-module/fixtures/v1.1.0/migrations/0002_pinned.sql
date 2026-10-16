-- 1.1.0 (expand): additive and backward compatible, so rolling back to 1.0.0 needs no down migration.
ALTER TABLE hello_module_notes ADD COLUMN pinned boolean NOT NULL DEFAULT false;
