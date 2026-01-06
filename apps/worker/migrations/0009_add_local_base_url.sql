ALTER TABLE user_settings ADD COLUMN local_base_url TEXT;

UPDATE user_settings
SET local_base_url = local_stt_url,
    local_stt_url = NULL,
    local_llm_url = NULL
WHERE local_base_url IS NULL
  AND local_stt_url IS NOT NULL
  AND local_llm_url IS NOT NULL
  AND local_stt_url = local_llm_url;

UPDATE user_settings
SET local_base_url = 'http://127.0.0.1:8484'
WHERE local_base_url IS NULL
  AND local_stt_url IS NULL
  AND local_llm_url IS NULL;
