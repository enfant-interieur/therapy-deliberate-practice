import type { AppDispatch, RootState } from "../../../store";
import {
  addRoundResult,
  resetMinigame,
  setAppShellHidden,
  setCurrentPlayerId,
  setCurrentRoundId,
  setEndGameOpen,
  setEvaluationDrawerOpen,
  setMinigameState,
  toggleTranscriptHidden
} from "./slice";
import {
  selectFfaRoundCandidates,
  selectMinigameDerivedState,
  selectMinigameSnapshot,
  selectNextFfaRoundId,
  selectPendingRoundIds
} from "./selectors";
import type {
  HydratedSessionPayload,
  MinigameIntegrityAction,
  RegisterRoundResultPayload
} from "./types";

export class MinigameStateManager {
  constructor(private readonly dispatch: AppDispatch, private readonly getState: () => RootState) {}

  hydrate(payload: HydratedSessionPayload) {
    this.dispatch(setMinigameState(payload));
  }

  reset() {
    this.dispatch(resetMinigame());
  }

  setCurrentRound(roundId?: string) {
    const { currentRoundId } = this.snapshot();
    if ((currentRoundId ?? undefined) === (roundId ?? undefined)) return;
    this.dispatch(setCurrentRoundId(roundId));
  }

  setCurrentPlayer(playerId?: string) {
    const { currentPlayerId } = this.snapshot();
    if ((currentPlayerId ?? undefined) === (playerId ?? undefined)) return;
    this.dispatch(setCurrentPlayerId(playerId));
  }

  registerResult(payload: RegisterRoundResultPayload) {
    this.dispatch(addRoundResult(payload));
  }

  toggleTranscript() {
    this.dispatch(toggleTranscriptHidden());
  }

  setEvaluationDrawer(open: boolean) {
    this.dispatch(setEvaluationDrawerOpen(open));
  }

  setEndGameOverlay(open: boolean) {
    this.dispatch(setEndGameOpen(open));
  }

  setAppShellVisibility(hidden: boolean) {
    this.dispatch(setAppShellHidden(hidden));
  }

  snapshot() {
    return selectMinigameSnapshot(this.getState());
  }

  derived() {
    return selectMinigameDerivedState(this.getState());
  }

  pendingRoundIds() {
    return selectPendingRoundIds(this.getState());
  }

  ffaRoundCandidates() {
    return selectFfaRoundCandidates(this.getState());
  }

  verifyIntegrity(options?: { lockRoundAdvance?: boolean }): MinigameIntegrityAction[] {
    const actions: MinigameIntegrityAction[] = [];
    const derived = selectMinigameDerivedState(this.getState());
    let snapshot = this.snapshot();
    const allowRoundAdvance = !options?.lockRoundAdvance;
    const nextPendingRoundId = derived.pendingRoundIds[0];
    const fairFfaRoundId =
      snapshot.session?.game_type === "ffa" ? selectNextFfaRoundId(this.getState()) : undefined;
    const selectActiveRound = () =>
      snapshot.currentRound ??
      (snapshot.currentRoundId ? derived.roundMap[snapshot.currentRoundId] : undefined);

    if (allowRoundAdvance) {
      const activeRound = selectActiveRound();
      const preferredRoundId =
        snapshot.session?.game_type === "ffa"
          ? fairFfaRoundId ?? nextPendingRoundId
          : nextPendingRoundId;
      if (!activeRound && preferredRoundId) {
        this.setCurrentRound(preferredRoundId);
        actions.push({
          type: "assign_round",
          reason: "missing_active_round",
          roundId: preferredRoundId
        });
        snapshot = this.snapshot();
      } else if (
        activeRound &&
        activeRound.status === "completed" &&
        preferredRoundId &&
        preferredRoundId !== activeRound.id
      ) {
        this.setCurrentRound(preferredRoundId);
        actions.push({
          type: "advance_round",
          reason: "active_round_completed",
          fromRoundId: activeRound.id,
          toRoundId: preferredRoundId
        });
        snapshot = this.snapshot();
      }
    }

    const activeRound = selectActiveRound();
    const syncPlayer = (expected?: string | null) => {
      const normalized = expected ?? undefined;
      if ((snapshot.currentPlayerId ?? undefined) === normalized) return;
      this.setCurrentPlayer(normalized);
      actions.push({
        type: "sync_player",
        reason: "align_active_player",
        roundId: activeRound?.id,
        playerId: normalized ?? null
      });
      snapshot = this.snapshot();
    };

    const mode = snapshot.session?.game_type ?? null;
    if (mode === "tdm" && activeRound) {
      const roundResults = derived.resultsByRound[activeRound.id] ?? [];
      const completedPlayers = new Set(roundResults.map((result) => result.player_id));
      if (activeRound.player_a_id && !completedPlayers.has(activeRound.player_a_id)) {
        syncPlayer(activeRound.player_a_id);
      } else if (activeRound.player_b_id && !completedPlayers.has(activeRound.player_b_id)) {
        syncPlayer(activeRound.player_b_id);
      } else if (snapshot.currentPlayerId != null) {
        syncPlayer(undefined);
      }
    } else if (mode === "ffa" && activeRound) {
      syncPlayer(activeRound.player_a_id ?? null);
    } else if (!activeRound && snapshot.currentPlayerId != null) {
      syncPlayer(undefined);
    }

    const shouldCompleteSession =
      Boolean(snapshot.session?.id) &&
      !snapshot.session?.ended_at &&
      snapshot.rounds.length > 0 &&
      derived.pendingRoundIds.length === 0;
    if (shouldCompleteSession) {
      actions.push({
        type: "complete_session",
        reason: "no_rounds_remaining",
        pendingRounds: derived.pendingRoundIds.length
      });
    }

    return actions;
  }
}

export const createMinigameStateManager = (dispatch: AppDispatch, getState: () => RootState) =>
  new MinigameStateManager(dispatch, getState);
