ALTER TABLE tasks ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE task_examples ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

UPDATE tasks SET language = 'en' WHERE language IS NULL OR language = '';
UPDATE task_examples SET language = 'en' WHERE language IS NULL OR language = '';
