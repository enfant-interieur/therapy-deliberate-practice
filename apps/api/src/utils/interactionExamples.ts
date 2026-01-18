import type { TaskInteractionExample } from "@deliberate/shared";

type WarnLogger = {
  warn: (message: string, fields?: Record<string, unknown>) => void;
};

export const sanitizeInteractionExamples = (
  items: TaskInteractionExample[] | undefined,
  log?: WarnLogger
) => {
  if (!items?.length) return [];
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      const difficultyOk =
        Number.isInteger(item.difficulty) && item.difficulty >= 1 && item.difficulty <= 5;
      const patientText = item.patient_text?.trim();
      const therapistText = item.therapist_text?.trim();
      if (!difficultyOk || !patientText || !therapistText) {
        log?.warn("interaction_example.invalid", {
          index,
          difficultyOk,
          patientTextOk: Boolean(patientText),
          therapistTextOk: Boolean(therapistText)
        });
        return false;
      }
      return true;
    })
    .map(({ item }) => ({
      ...item,
      patient_text: item.patient_text.trim(),
      therapist_text: item.therapist_text.trim(),
      title: item.title ?? null
    }));
};
