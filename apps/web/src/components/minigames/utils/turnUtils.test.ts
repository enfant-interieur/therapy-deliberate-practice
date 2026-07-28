import { describe, expect, it } from "vitest";
import {
  deriveActivePlayerId,
  getNextRoundForPlayer,
  getUpNextPlayerId,
} from "./turnUtils";
import type { MinigameRound } from "../../../store/api";

const buildRound = (overrides: Partial<MinigameRound>): MinigameRound => ({
  id: overrides.id ?? "round-1",
  session_id: overrides.session_id ?? "session-1",
  position: overrides.position ?? 0,
  task_id: overrides.task_id ?? "task-1",
  example_id: overrides.example_id ?? "example-1",
  player_a_id: overrides.player_a_id ?? "player-a",
  player_b_id: overrides.player_b_id ?? null,
  team_a_id: overrides.team_a_id ?? null,
  team_b_id: overrides.team_b_id ?? null,
  status: overrides.status ?? "pending",
  started_at: overrides.started_at ?? null,
  completed_at: overrides.completed_at ?? null,
  patient_text: overrides.patient_text ?? null,
});

describe("turnUtils", () => {
  it("derives active player from round for FFA", () => {
    const round = buildRound({ player_a_id: "player-1" });
    expect(
      deriveActivePlayerId({
        mode: "ffa",
        currentRound: round,
        tdmActivePlayerId: "tdm",
      }),
    ).toBe("player-1");
  });

  it("derives active player from controller for TDM", () => {
    const round = buildRound({ player_a_id: "player-1" });
    expect(
      deriveActivePlayerId({
        mode: "tdm",
        currentRound: round,
        tdmActivePlayerId: "player-2",
      }),
    ).toBe("player-2");
  });

  it("finds up next player based on round order", () => {
    const rounds = [
      buildRound({
        id: "round-1",
        position: 2,
        player_a_id: "player-2",
        status: "pending",
      }),
      buildRound({
        id: "round-0",
        position: 0,
        player_a_id: "player-1",
        status: "pending",
      }),
      buildRound({
        id: "round-2",
        position: 1,
        player_a_id: "player-3",
        status: "completed",
      }),
    ];
    expect(getUpNextPlayerId(rounds)).toBe("player-1");
  });

  it("skips duplicate examples and completed rounds when selecting next round", () => {
    const rounds = [
      buildRound({
        id: "round-1",
        position: 0,
        player_a_id: "player-1",
        example_id: "example-1",
      }),
      buildRound({
        id: "round-2",
        position: 1,
        player_a_id: "player-1",
        example_id: "example-2",
      }),
    ];
    const playedExampleIds = new Set(["task-1:example-1"]);
    const completedRoundIds = new Set(["round-1"]);
    const nextRound = getNextRoundForPlayer({
      rounds,
      playerId: "player-1",
      playedExampleIds,
      completedRoundIds,
    });
    expect(nextRound?.id).toBe("round-2");
  });
});
