// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { MinigamePlayer, MinigameRound, MinigameSession, MinigameTeam } from "../../../store/api";
import type { MinigameSliceState, RegisterRoundResultPayload } from "./types";
import {
  addRoundResult,
  initialState,
  minigamesReducer,
  setMinigameState
} from "./slice";
import {
  selectMinigameDerivedState,
  selectMinigameSnapshot,
  selectPendingRoundIds
} from "./selectors";
import type { RootState } from "../../../store";

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

const withSlice = (slice: MinigameSliceState) =>
  ({ minigames: slice } as unknown as RootState);

const hydrate = () =>
  minigamesReducer(
    initialState,
    setMinigameState({
      session: createSession(),
      teams: createTeams(),
      players: createPlayers(),
      rounds: createRounds(),
      results: []
    })
  );

const submitResult = (
  slice: MinigameSliceState,
  payload: Partial<RegisterRoundResultPayload> & Pick<RegisterRoundResultPayload, "playerId">
) =>
  minigamesReducer(
    slice,
    addRoundResult({
      roundId: payload.roundId ?? "round-tdm",
      playerId: payload.playerId,
      attemptId: payload.attemptId ?? `attempt-${payload.playerId}`,
      overallScore: payload.overallScore ?? 3.5,
      overallPass: payload.overallPass ?? true,
      transcript: payload.transcript,
      evaluation: payload.evaluation,
      clientPenalty: payload.clientPenalty
    })
  );

describe("minigame slice", () => {
  it("hydrates entities and sets the next active round", () => {
    const hydrated = hydrate();
    expect(hydrated.session.activeId).toBe("session-1");
    expect(hydrated.players.ids).toHaveLength(2);
    expect(hydrated.rounds.ids).toHaveLength(2);
    expect(hydrated.view.currentRoundId).toBe("round-tdm");

    const snapshot = selectMinigameSnapshot(withSlice(hydrated));
    expect(snapshot.currentRound?.id).toBe("round-tdm");
    expect(snapshot.players.map((player) => player.id)).toContain("player-a");
  });

  it("marks a TDM round complete after both players submit", () => {
    let state = hydrate();
    state = submitResult(state, { playerId: "player-a" });
    expect(state.rounds.entities["round-tdm"]?.status).toBe("pending");
    state = submitResult(state, { playerId: "player-b" });
    expect(state.rounds.entities["round-tdm"]?.status).toBe("completed");
  });

  it("exposes derived selectors for player and round lookups", () => {
    let hydrated = hydrate();
    hydrated = submitResult(hydrated, { playerId: "player-a" });
    hydrated = submitResult(hydrated, { playerId: "player-b" });
    const root = withSlice(hydrated);
    const derived = selectMinigameDerivedState(root);
    expect(derived.playerMap["player-a"].name).toBe("Ada");
    expect(derived.resultsByRound["round-tdm"]).toHaveLength(2);
    expect(derived.completedRoundIdsByPlayer["player-a"]?.has("round-tdm")).toBe(true);

    const queue = selectPendingRoundIds(root);
    expect(queue).toEqual(["round-ffa"]);
  });
});
