import type { EvaluationResult } from "@deliberate/shared";

export type TurnSubmitResult = {
  transcript?: string;
  evaluation?: EvaluationResult;
  score?: number;
  attemptId?: string;
  timingPenalty?: number;
};

export function normalizeSubmitResponse(resp: unknown): TurnSubmitResult {
  const response = resp as {
    transcript?: { text?: string } | string;
    transcript_text?: string;
    scoring?: { evaluation?: EvaluationResult };
    evaluation?: EvaluationResult;
    attemptId?: string;
    attempt_id?: string;
    attempt?: { id?: string };
    id?: string;
    timing_penalty?: number;
    timingPenalty?: number;
    adjusted_score?: number;
    score?: number;
  };

  const transcript =
    (typeof response?.transcript === "string"
      ? response.transcript
      : response?.transcript?.text) ??
    response?.transcript_text ??
    undefined;

  const evaluation =
    response?.scoring?.evaluation ?? response?.evaluation ?? undefined;

  const attemptId =
    response?.attemptId ??
    response?.attempt_id ??
    response?.attempt?.id ??
    response?.id ??
    undefined;

  const timingPenalty =
    response?.timing_penalty ?? response?.timingPenalty ?? undefined;

  const scoreFromEval =
    typeof evaluation?.overall?.score === "number"
      ? evaluation.overall.score
      : undefined;

  const score =
    typeof response?.adjusted_score === "number"
      ? response.adjusted_score
      : typeof response?.score === "number"
        ? response.score
        : scoreFromEval;

  return { transcript, evaluation, score, attemptId, timingPenalty };
}

export function applyTimingPenalty({
  score,
  timingPenalty,
}: {
  score?: number;
  timingPenalty?: number;
}): number | undefined {
  if (typeof score !== "number") return undefined;
  const penalty = typeof timingPenalty === "number" ? timingPenalty : 0;
  return Math.max(0, score - penalty);
}

export function createTimeoutEvaluation({
  taskId,
  exampleId,
  attemptId,
  copy,
}: {
  taskId: string;
  exampleId: string;
  attemptId: string;
  copy: {
    transcript: string;
    summaryFeedback: string;
    improveNext: string;
    patientReaction: string;
  };
}): EvaluationResult {
  return {
    version: "2.0",
    task_id: taskId,
    example_id: exampleId,
    attempt_id: attemptId,
    transcript: {
      text: copy.transcript,
    },
    criterion_scores: [],
    overall: {
      score: 0,
      pass: false,
      summary_feedback: copy.summaryFeedback,
      what_to_improve_next: [copy.improveNext],
    },
    patient_reaction: {
      emotion: "sad",
      intensity: 2,
      response_text: copy.patientReaction,
    },
  };
}
