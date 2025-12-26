CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  skill_domain TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  patient_profile TEXT NOT NULL,
  example_prompt TEXT NOT NULL,
  example_good_response TEXT,
  objectives TEXT NOT NULL,
  grading TEXT NOT NULL,
  tags TEXT NOT NULL,
  is_published INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  audio_ref TEXT,
  transcript TEXT NOT NULL,
  evaluation TEXT NOT NULL,
  overall_pass INTEGER NOT NULL,
  overall_score REAL NOT NULL,
  model_info TEXT
);
