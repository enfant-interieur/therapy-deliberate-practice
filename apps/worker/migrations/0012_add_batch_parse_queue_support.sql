ALTER TABLE admin_batch_parse_jobs
ADD COLUMN parse_mode TEXT NOT NULL DEFAULT 'original';

CREATE TABLE IF NOT EXISTS admin_batch_parse_job_payloads (
  job_id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(job_id) REFERENCES admin_batch_parse_jobs(id) ON DELETE CASCADE
);
