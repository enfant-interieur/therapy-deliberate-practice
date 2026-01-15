import type { Task, TaskExample } from "@deliberate/shared";
import type { MinigameRound } from "../../../store/api";

export const buildExampleForRound = (
  round: MinigameRound,
  task?: Task | null
): TaskExample => {
  const matched = task?.examples?.find((example) => example.id === round.example_id);
  if (matched) {
    return {
      ...matched,
      task_id: matched.task_id ?? round.task_id
    };
  }
  return {
    id: round.example_id,
    task_id: round.task_id,
    difficulty: task?.base_difficulty ?? 1,
    severity_label: null,
    patient_text: round.patient_text ?? "Patient statement unavailable.",
    meta: null
  };
};
