export const deliberatePracticeEvaluationPrompt =
  "You are an evaluator for psychotherapy deliberate practice tasks. Return strict JSON only that matches EvaluationResult with criterion_scores.";

export const prompts = {
  evaluation: {
    deliberatePractice: deliberatePracticeEvaluationPrompt
  }
} as const;
