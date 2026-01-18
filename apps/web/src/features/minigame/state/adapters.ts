import { createEntityAdapter } from "@reduxjs/toolkit";
import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
  MinigameTeam
} from "../../../store/api";

export const teamsAdapter = createEntityAdapter<MinigameTeam>({
  selectId: (team) => team.id
});

export const playersAdapter = createEntityAdapter<MinigamePlayer>({
  selectId: (player) => player.id
});

export const roundsAdapter = createEntityAdapter<MinigameRound>({
  selectId: (round) => round.id,
  sortComparer: (a, b) => a.position - b.position
});

export const resultsAdapter = createEntityAdapter<MinigameRoundResult>({
  selectId: (result) => result.id ?? `${result.round_id}:${result.player_id}:${result.attempt_id}`,
  sortComparer: (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0)
});
