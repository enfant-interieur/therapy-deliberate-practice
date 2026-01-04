import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { EvaluationResult } from "@deliberate/shared";
import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
  MinigameSession,
  MinigameTeam
} from "./api";

type MinigameState = {
  session?: MinigameSession;
  teams: MinigameTeam[];
  players: MinigamePlayer[];
  rounds: MinigameRound[];
  results: MinigameRoundResult[];
  currentRoundId?: string;
  ui: {
    transcriptHidden: boolean;
    evaluationDrawerOpen: boolean;
    endGameOpen: boolean;
    appShellHidden: boolean;
  };
};

const initialState: MinigameState = {
  teams: [],
  players: [],
  rounds: [],
  results: [],
  ui: {
    transcriptHidden: false,
    evaluationDrawerOpen: false,
    endGameOpen: false,
    appShellHidden: false
  }
};

const minigamesSlice = createSlice({
  name: "minigames",
  initialState,
  reducers: {
    resetMinigame(state) {
      state.session = undefined;
      state.teams = [];
      state.players = [];
      state.rounds = [];
      state.results = [];
      state.currentRoundId = undefined;
      state.ui.transcriptHidden = false;
      state.ui.evaluationDrawerOpen = false;
      state.ui.endGameOpen = false;
      state.ui.appShellHidden = false;
    },
    setMinigameState(
      state,
      action: PayloadAction<{
        session: MinigameSession;
        teams: MinigameTeam[];
        players: MinigamePlayer[];
        rounds: MinigameRound[];
        results: MinigameRoundResult[];
      }>
    ) {
      state.session = action.payload.session;
      state.teams = action.payload.teams;
      state.players = action.payload.players;
      state.rounds = action.payload.rounds;
      state.results = action.payload.results;
      state.currentRoundId = action.payload.rounds.find((round) => round.status !== "completed")?.id;
    },
    setCurrentRoundId(state, action: PayloadAction<string | undefined>) {
      state.currentRoundId = action.payload;
    },
    addRoundResult(
      state,
      action: PayloadAction<{
        roundId: string;
        playerId: string;
        attemptId: string;
        overallScore: number;
        overallPass: boolean;
        transcript?: string;
        evaluation?: EvaluationResult;
        clientPenalty?: number;
      }>
    ) {
      state.results.push({
        id: `${action.payload.roundId}-${action.payload.playerId}-${action.payload.attemptId}`,
        round_id: action.payload.roundId,
        player_id: action.payload.playerId,
        attempt_id: action.payload.attemptId,
        overall_score: action.payload.overallScore,
        overall_pass: action.payload.overallPass,
        created_at: Date.now(),
        transcript: action.payload.transcript,
        evaluation: action.payload.evaluation,
        client_penalty: action.payload.clientPenalty
      });
      const round = state.rounds.find((entry) => entry.id === action.payload.roundId);
      if (round) {
        if (!round.player_b_id) {
          round.status = "completed";
          round.completed_at = Date.now();
        } else {
          const hasPlayerA = state.results.some(
            (result) => result.round_id === round.id && result.player_id === round.player_a_id
          );
          const hasPlayerB = state.results.some(
            (result) => result.round_id === round.id && result.player_id === round.player_b_id
          );
          if (hasPlayerA && hasPlayerB) {
            round.status = "completed";
            round.completed_at = Date.now();
          }
        }
      }
      state.currentRoundId = state.rounds.find((entry) => entry.status !== "completed")?.id;
    },
    toggleTranscriptHidden(state) {
      state.ui.transcriptHidden = !state.ui.transcriptHidden;
    },
    setEvaluationDrawerOpen(state, action: PayloadAction<boolean>) {
      state.ui.evaluationDrawerOpen = action.payload;
    },
    setEndGameOpen(state, action: PayloadAction<boolean>) {
      state.ui.endGameOpen = action.payload;
    },
    setAppShellHidden(state, action: PayloadAction<boolean>) {
      state.ui.appShellHidden = action.payload;
    }
  }
});

export const {
  resetMinigame,
  setMinigameState,
  setCurrentRoundId,
  addRoundResult,
  toggleTranscriptHidden,
  setEvaluationDrawerOpen,
  setEndGameOpen,
  setAppShellHidden
} = minigamesSlice.actions;
export const minigamesReducer = minigamesSlice.reducer;
