import {
  evaluationResultSchema,
  type EvaluationResult,
} from "@deliberate/shared";

export type LocalEvaluationIdentity = {
  taskId: string;
  exampleId: string;
  attemptId: string;
  transcript: string;
  criterionIds: string[];
};

export class LocalEvaluationValidationError extends Error {}

export const validateAndDeriveLocalEvaluation = (
  input: unknown,
  identity: LocalEvaluationIdentity,
): EvaluationResult => {
  const parsed = evaluationResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new LocalEvaluationValidationError(
      "The local evaluation does not match the required schema.",
    );
  }
  const evaluation = parsed.data;
  if (
    evaluation.task_id !== identity.taskId ||
    evaluation.example_id !== identity.exampleId ||
    evaluation.attempt_id !== identity.attemptId
  ) {
    throw new LocalEvaluationValidationError(
      "The local evaluation identity does not match this attempt.",
    );
  }
  if (evaluation.transcript.text.trim() !== identity.transcript.trim()) {
    throw new LocalEvaluationValidationError(
      "The local evaluation transcript does not match this attempt.",
    );
  }

  const expected = new Set(identity.criterionIds);
  const received = evaluation.criterion_scores.map(
    (score) => score.criterion_id,
  );
  if (
    received.length !== expected.size ||
    new Set(received).size !== received.length ||
    received.some((criterionId) => !expected.has(criterionId))
  ) {
    throw new LocalEvaluationValidationError(
      "The local evaluation must score every task criterion exactly once.",
    );
  }

  const score =
    evaluation.criterion_scores.length === 0
      ? 0
      : evaluation.criterion_scores.reduce(
          (total, criterion) => total + criterion.score,
          0,
        ) / evaluation.criterion_scores.length;
  const derivedScore = Math.round(score * 100) / 100;
  return {
    ...evaluation,
    transcript: { ...evaluation.transcript, text: identity.transcript },
    overall: {
      ...evaluation.overall,
      score: derivedScore,
      pass: derivedScore >= 2.4,
    },
  };
};
