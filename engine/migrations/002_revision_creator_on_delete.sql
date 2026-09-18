ALTER TABLE project_revisions
  DROP CONSTRAINT IF EXISTS project_revisions_created_by_fkey;

ALTER TABLE project_revisions
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE project_revisions
  ADD CONSTRAINT project_revisions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
