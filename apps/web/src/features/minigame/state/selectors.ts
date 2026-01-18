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
const selectPlayerOrder = createSelector(selectActivePlayers, (players) => {
  const order = new Map<string, number>();
  players.forEach((player, index) => {
    order.set(player.id, index);
  });
  return order;
});

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

export const selectRoundsPerPlayerTarget = createSelector(selectActiveSession, (session) => {
  if (!session) return null;
  const settings = (session.settings ?? {}) as { rounds_per_player?: unknown };
  const raw = settings.rounds_per_player;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : null;
  if (value == null || Number.isNaN(value) || value <= 0) {
    return null;
  }
  return value;
});

export const selectFfaRoundCandidates = createSelector(
  [selectMinigameSnapshot, selectMinigameDerivedState, selectRoundsPerPlayerTarget, selectPlayerOrder],
  (snapshot, derived, roundsPerPlayerTarget, playerOrder) => {
    if (snapshot.session?.game_type !== "ffa") return [];
    const pendingRounds = snapshot.rounds
      .filter((round) => round.status !== "completed")
      .sort((a, b) => a.position - b.position);
    if (!pendingRounds.length) return [];
    const players = snapshot.players;
    if (!players.length) return [];
    const completedCounts = new Map<string, number>();
    players.forEach((player) => {
      const count = derived.completedRoundIdsByPlayer[player.id]?.size ?? 0;
      completedCounts.set(player.id, count);
    });
    const pendingByPlayer = new Map<string, boolean>();
    pendingRounds.forEach((round) => {
      pendingByPlayer.set(round.player_a_id, true);
    });
    const eligiblePlayers = players.filter((player) => {
      if (!pendingByPlayer.get(player.id)) return false;
      const completed = completedCounts.get(player.id) ?? 0;
      if (roundsPerPlayerTarget != null && completed >= roundsPerPlayerTarget) {
        return false;
      }
      return true;
    });
    if (!eligiblePlayers.length) return [];
    const minCompleted = Math.min(...eligiblePlayers.map((player) => completedCounts.get(player.id) ?? 0));
    const candidatePlayerIds = new Set(
      eligiblePlayers
        .filter((player) => (completedCounts.get(player.id) ?? 0) === minCompleted)
        .map((player) => player.id)
    );
    const candidates = pendingRounds
      .filter((round) => candidatePlayerIds.has(round.player_a_id))
      .sort((a, b) => {
        const countA = completedCounts.get(a.player_a_id) ?? 0;
        const countB = completedCounts.get(b.player_a_id) ?? 0;
        if (countA !== countB) {
          return countA - countB;
        }
        const orderA = playerOrder.get(a.player_a_id) ?? 0;
        const orderB = playerOrder.get(b.player_a_id) ?? 0;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.position - b.position;
      });
    const uniqueCandidates: typeof candidates = [];
    const seenPlayers = new Set<string>();
    candidates.forEach((round) => {
      if (seenPlayers.has(round.player_a_id)) return;
      seenPlayers.add(round.player_a_id);
      uniqueCandidates.push(round);
    });
    return uniqueCandidates.map((round) => round.id);
  }
);

export const selectNextFfaRoundId = createSelector(
  selectFfaRoundCandidates,
  (candidates) => candidates[0]
);
