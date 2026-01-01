CREATE TABLE IF NOT EXISTS tts_assets (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL,
  text TEXT NOT NULL,
  voice TEXT NOT NULL,
  model TEXT NOT NULL,
  format TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  bytes INTEGER,
  content_type TEXT NOT NULL,
  etag TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS tts_assets_cache_key_idx ON tts_assets (cache_key);
