ALTER TABLE attempts
ADD COLUMN score_trust TEXT NOT NULL DEFAULT 'local_unverified';

-- Existing scores are trusted only when their recorded evaluator positively
-- identifies the hosted OpenAI provider. Missing, malformed, and local
-- provenance stays conservative and cannot enter public rankings.
UPDATE attempts
SET score_trust = 'cloud_trusted'
WHERE lower(
  COALESCE(
    CASE
      WHEN json_valid(model_info)
      THEN json_extract(model_info, '$.provider.llm.kind')
      ELSE NULL
    END,
    ''
  )
) = 'openai';

CREATE INDEX IF NOT EXISTS attempts_score_trust_completed_at_idx
ON attempts(score_trust, completed_at);
