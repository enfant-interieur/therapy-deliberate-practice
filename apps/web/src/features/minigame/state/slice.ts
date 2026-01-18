import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { EvaluationResult } from "@deliberate/shared";
import type { MinigameSliceState, HydratedSessionPayload, RegisterRoundResultPayload } from "./types";
import { playersAdapter, resultsAdapter, roundsAdapter, teamsAdapter } from "./adapters";

const createInitialUiState = () => ({
  transcriptHidden: false,
  evaluationDrawerOpen: false,
  endGameOpen: false,
  appShellHidden: false
});

export const initialState: MinigameSliceState = {
  session: {
    entities: {},
    activeId: undefined
  },
  teams: teamsAdapter.getInitialState(),
  players: playersAdapter.getInitialState(),
  rounds: roundsAdapter.getInitialState(),
  results: resultsAdapter.getInitialState(),
  view: {
    currentRoundId: undefined,
    currentPlayerId: undefined,
    ui: createInitialUiState()
  }
};

const updateRoundStatus = (
  state: MinigameSliceState,
  roundId: string,
  playerA?: string | null,
  playerB?: string | null
) => {
  const round = state.rounds.entities[roundId];
  if (!round) return;
  if (!playerB) {
    round.status = "completed";
    round.completed_at = Date.now();
    return;
  }
  const hasPlayerA = state.results.ids.some((id) => {
    const result = state.results.entities[id];
    return result?.round_id === roundId && result.player_id === playerA;
  });
  const hasPlayerB = state.results.ids.some((id) => {
    const result = state.results.entities[id];
    return result?.round_id === roundId && result.player_id === playerB;
  });
  if (hasPlayerA && hasPlayerB) {
    round.status = "completed";
    round.completed_at = Date.now();
  }
};

const minigamesSlice = createSlice({
  name: "minigames",
  initialState,
  reducers: {
    resetMinigame(state) {
      state.session = { entities: {}, activeId: undefined };
      teamsAdapter.removeAll(state.teams);
      playersAdapter.removeAll(state.players);
      roundsAdapter.removeAll(state.rounds);
      resultsAdapter.removeAll(state.results);
      state.view.currentRoundId = undefined;
      state.view.currentPlayerId = undefined;
      state.view.ui = createInitialUiState();
    },
    setMinigameState(state, action: PayloadAction<HydratedSessionPayload>) {
      const { session, teams, players, rounds, results } = action.payload;
      state.session.activeId = session.id;
      state.session.entities[session.id] = session;
      teamsAdapter.removeAll(state.teams);
      teamsAdapter.addMany(state.teams, teams);
      playersAdapter.removeAll(state.players);
      playersAdapter.addMany(state.players, players);
      roundsAdapter.removeAll(state.rounds);
      roundsAdapter.addMany(state.rounds, rounds);
      resultsAdapter.removeAll(state.results);
      resultsAdapter.addMany(state.results, results);
      state.view.currentRoundId =
        session.current_round_id ??
        rounds.find((round) => round.status !== "completed")?.id ??
        state.view.currentRoundId;
      state.view.currentPlayerId = session.current_player_id ?? undefined;
    },
    setCurrentRoundId(state, action: PayloadAction<string | undefined>) {
      state.view.currentRoundId = action.payload;
    },
    setCurrentPlayerId(state, action: PayloadAction<string | undefined>) {
      state.view.currentPlayerId = action.payload;
    },
    addRoundResult(state, action: PayloadAction<RegisterRoundResultPayload>) {
      const payload = action.payload;
      const id = `${payload.roundId}-${payload.playerId}-${payload.attemptId}`;
      resultsAdapter.upsertOne(state.results, {
        id,
        round_id: payload.roundId,
        player_id: payload.playerId,
        attempt_id: payload.attemptId,
        overall_score: payload.overallScore,
        overall_pass: payload.overallPass,
        created_at: Date.now(),
        transcript: payload.transcript,
        evaluation: payload.evaluation as EvaluationResult | undefined,
        client_penalty: payload.clientPenalty
      });
      updateRoundStatus(
        state,
        payload.roundId,
        state.rounds.entities[payload.roundId]?.player_a_id,
        state.rounds.entities[payload.roundId]?.player_b_id
      );
    },
    toggleTranscriptHidden(state) {
      state.view.ui.transcriptHidden = !state.view.ui.transcriptHidden;
    },
    setEvaluationDrawerOpen(state, action: PayloadAction<boolean>) {
      state.view.ui.evaluationDrawerOpen = action.payload;
    },
    setEndGameOpen(state, action: PayloadAction<boolean>) {
      state.view.ui.endGameOpen = action.payload;
    },
    setAppShellHidden(state, action: PayloadAction<boolean>) {
      state.view.ui.appShellHidden = action.payload;
    }
  }
});

export const {
  resetMinigame,
  setMinigameState,
  setCurrentRoundId,
  setCurrentPlayerId,
  addRoundResult,
  toggleTranscriptHidden,
  setEvaluationDrawerOpen,
  setEndGameOpen,
  setAppShellHidden
} = minigamesSlice.actions;

export const minigamesReducer = minigamesSlice.reducer;
