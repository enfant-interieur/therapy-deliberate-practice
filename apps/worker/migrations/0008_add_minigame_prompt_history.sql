CREATE TABLE IF NOT EXISTS minigame_player_prompt_history (
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  patient_statement_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, player_id, patient_statement_id)
);

CREATE INDEX IF NOT EXISTS minigame_player_prompt_history_session_id_idx
  ON minigame_player_prompt_history (session_id);
