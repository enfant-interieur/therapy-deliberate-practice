CREATE TABLE IF NOT EXISTS admin_batch_parse_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  step TEXT NOT NULL,
  total_segments INTEGER,
  completed_segments INTEGER NOT NULL DEFAULT 0,
  created_task_ids TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  source_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_batch_parse_jobs_status_idx
  ON admin_batch_parse_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS admin_batch_parse_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  step TEXT NOT NULL,
  message TEXT NOT NULL,
  meta TEXT,
  FOREIGN KEY(job_id) REFERENCES admin_batch_parse_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS admin_batch_parse_job_events_job_idx
  ON admin_batch_parse_job_events(job_id, id);
