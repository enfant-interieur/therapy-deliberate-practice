DROP TRIGGER IF EXISTS attempts_progress_after_completion;
DROP TRIGGER IF EXISTS attempts_progress_on_completed_insert;
DROP TRIGGER IF EXISTS minigame_result_progress_after_insert;

CREATE TRIGGER attempts_progress_after_completion
AFTER UPDATE OF completed_at ON attempts
WHEN OLD.completed_at IS NULL
  AND NEW.completed_at IS NOT NULL
  AND CASE
    WHEN json_valid(NEW.model_info)
      THEN coalesce(json_extract(NEW.model_info, '$.practice.scope.kind'), '') <> 'minigame'
    ELSE 1
  END
BEGIN
  INSERT INTO user_task_progress (
    user_id,
    task_id,
    current_difficulty,
    last_overall_score,
    last_pass,
    streak,
    attempt_count,
    updated_at
  )
  SELECT
    NEW.user_id,
    NEW.task_id,
    CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2
        THEN MIN(5, tasks.base_difficulty + 1)
      WHEN NEW.overall_pass = 0 OR NEW.overall_score < 2.4
        THEN MAX(1, tasks.base_difficulty - 1)
      ELSE tasks.base_difficulty
    END,
    NEW.overall_score,
    NEW.overall_pass,
    CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2 THEN 1
      ELSE 0
    END,
    1,
    NEW.completed_at
  FROM tasks
  WHERE tasks.id = NEW.task_id
  ON CONFLICT(user_id, task_id) DO UPDATE SET
    current_difficulty = CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2
        THEN MIN(5, user_task_progress.current_difficulty + 1)
      WHEN NEW.overall_pass = 0 OR NEW.overall_score < 2.4
        THEN MAX(1, user_task_progress.current_difficulty - 1)
      ELSE user_task_progress.current_difficulty
    END,
    last_overall_score = NEW.overall_score,
    last_pass = NEW.overall_pass,
    streak = CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2
        THEN user_task_progress.streak + 1
      WHEN NEW.overall_pass = 0 OR NEW.overall_score < 2.4
        THEN 0
      ELSE user_task_progress.streak
    END,
    attempt_count = user_task_progress.attempt_count + 1,
    updated_at = NEW.completed_at;
END;

CREATE TRIGGER attempts_progress_on_completed_insert
AFTER INSERT ON attempts
WHEN NEW.completed_at IS NOT NULL
  AND CASE
    WHEN json_valid(NEW.model_info)
      THEN coalesce(json_extract(NEW.model_info, '$.practice.scope.kind'), '') <> 'minigame'
    ELSE 1
  END
BEGIN
  INSERT INTO user_task_progress (
    user_id,
    task_id,
    current_difficulty,
    last_overall_score,
    last_pass,
    streak,
    attempt_count,
    updated_at
  )
  SELECT
    NEW.user_id,
    NEW.task_id,
    CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2
        THEN MIN(5, tasks.base_difficulty + 1)
      WHEN NEW.overall_pass = 0 OR NEW.overall_score < 2.4
        THEN MAX(1, tasks.base_difficulty - 1)
      ELSE tasks.base_difficulty
    END,
    NEW.overall_score,
    NEW.overall_pass,
    CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2 THEN 1
      ELSE 0
    END,
    1,
    NEW.completed_at
  FROM tasks
  WHERE tasks.id = NEW.task_id
  ON CONFLICT(user_id, task_id) DO UPDATE SET
    current_difficulty = CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2
        THEN MIN(5, user_task_progress.current_difficulty + 1)
      WHEN NEW.overall_pass = 0 OR NEW.overall_score < 2.4
        THEN MAX(1, user_task_progress.current_difficulty - 1)
      ELSE user_task_progress.current_difficulty
    END,
    last_overall_score = NEW.overall_score,
    last_pass = NEW.overall_pass,
    streak = CASE
      WHEN NEW.overall_pass = 1 AND NEW.overall_score >= 3.2
        THEN user_task_progress.streak + 1
      WHEN NEW.overall_pass = 0 OR NEW.overall_score < 2.4
        THEN 0
      ELSE user_task_progress.streak
    END,
    attempt_count = user_task_progress.attempt_count + 1,
    updated_at = NEW.completed_at;
END;

CREATE TRIGGER minigame_result_progress_after_insert
AFTER INSERT ON minigame_round_results
BEGIN
  INSERT INTO user_task_progress (
    user_id,
    task_id,
    current_difficulty,
    last_overall_score,
    last_pass,
    streak,
    attempt_count,
    updated_at
  )
  SELECT
    attempts.user_id,
    attempts.task_id,
    CASE
      WHEN attempts.overall_pass = 1 AND attempts.overall_score >= 3.2
        THEN MIN(5, tasks.base_difficulty + 1)
      WHEN attempts.overall_pass = 0 OR attempts.overall_score < 2.4
        THEN MAX(1, tasks.base_difficulty - 1)
      ELSE tasks.base_difficulty
    END,
    attempts.overall_score,
    attempts.overall_pass,
    CASE
      WHEN attempts.overall_pass = 1 AND attempts.overall_score >= 3.2 THEN 1
      ELSE 0
    END,
    1,
    attempts.completed_at
  FROM attempts
  JOIN tasks ON tasks.id = attempts.task_id
  JOIN minigame_rounds ON minigame_rounds.id = NEW.round_id
  WHERE attempts.id = NEW.attempt_id
    AND attempts.completed_at IS NOT NULL
    AND json_valid(attempts.model_info)
    AND json_extract(attempts.model_info, '$.practice.scope.kind') = 'minigame'
    AND json_extract(attempts.model_info, '$.practice.scope.session_id')
      = minigame_rounds.session_id
    AND json_extract(attempts.model_info, '$.practice.scope.round_id')
      = NEW.round_id
    AND json_extract(attempts.model_info, '$.practice.scope.player_id')
      = NEW.player_id
  ON CONFLICT(user_id, task_id) DO UPDATE SET
    current_difficulty = CASE
      WHEN excluded.last_pass = 1 AND excluded.last_overall_score >= 3.2
        THEN MIN(5, user_task_progress.current_difficulty + 1)
      WHEN excluded.last_pass = 0 OR excluded.last_overall_score < 2.4
        THEN MAX(1, user_task_progress.current_difficulty - 1)
      ELSE user_task_progress.current_difficulty
    END,
    last_overall_score = excluded.last_overall_score,
    last_pass = excluded.last_pass,
    streak = CASE
      WHEN excluded.last_pass = 1 AND excluded.last_overall_score >= 3.2
        THEN user_task_progress.streak + 1
      WHEN excluded.last_pass = 0 OR excluded.last_overall_score < 2.4
        THEN 0
      ELSE user_task_progress.streak
    END,
    attempt_count = user_task_progress.attempt_count + 1,
    updated_at = excluded.updated_at;
END;
