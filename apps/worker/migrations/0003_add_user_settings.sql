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
  created_at INTEGER NOT NULL
);
