import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "../../../store";
import { playersAdapter, resultsAdapter, roundsAdapter, teamsAdapter } from "./adapters";
import type { MinigameDerivedState, MinigameSliceState, MinigameSnapshot } from "./types";

const selectSlice = (state: RootState): MinigameSliceState => state.minigames;

const selectSessionState = (state: RootState) => selectSlice(state).session;

export const selectActiveSessionId = createSelector(selectSessionState, (session) => session.activeId);

export const selectActiveSession = createSelector(selectSessionState, (session) =>
  session.activeId ? session.entities[session.activeId] : undefined
);

const playersSelectors = playersAdapter.getSelectors((state: RootState) => selectSlice(state).players);
const teamsSelectors = teamsAdapter.getSelectors((state: RootState) => selectSlice(state).teams);
const roundsSelectors = roundsAdapter.getSelectors((state: RootState) => selectSlice(state).rounds);
const resultsSelectors = resultsAdapter.getSelectors((state: RootState) => selectSlice(state).results);

export const selectAllPlayers = playersSelectors.selectAll;
export const selectAllTeams = teamsSelectors.selectAll;
export const selectAllRounds = roundsSelectors.selectAll;
export const selectAllResults = resultsSelectors.selectAll;

export const selectActivePlayers = createSelector(
  selectActiveSessionId,
  selectAllPlayers,
  (sessionId, players) => (sessionId ? players.filter((player) => player.session_id === sessionId) : [])
);

export const selectActiveTeams = createSelector(
  selectActiveSessionId,
  selectAllTeams,
  (sessionId, teams) => (sessionId ? teams.filter((team) => team.session_id === sessionId) : [])
);

export const selectActiveRounds = createSelector(
  selectActiveSessionId,
  selectAllRounds,
  (sessionId, rounds) => (sessionId ? rounds.filter((round) => round.session_id === sessionId) : [])
);

export const selectActiveResults = createSelector(
  selectActiveRounds,
  selectAllResults,
  (rounds, results) => {
    if (!rounds.length) return [];
    const roundIds = new Set(rounds.map((round) => round.id));
    return results.filter((result) => roundIds.has(result.round_id));
  }
);

const indexById = <T extends { id: string }>(collection: T[]) =>
  collection.reduce<Record<string, T>>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});

const selectPlayerMap = createSelector(selectActivePlayers, (players) => indexById(players));
const selectTeamMap = createSelector(selectActiveTeams, (teams) => indexById(teams));
const selectRoundMap = createSelector(selectActiveRounds, (rounds) => indexById(rounds));

export const selectCurrentRoundId = (state: RootState) => selectSlice(state).view.currentRoundId;
export const selectCurrentPlayerId = (state: RootState) => selectSlice(state).view.currentPlayerId;

export const selectCurrentRound = createSelector(
  selectCurrentRoundId,
  selectActiveRounds,
  (roundId, rounds) => rounds.find((round) => round.id === roundId)
);

export const selectMinigameUiState = (state: RootState) => selectSlice(state).view.ui;

export const selectIsTranscriptHidden = createSelector(
  selectMinigameUiState,
  (ui) => ui.transcriptHidden
);
export const selectIsEvaluationDrawerOpen = createSelector(
  selectMinigameUiState,
  (ui) => ui.evaluationDrawerOpen
);
export const selectIsEndGameOpen = createSelector(selectMinigameUiState, (ui) => ui.endGameOpen);
export const selectIsAppShellHidden = createSelector(selectMinigameUiState, (ui) => ui.appShellHidden);

const selectResultsByRound = createSelector(selectActiveResults, (results) =>
  results.reduce<Record<string, typeof results>>((acc, result) => {
    const bucket = acc[result.round_id] ?? [];
    bucket.push(result);
    acc[result.round_id] = bucket;
    return acc;
  }, {})
);

const selectCompletedRoundIdsByPlayer = createSelector(selectActiveResults, (results) =>
  results.reduce<Record<string, Set<string>>>((acc, result) => {
    if (!acc[result.player_id]) {
      acc[result.player_id] = new Set();
    }
    acc[result.player_id].add(result.round_id);
    return acc;
  }, {})
);

const selectPlayedExampleKeysByPlayer = createSelector(
  selectActiveResults,
  selectRoundMap,
  (results, roundMap) =>
    results.reduce<Record<string, Set<string>>>((acc, result) => {
      const round = roundMap[result.round_id];
      if (!round) return acc;
      const key = `${round.task_id}:${round.example_id}`;
      if (!acc[result.player_id]) {
        acc[result.player_id] = new Set();
      }
      acc[result.player_id].add(key);
      return acc;
    }, {})
);

export const selectPendingRoundIds = createSelector(selectActiveRounds, (rounds) =>
  rounds.filter((round) => round.status !== "completed").map((round) => round.id)
);

export const selectMinigameSnapshot = createSelector(
  [
    selectActiveSession,
    selectActivePlayers,
    selectActiveTeams,
    selectActiveRounds,
    selectActiveResults,
    selectCurrentRound,
    selectCurrentPlayerId,
    selectCurrentRoundId,
    selectMinigameUiState
  ],
  (session, players, teams, rounds, results, currentRound, currentPlayerId, currentRoundId, ui): MinigameSnapshot => ({
    session,
    players,
    teams,
    rounds,
    results,
    currentRound,
    currentPlayerId,
    currentRoundId,
    ui
  })
);

export const selectMinigameDerivedState = createSelector(
  [
    selectPlayerMap,
    selectTeamMap,
    selectRoundMap,
    selectResultsByRound,
    selectCompletedRoundIdsByPlayer,
    selectPlayedExampleKeysByPlayer,
    selectPendingRoundIds
  ],
  (
    playerMap,
    teamMap,
    roundMap,
    resultsByRound,
    completedRoundIdsByPlayer,
    playedExampleKeysByPlayer,
    pendingRoundIds
  ): MinigameDerivedState => ({
    playerMap,
    teamMap,
    roundMap,
    resultsByRound,
    completedRoundIdsByPlayer,
    playedExampleKeysByPlayer,
    pendingRoundIds
  })
);
