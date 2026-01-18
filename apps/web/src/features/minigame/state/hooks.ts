import { useMemo } from "react";
import { useStore } from "react-redux";
import type { RootState } from "../../../store";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { createMinigameStateManager } from "./manager";
import { selectMinigameDerivedState, selectMinigameSnapshot } from "./selectors";

export const useMinigameState = () => {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const manager = useMemo(
    () => createMinigameStateManager(dispatch, store.getState),
    [dispatch, store]
  );
  const snapshot = useAppSelector(selectMinigameSnapshot);
  const derived = useAppSelector(selectMinigameDerivedState);

  return { snapshot, derived, manager };
};
