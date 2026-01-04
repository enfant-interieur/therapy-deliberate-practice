CREATE TABLE IF NOT EXISTS task_interaction_examples (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  title TEXT,
  patient_text TEXT NOT NULL,
  therapist_text TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  meta TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS task_interaction_examples_task_id_idx
  ON task_interaction_examples (task_id);

CREATE INDEX IF NOT EXISTS task_interaction_examples_task_id_difficulty_idx
  ON task_interaction_examples (task_id, difficulty);
