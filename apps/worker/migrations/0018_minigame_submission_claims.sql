DROP TRIGGER IF EXISTS minigame_round_start_claim_pending_before_insert;
DROP TRIGGER IF EXISTS minigame_round_start_claim_pending_before_update;
DROP TRIGGER IF EXISTS minigame_submission_claim_valid_before_insert;
DROP TRIGGER IF EXISTS minigame_submission_claim_immutable_before_update;
DROP TRIGGER IF EXISTS minigame_submission_claim_immutable_before_delete;
DROP TRIGGER IF EXISTS attempts_minigame_claim_before_completed_insert;
DROP TRIGGER IF EXISTS attempts_minigame_claim_before_completion_update;
DROP TRIGGER IF EXISTS minigame_result_claim_before_insert;

CREATE TABLE IF NOT EXISTS minigame_submission_claims (
  round_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id),
  UNIQUE (attempt_id)
);

INSERT OR IGNORE INTO minigame_submission_claims (
  round_id,
  player_id,
  attempt_id,
  created_at
)
SELECT
  round_id,
  player_id,
  attempt_id,
  created_at
FROM minigame_round_results;

CREATE TRIGGER minigame_round_start_claim_pending_before_insert
BEFORE INSERT ON minigame_round_start_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_rounds
  JOIN minigame_sessions
    ON minigame_sessions.id = minigame_rounds.session_id
  JOIN tasks
    ON tasks.id = minigame_rounds.task_id
  WHERE minigame_rounds.id = NEW.round_id
    AND minigame_rounds.session_id = NEW.session_id
    AND minigame_rounds.status = 'pending'
    AND minigame_sessions.deleted_at IS NULL
    AND minigame_sessions.ended_at IS NULL
    AND tasks.is_published = 1
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ROUND_START_NOT_PENDING');
END;

CREATE TRIGGER minigame_round_start_claim_pending_before_update
BEFORE UPDATE ON minigame_round_start_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_rounds
  JOIN minigame_sessions
    ON minigame_sessions.id = minigame_rounds.session_id
  JOIN tasks
    ON tasks.id = minigame_rounds.task_id
  WHERE minigame_rounds.id = NEW.round_id
    AND minigame_rounds.session_id = NEW.session_id
    AND minigame_rounds.status = 'pending'
    AND minigame_sessions.deleted_at IS NULL
    AND minigame_sessions.ended_at IS NULL
    AND tasks.is_published = 1
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ROUND_START_NOT_PENDING');
END;

CREATE TRIGGER minigame_submission_claim_valid_before_insert
BEFORE INSERT ON minigame_submission_claims
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_rounds
  JOIN minigame_sessions
    ON minigame_sessions.id = minigame_rounds.session_id
  JOIN tasks
    ON tasks.id = minigame_rounds.task_id
  JOIN minigame_players
    ON minigame_players.id = NEW.player_id
   AND minigame_players.session_id = minigame_rounds.session_id
  WHERE minigame_rounds.id = NEW.round_id
    AND minigame_rounds.status = 'active'
    AND (
      minigame_rounds.player_a_id = NEW.player_id
      OR minigame_rounds.player_b_id = NEW.player_id
    )
    AND minigame_sessions.deleted_at IS NULL
    AND minigame_sessions.ended_at IS NULL
    AND tasks.is_published = 1
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_SUBMISSION_CLAIM_INVALID');
END;

CREATE TRIGGER minigame_submission_claim_immutable_before_update
BEFORE UPDATE ON minigame_submission_claims
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_SUBMISSION_CLAIM_IMMUTABLE');
END;

CREATE TRIGGER minigame_submission_claim_immutable_before_delete
BEFORE DELETE ON minigame_submission_claims
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_SUBMISSION_CLAIM_IMMUTABLE');
END;

CREATE TRIGGER attempts_minigame_claim_before_completed_insert
BEFORE INSERT ON attempts
WHEN NEW.completed_at IS NOT NULL
  AND json_valid(NEW.model_info)
  AND json_extract(NEW.model_info, '$.practice.scope.kind') = 'minigame'
  AND NOT EXISTS (
    SELECT 1
    FROM minigame_submission_claims
    JOIN minigame_rounds
      ON minigame_rounds.id = minigame_submission_claims.round_id
    JOIN minigame_sessions
      ON minigame_sessions.id = minigame_rounds.session_id
    JOIN tasks
      ON tasks.id = minigame_rounds.task_id
    WHERE minigame_submission_claims.attempt_id = NEW.id
      AND minigame_submission_claims.round_id
        = json_extract(NEW.model_info, '$.practice.scope.round_id')
      AND minigame_submission_claims.player_id
        = json_extract(NEW.model_info, '$.practice.scope.player_id')
      AND minigame_rounds.session_id
        = json_extract(NEW.model_info, '$.practice.scope.session_id')
      AND minigame_rounds.status = 'active'
      AND (
        minigame_rounds.player_a_id = minigame_submission_claims.player_id
        OR minigame_rounds.player_b_id = minigame_submission_claims.player_id
      )
      AND minigame_sessions.user_id = NEW.user_id
      AND minigame_sessions.deleted_at IS NULL
      AND minigame_sessions.ended_at IS NULL
      AND tasks.is_published = 1
      AND minigame_rounds.task_id = NEW.task_id
      AND minigame_rounds.example_id = NEW.example_id
  )
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ATTEMPT_CLAIM_INVALID');
END;

CREATE TRIGGER attempts_minigame_claim_before_completion_update
BEFORE UPDATE OF completed_at ON attempts
WHEN OLD.completed_at IS NULL
  AND NEW.completed_at IS NOT NULL
  AND json_valid(NEW.model_info)
  AND json_extract(NEW.model_info, '$.practice.scope.kind') = 'minigame'
  AND NOT EXISTS (
    SELECT 1
    FROM minigame_submission_claims
    JOIN minigame_rounds
      ON minigame_rounds.id = minigame_submission_claims.round_id
    JOIN minigame_sessions
      ON minigame_sessions.id = minigame_rounds.session_id
    JOIN tasks
      ON tasks.id = minigame_rounds.task_id
    WHERE minigame_submission_claims.attempt_id = NEW.id
      AND minigame_submission_claims.round_id
        = json_extract(NEW.model_info, '$.practice.scope.round_id')
      AND minigame_submission_claims.player_id
        = json_extract(NEW.model_info, '$.practice.scope.player_id')
      AND minigame_rounds.session_id
        = json_extract(NEW.model_info, '$.practice.scope.session_id')
      AND minigame_rounds.status = 'active'
      AND (
        minigame_rounds.player_a_id = minigame_submission_claims.player_id
        OR minigame_rounds.player_b_id = minigame_submission_claims.player_id
      )
      AND minigame_sessions.user_id = NEW.user_id
      AND minigame_sessions.deleted_at IS NULL
      AND minigame_sessions.ended_at IS NULL
      AND tasks.is_published = 1
      AND minigame_rounds.task_id = NEW.task_id
      AND minigame_rounds.example_id = NEW.example_id
  )
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_ATTEMPT_CLAIM_INVALID');
END;

CREATE TRIGGER minigame_result_claim_before_insert
BEFORE INSERT ON minigame_round_results
WHEN NOT EXISTS (
  SELECT 1
  FROM minigame_submission_claims
  JOIN minigame_rounds
    ON minigame_rounds.id = minigame_submission_claims.round_id
  JOIN minigame_sessions
    ON minigame_sessions.id = minigame_rounds.session_id
  JOIN tasks
    ON tasks.id = minigame_rounds.task_id
  JOIN attempts
    ON attempts.id = minigame_submission_claims.attempt_id
  WHERE minigame_submission_claims.round_id = NEW.round_id
    AND minigame_submission_claims.player_id = NEW.player_id
    AND minigame_submission_claims.attempt_id = NEW.attempt_id
    AND minigame_rounds.status = 'active'
    AND (
      minigame_rounds.player_a_id = NEW.player_id
      OR minigame_rounds.player_b_id = NEW.player_id
    )
    AND minigame_sessions.user_id = attempts.user_id
    AND minigame_sessions.deleted_at IS NULL
    AND minigame_sessions.ended_at IS NULL
    AND tasks.is_published = 1
    AND attempts.completed_at IS NOT NULL
    AND attempts.task_id = minigame_rounds.task_id
    AND attempts.example_id = minigame_rounds.example_id
    AND attempts.overall_pass = NEW.overall_pass
    AND NEW.overall_score >= 0
    AND NEW.overall_score <= attempts.overall_score
    AND json_valid(attempts.model_info)
    AND json_extract(attempts.model_info, '$.practice.scope.kind') = 'minigame'
    AND json_extract(attempts.model_info, '$.practice.scope.session_id')
      = minigame_rounds.session_id
    AND json_extract(attempts.model_info, '$.practice.scope.round_id')
      = NEW.round_id
    AND json_extract(attempts.model_info, '$.practice.scope.player_id')
      = NEW.player_id
)
BEGIN
  SELECT RAISE(ABORT, 'MINIGAME_RESULT_CLAIM_INVALID');
END;
