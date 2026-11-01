-- projects 1.1.0 (expand only): fingerprint of the work calendar the stored schedule was computed with,
-- so dates are recomputed after the organisation changes its days off or holidays.
ALTER TABLE projects_projects ADD COLUMN schedule_calendar text;
