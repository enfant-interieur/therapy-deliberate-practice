ALTER TABLE tasks ADD COLUMN authors TEXT NOT NULL DEFAULT '[]';
UPDATE tasks SET authors = '[]' WHERE authors IS NULL OR authors = '';
