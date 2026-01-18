export {
  minigamesReducer,
  resetMinigame,
  setMinigameState,
  setCurrentRoundId,
  setCurrentPlayerId,
  addRoundResult,
  toggleTranscriptHidden,
  setEvaluationDrawerOpen,
  setEndGameOpen,
  setAppShellHidden
} from "../features/minigame/state/slice";

export type {
  MinigameSliceState,
  MinigameSnapshot,
  MinigameDerivedState,
  MinigameIntegrityAction
} from "../features/minigame/state/types";
export { createMinigameStateManager } from "../features/minigame/state/manager";
export { useMinigameState } from "../features/minigame/state/hooks";
export * from "../features/minigame/state/selectors";
