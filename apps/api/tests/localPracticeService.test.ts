import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LocalEvaluationValidationError,
  validateAndDeriveLocalEvaluation,
} from "../src/services/localPracticeService";

const evaluation = {
  version: "2.0" as const,
  task_id: "task-1",
  example_id: "example-1",
  attempt_id: "attempt-1",
  transcript: { text: "I hear how difficult this has been." },
  criterion_scores: [
    {
      criterion_id: "c1",
      score: 4,
      rationale_short: "Names and reflects the difficulty.",
    },
    {
      criterion_id: "c2",
      score: 2,
      rationale_short: "Could ask a more open follow-up.",
    },
  ],
  overall: {
    score: 4,
    pass: false,
    summary_feedback: "A clear reflection with room for exploration.",
    what_to_improve_next: ["Add an open question."],
  },
  patient_reaction: { emotion: "engaged" as const, intensity: 2 as const },
};

const identity = {
  taskId: "task-1",
  exampleId: "example-1",
  attemptId: "attempt-1",
  transcript: "I hear how difficult this has been.",
  criterionIds: ["c1", "c2"],
};

test("derives local aggregate score and pass instead of trusting client totals", () => {
  const result = validateAndDeriveLocalEvaluation(evaluation, identity);

  assert.equal(result.overall.score, 3);
  assert.equal(result.overall.pass, true);
});

test("rejects duplicate, missing, or unrelated criterion scores", () => {
  assert.throws(
    () =>
      validateAndDeriveLocalEvaluation(
        {
          ...evaluation,
          criterion_scores: [
            evaluation.criterion_scores[0],
            evaluation.criterion_scores[0],
          ],
        },
        identity,
      ),
    LocalEvaluationValidationError,
  );
});

test("rejects attempt identity and transcript mismatches", () => {
  assert.throws(
    () =>
      validateAndDeriveLocalEvaluation(
        { ...evaluation, attempt_id: "another-attempt" },
        identity,
      ),
    LocalEvaluationValidationError,
  );
  assert.throws(
    () =>
      validateAndDeriveLocalEvaluation(
        { ...evaluation, transcript: { text: "different" } },
        identity,
      ),
    LocalEvaluationValidationError,
  );
});
