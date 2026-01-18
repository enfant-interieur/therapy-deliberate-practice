// @vitest-environment node
import { configureStore } from "@reduxjs/toolkit";
import { describe, expect, it } from "vitest";
import { minigamesReducer, setMinigameState, setCurrentPlayerId, setCurrentRoundId, addRoundResult } from "./slice";
import { createMinigameStateManager } from "./manager";
import type { MinigamePlayer, MinigameRound, MinigameSession, MinigameTeam } from "../../../store/api";

const createSession = (): MinigameSession => ({
  id: "session-1",
  user_id: "user-1",
  game_type: "tdm",
  visibility_mode: "normal",
  task_selection: {},
  settings: {},
  created_at: Date.now(),
  ended_at: null,
  last_active_at: null,
  current_round_id: null,
  current_player_id: null
});

const createTeams = (): MinigameTeam[] => [
  { id: "team-a", session_id: "session-1", name: "Alpha", color: "#fff", created_at: Date.now() },
  { id: "team-b", session_id: "session-1", name: "Beta", color: "#000", created_at: Date.now() }
];

const createPlayers = (): MinigamePlayer[] => [
  {
    id: "player-a",
    session_id: "session-1",
    name: "Ada",
    avatar: "A",
    team_id: "team-a",
    created_at: Date.now()
  },
  {
    id: "player-b",
    session_id: "session-1",
    name: "Ben",
    avatar: "B",
    team_id: "team-b",
    created_at: Date.now()
  }
];

const createRounds = (): MinigameRound[] => [
  {
    id: "round-tdm",
    session_id: "session-1",
    position: 1,
    task_id: "task-1",
    example_id: "example-1",
    player_a_id: "player-a",
    player_b_id: "player-b",
    team_a_id: "team-a",
    team_b_id: "team-b",
    status: "pending",
    started_at: null,
    completed_at: null,
    patient_text: "Test"
  },
  {
    id: "round-ffa",
    session_id: "session-1",
    position: 2,
    task_id: "task-2",
    example_id: "example-2",
    player_a_id: "player-a",
    player_b_id: null,
    team_a_id: "team-a",
    team_b_id: null,
    status: "pending",
    started_at: null,
    completed_at: null,
    patient_text: "Test 2"
  }
];

const createStore = () =>
  configureStore({
    reducer: {
      minigames: minigamesReducer
    }
  });

describe("minigame manager integrity guards", () => {
  it("assigns the next pending round when none is active", () => {
    const store = createStore();
    store.dispatch(
      setMinigameState({
        session: createSession(),
        teams: createTeams(),
        players: createPlayers(),
        rounds: createRounds(),
        results: []
      })
    );
    store.dispatch(setCurrentRoundId(undefined));
    const manager = createMinigameStateManager(store.dispatch, store.getState);
    const actions = manager.verifyIntegrity();
    expect(actions).toEqual([
      { type: "assign_round", reason: "missing_active_round", roundId: "round-tdm" },
      { type: "sync_player", reason: "align_active_player", roundId: "round-tdm", playerId: "player-a" }
    ]);
    expect(store.getState().minigames.view.currentRoundId).toBe("round-tdm");
    expect(store.getState().minigames.view.currentPlayerId).toBe("player-a");
  });

  it("keeps the round frozen when locking is requested", () => {
    const store = createStore();
    store.dispatch(
      setMinigameState({
        session: createSession(),
        teams: createTeams(),
        players: createPlayers(),
        rounds: createRounds(),
        results: []
      })
    );
    store.dispatch(setCurrentRoundId(undefined));
    const manager = createMinigameStateManager(store.dispatch, store.getState);
    const actions = manager.verifyIntegrity({ lockRoundAdvance: true });
    expect(actions).toEqual([]);
    expect(store.getState().minigames.view.currentRoundId).toBeUndefined();
  });

  it("promotes the second TDM player after the first result", () => {
    const store = createStore();
    store.dispatch(
      setMinigameState({
        session: createSession(),
        teams: createTeams(),
        players: createPlayers(),
        rounds: createRounds(),
        results: []
      })
    );
    store.dispatch(
      addRoundResult({
        roundId: "round-tdm",
        playerId: "player-a",
        attemptId: "attempt-a",
        overallScore: 3.5,
        overallPass: true
      })
    );
    store.dispatch(setCurrentPlayerId(undefined));
    const manager = createMinigameStateManager(store.dispatch, store.getState);
    const actions = manager.verifyIntegrity();
    expect(actions).toContainEqual({
      type: "sync_player",
      reason: "align_active_player",
      roundId: "round-tdm",
      playerId: "player-b"
    });
    expect(store.getState().minigames.view.currentPlayerId).toBe("player-b");
    expect(store.getState().minigames.rounds.ids).toHaveLength(2);
  });

  it("emits a completion signal when all rounds are done", () => {
    const store = createStore();
    store.dispatch(
      setMinigameState({
        session: createSession(),
        teams: createTeams(),
        players: createPlayers(),
        rounds: createRounds(),
        results: []
      })
    );
    store.dispatch(
      addRoundResult({
        roundId: "round-tdm",
        playerId: "player-a",
        attemptId: "attempt-a",
        overallScore: 4,
        overallPass: true
      })
    );
    store.dispatch(
      addRoundResult({
        roundId: "round-tdm",
        playerId: "player-b",
        attemptId: "attempt-b",
        overallScore: 3,
        overallPass: true
      })
    );
    store.dispatch(
      addRoundResult({
        roundId: "round-ffa",
        playerId: "player-a",
        attemptId: "attempt-final",
        overallScore: 3.5,
        overallPass: true
      })
    );
    const manager = createMinigameStateManager(store.dispatch, store.getState);
    const actions = manager.verifyIntegrity();
    expect(actions).toContainEqual({
      type: "complete_session",
      reason: "no_rounds_remaining",
      pendingRounds: 0
    });
  });
});
