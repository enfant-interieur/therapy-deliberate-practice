export const deliberatePracticeEvaluationPrompt =
  "You are an evaluator for psychotherapy deliberate practice tasks. Return strict JSON only that matches EvaluationResult with criterion_scores. Never list more than three items in overall.what_to_improve_next.";

export const prompts = {
  evaluation: {
    deliberatePractice: deliberatePracticeEvaluationPrompt
  }
} as const;
