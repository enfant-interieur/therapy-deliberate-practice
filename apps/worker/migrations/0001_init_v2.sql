PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  ai_mode TEXT NOT NULL DEFAULT 'local_prefer',
  local_stt_url TEXT,
  local_llm_url TEXT,
  store_audio INTEGER NOT NULL DEFAULT 0,
  openai_key_ciphertext TEXT,
  openai_key_iv TEXT,
  openai_key_kid TEXT,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  skill_domain TEXT NOT NULL,
  base_difficulty INTEGER NOT NULL,
  general_objective TEXT,
  tags TEXT NOT NULL,
  is_published INTEGER NOT NULL,
  parent_task_id TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_skill_domain_idx ON tasks(skill_domain);
CREATE INDEX IF NOT EXISTS tasks_is_published_idx ON tasks(is_published);
CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx ON tasks(parent_task_id);

CREATE TABLE IF NOT EXISTS task_criteria (
  id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  rubric TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, id)
);

CREATE TABLE IF NOT EXISTS task_examples (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  difficulty INTEGER NOT NULL,
  severity_label TEXT NULL,
  patient_text TEXT NOT NULL,
  meta TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS task_examples_task_id_idx ON task_examples(task_id);
CREATE INDEX IF NOT EXISTS task_examples_task_id_difficulty_idx ON task_examples(task_id, difficulty);

CREATE TABLE IF NOT EXISTS practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  source_task_id TEXT NULL REFERENCES tasks(id),
  random_seed TEXT NULL,
  created_at INTEGER NOT NULL,
  ended_at INTEGER NULL
);

CREATE INDEX IF NOT EXISTS practice_sessions_user_id_created_at_idx ON practice_sessions(user_id, created_at);

CREATE TABLE IF NOT EXISTS practice_session_items (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  example_id TEXT NOT NULL REFERENCES task_examples(id) ON DELETE CASCADE,
  target_difficulty INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, position)
);

CREATE INDEX IF NOT EXISTS practice_session_items_session_id_idx ON practice_session_items(session_id);
CREATE INDEX IF NOT EXISTS practice_session_items_task_id_idx ON practice_session_items(task_id);
CREATE INDEX IF NOT EXISTS practice_session_items_example_id_idx ON practice_session_items(example_id);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NULL REFERENCES practice_sessions(id) ON DELETE SET NULL,
  session_item_id TEXT NULL REFERENCES practice_session_items(id) ON DELETE SET NULL,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  example_id TEXT NOT NULL REFERENCES task_examples(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NULL,
  audio_ref TEXT NULL,
  transcript TEXT NOT NULL,
  evaluation TEXT NOT NULL,
  overall_pass INTEGER NOT NULL,
  overall_score REAL NOT NULL,
  model_info TEXT NULL
);

CREATE INDEX IF NOT EXISTS attempts_user_id_started_at_idx ON attempts(user_id, started_at);
CREATE INDEX IF NOT EXISTS attempts_task_id_started_at_idx ON attempts(task_id, started_at);
CREATE INDEX IF NOT EXISTS attempts_example_id_started_at_idx ON attempts(example_id, started_at);
CREATE INDEX IF NOT EXISTS attempts_session_id_started_at_idx ON attempts(session_id, started_at);

CREATE TABLE IF NOT EXISTS user_task_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  current_difficulty INTEGER NOT NULL DEFAULT 2,
  last_overall_score REAL NULL,
  last_pass INTEGER NULL,
  streak INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS user_task_progress_user_id_updated_at_idx ON user_task_progress(user_id, updated_at);
