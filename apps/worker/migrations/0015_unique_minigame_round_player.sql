-- Reconcile legacy duplicates deterministically before enforcing the two
-- invariants. The earliest inserted result is the authoritative one.
DELETE FROM minigame_round_results
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM minigame_round_results
  GROUP BY round_id, player_id
);

DELETE FROM minigame_round_results
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM minigame_round_results
  GROUP BY attempt_id
);

CREATE UNIQUE INDEX IF NOT EXISTS minigame_round_results_round_player_unique_idx
ON minigame_round_results(round_id, player_id);

CREATE UNIQUE INDEX IF NOT EXISTS minigame_round_results_attempt_unique_idx
ON minigame_round_results(attempt_id);
