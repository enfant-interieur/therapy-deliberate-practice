import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
  MinigameSession,
  MinigameTeam
} from "../../../store/api";
import type { EntityState } from "@reduxjs/toolkit";

export type MinigameSessionState = {
  activeId?: string;
  entities: Record<string, MinigameSession>;
};

export type MinigameUiState = {
  transcriptHidden: boolean;
  evaluationDrawerOpen: boolean;
  endGameOpen: boolean;
  appShellHidden: boolean;
};

export type MinigameViewState = {
  currentRoundId?: string;
  currentPlayerId?: string;
  ui: MinigameUiState;
};

export type MinigameSliceState = {
  session: MinigameSessionState;
  teams: EntityState<MinigameTeam>;
  players: EntityState<MinigamePlayer>;
  rounds: EntityState<MinigameRound>;
  results: EntityState<MinigameRoundResult>;
  view: MinigameViewState;
};

export type MinigameSnapshot = {
  session?: MinigameSession;
  teams: MinigameTeam[];
  players: MinigamePlayer[];
  rounds: MinigameRound[];
  results: MinigameRoundResult[];
  currentRoundId?: string;
  currentPlayerId?: string;
  currentRound?: MinigameRound;
  ui: MinigameUiState;
};

export type MinigameDerivedState = {
  playerMap: Record<string, MinigamePlayer>;
  teamMap: Record<string, MinigameTeam>;
  roundMap: Record<string, MinigameRound>;
  resultsByRound: Record<string, MinigameRoundResult[]>;
  completedRoundIdsByPlayer: Record<string, ReadonlySet<string>>;
  playedExampleKeysByPlayer: Record<string, ReadonlySet<string>>;
  pendingRoundIds: string[];
};

export type HydratedSessionPayload = {
  session: MinigameSession;
  teams: MinigameTeam[];
  players: MinigamePlayer[];
  rounds: MinigameRound[];
  results: MinigameRoundResult[];
};

export type RegisterRoundResultPayload = {
  roundId: string;
  playerId: string;
  attemptId: string;
  overallScore: number;
  overallPass: boolean;
  transcript?: string;
  evaluation?: MinigameRoundResult["evaluation"];
  clientPenalty?: number;
};

export type MinigameIntegrityAction =
  | {
      type: "assign_round";
      reason: "missing_active_round";
      roundId: string;
    }
  | {
      type: "advance_round";
      reason: "active_round_completed";
      fromRoundId: string;
      toRoundId: string;
    }
  | {
      type: "sync_player";
      reason: "align_active_player";
      roundId?: string;
      playerId?: string | null;
    }
  | {
      type: "complete_session";
      reason: "no_rounds_remaining";
      pendingRounds: number;
    };
