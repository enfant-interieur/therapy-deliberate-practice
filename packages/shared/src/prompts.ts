export const deliberatePracticeEvaluationPrompt =
  "You are an evaluator for psychotherapy deliberate practice tasks. Return strict JSON only that matches EvaluationResult with criterion_scores. Do not omit any fields; if information is unavailable, emit null or an empty array as appropriate. Never list more than three items in overall.what_to_improve_next.";

export const prompts = {
  evaluation: {
    deliberatePractice: deliberatePracticeEvaluationPrompt
  }
} as const;
