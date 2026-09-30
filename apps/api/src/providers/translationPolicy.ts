import type { DeliberatePracticeTaskV2 } from "@deliberate/shared";

// Criteria and model responses carry clinical meaning even without ambiguous words.
export const requiresClinicalTranslation = (
  source: DeliberatePracticeTaskV2,
) => {
  if (source.criteria.length || source.interaction_examples?.length)
    return true;
  const text = [
    source.task.title,
    source.task.description,
    source.task.general_objective,
    source.task.skill_domain,
    ...source.task.tags,
    ...source.examples.map((example) => example.patient_text),
  ].join("\n");
  return /therap|clinica|clinical|suicid|self[- ]harm|trauma|abus|medicat|diagnos|reparent|boundary|boundaries|limites? thérapeut|maltrait|automutil|traitement|patient|schema|schéma|psych|consent|confidential|crisis|crise/i.test(
    text,
  );
};

export const assertTranslationStructure = (
  source: DeliberatePracticeTaskV2,
  translated: DeliberatePracticeTaskV2,
  language: string,
) => {
  const identity = (task: DeliberatePracticeTaskV2) => ({
    difficulty: task.task.base_difficulty,
    tags: task.task.tags.length,
    criteria: task.criteria.map((criterion) => ({
      id: criterion.id,
      rubric: criterion.rubric
        ? {
            min: criterion.rubric.score_min,
            max: criterion.rubric.score_max,
            anchors: criterion.rubric.anchors.map((anchor) => anchor.score),
          }
        : null,
    })),
    examples: task.examples.map((example) => ({
      id: example.id,
      difficulty: example.difficulty,
    })),
    interactions: (task.interaction_examples ?? []).map((example) => ({
      id: example.id,
      difficulty: example.difficulty,
    })),
  });
  if (
    JSON.stringify(identity(source)) !== JSON.stringify(identity(translated)) ||
    translated.task.language !== language ||
    translated.examples.some((example) => example.language !== language)
  ) {
    throw new Error(
      "Translation changed task structure. Review the source before retrying.",
    );
  }
};
