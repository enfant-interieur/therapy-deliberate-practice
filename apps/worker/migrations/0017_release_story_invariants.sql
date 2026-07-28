DROP TRIGGER IF EXISTS minigame_teams_limit_before_insert;
DROP TRIGGER IF EXISTS minigame_players_limit_before_insert;
DROP TRIGGER IF EXISTS minigame_rounds_limit_before_insert;
DROP TRIGGER IF EXISTS minigame_rounds_active_before_insert;
DROP TRIGGER IF EXISTS minigame_rounds_active_before_update;
DROP TRIGGER IF EXISTS minigame_rounds_position_before_insert;
DROP TRIGGER IF EXISTS minigame_redraw_claim_pending_before_insert;
DROP TRIGGER IF EXISTS minigame_round_start_claim_pending_before_insert;
DROP TRIGGER IF EXISTS minigame_round_start_claim_pending_before_update;
DROP TRIGGER IF EXISTS minigame_manual_selection_before_insert;
DROP TRIGGER IF EXISTS minigame_manual_selection_before_update;
DROP TRIGGER IF EXISTS task_example_history_before_delete;
DROP TRIGGER IF EXISTS task_example_history_before_update;
DROP TRIGGER IF EXISTS task_history_before_delete;

CREATE TABLE IF NOT EXISTS minigame_redraw_claims (
  replaced_round_id TEXT PRIMARY KEY,
  replacement_round_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS minigame_round_start_claims (
  round_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TRIGGER minigame_round_start_claim_pending_before_insert
BEFORE INSERT ON minigame_round_start_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_rounds
  WHERE id = NEW.round_id
    AND session_id = NEW.session_id
    AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ROUND_START_NOT_PENDING');
END;

CREATE TRIGGER minigame_round_start_claim_pending_before_update
BEFORE UPDATE ON minigame_round_start_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_rounds
  WHERE id = NEW.round_id
    AND session_id = NEW.session_id
    AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ROUND_START_NOT_PENDING');
END;

CREATE TRIGGER minigame_redraw_claim_pending_before_insert
BEFORE INSERT ON minigame_redraw_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_rounds
  WHERE id = NEW.replaced_round_id
    AND status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_REDRAW_NOT_PENDING');
END;

CREATE TRIGGER minigame_manual_selection_before_insert
BEFORE INSERT ON minigame_sessions
WHEN json_extract(NEW.task_selection, '$.strategy') = 'manual'
  AND EXISTS (
    SELECT 1
    FROM json_each(NEW.task_selection, '$.task_ids') AS selected
    LEFT JOIN tasks ON tasks.id = selected.value
    WHERE tasks.id IS NULL OR tasks.is_published <> 1
  )
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_TASK_SELECTION_INVALID');
END;

CREATE TRIGGER minigame_manual_selection_before_update
BEFORE UPDATE OF task_selection ON minigame_sessions
WHEN json_extract(NEW.task_selection, '$.strategy') = 'manual'
  AND EXISTS (
    SELECT 1
    FROM json_each(NEW.task_selection, '$.task_ids') AS selected
    LEFT JOIN tasks ON tasks.id = selected.value
    WHERE tasks.id IS NULL OR tasks.is_published <> 1
  )
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_TASK_SELECTION_INVALID');
END;

CREATE TRIGGER minigame_teams_limit_before_insert
BEFORE INSERT ON minigame_teams
WHEN (
  SELECT COUNT(*)
  FROM minigame_teams
  WHERE session_id = NEW.session_id
) >= 4
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_TEAM_LIMIT');
END;

CREATE TRIGGER minigame_players_limit_before_insert
BEFORE INSERT ON minigame_players
WHEN (
  SELECT COUNT(*)
  FROM minigame_players
  WHERE session_id = NEW.session_id
) >= 16
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_PLAYER_LIMIT');
END;

CREATE TRIGGER minigame_rounds_limit_before_insert
BEFORE INSERT ON minigame_rounds
WHEN (
  SELECT COUNT(*)
  FROM minigame_rounds
  WHERE session_id = NEW.session_id
) >= 320
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ROUND_LIMIT');
END;

CREATE TRIGGER minigame_rounds_active_before_insert
BEFORE INSERT ON minigame_rounds
WHEN NEW.status = 'active'
  AND EXISTS (
  SELECT 1
  FROM minigame_rounds
  WHERE session_id = NEW.session_id
    AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ACTIVE_ROUND');
END;

CREATE TRIGGER minigame_rounds_active_before_update
BEFORE UPDATE OF status ON minigame_rounds
WHEN NEW.status = 'active'
  AND OLD.status IS NOT 'active'
  AND EXISTS (
    SELECT 1
    FROM minigame_rounds
    WHERE session_id = NEW.session_id
      AND id <> NEW.id
      AND status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ACTIVE_ROUND');
END;

CREATE TRIGGER minigame_rounds_position_before_insert
BEFORE INSERT ON minigame_rounds
WHEN EXISTS (
  SELECT 1
  FROM minigame_rounds
  WHERE session_id = NEW.session_id
    AND position = NEW.position
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_POSITION_CONFLICT');
END;

CREATE TRIGGER task_example_history_before_delete
BEFORE DELETE ON task_examples
WHEN
  EXISTS (SELECT 1 FROM attempts WHERE example_id = OLD.id)
  OR EXISTS (
    SELECT 1 FROM practice_session_items WHERE example_id = OLD.id
  )
  OR EXISTS (SELECT 1 FROM minigame_rounds WHERE example_id = OLD.id)
  OR EXISTS (
    SELECT 1
    FROM minigame_player_prompt_history
    WHERE patient_statement_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'TASK_EXAMPLE_HISTORY_EXISTS');
END;

CREATE TRIGGER task_example_history_before_update
BEFORE UPDATE ON task_examples
WHEN (
  OLD.task_id IS NOT NEW.task_id
  OR OLD.difficulty IS NOT NEW.difficulty
  OR OLD.severity_label IS NOT NEW.severity_label
  OR OLD.patient_text IS NOT NEW.patient_text
  OR OLD.language IS NOT NEW.language
  OR OLD.meta IS NOT NEW.meta
) AND (
  EXISTS (SELECT 1 FROM attempts WHERE example_id = OLD.id)
  OR EXISTS (
    SELECT 1 FROM practice_session_items WHERE example_id = OLD.id
  )
  OR EXISTS (SELECT 1 FROM minigame_rounds WHERE example_id = OLD.id)
  OR EXISTS (
    SELECT 1
    FROM minigame_player_prompt_history
    WHERE patient_statement_id = OLD.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'TASK_EXAMPLE_HISTORY_EXISTS');
END;

CREATE TRIGGER task_history_before_delete
BEFORE DELETE ON tasks
WHEN
  EXISTS (SELECT 1 FROM attempts WHERE task_id = OLD.id)
  OR EXISTS (
    SELECT 1 FROM practice_session_items WHERE task_id = OLD.id
  )
  OR EXISTS (
    SELECT 1 FROM practice_sessions WHERE source_task_id = OLD.id
  )
  OR EXISTS (SELECT 1 FROM minigame_rounds WHERE task_id = OLD.id)
  OR EXISTS (
    SELECT 1 FROM user_task_progress WHERE task_id = OLD.id
  )
  OR EXISTS (
    SELECT 1 FROM tasks WHERE parent_task_id = OLD.id
  )
  OR EXISTS (
    SELECT 1
    FROM minigame_sessions, json_each(minigame_sessions.task_selection, '$.task_ids')
    WHERE json_each.value = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'TASK_HISTORY_EXISTS');
END;
