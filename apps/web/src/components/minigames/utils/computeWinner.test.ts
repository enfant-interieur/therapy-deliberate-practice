import { describe, expect, it } from "vitest";
import { computeWinner } from "./computeWinner";
import type { MinigamePlayer, MinigameRoundResult, MinigameTeam } from "../../../store/api";

const buildResult = (overrides: Partial<MinigameRoundResult>): MinigameRoundResult => ({
  id: overrides.id ?? "result-1",
  round_id: overrides.round_id ?? "round-1",
  player_id: overrides.player_id ?? "player-1",
  attempt_id: overrides.attempt_id ?? "attempt-1",
  overall_score: overrides.overall_score ?? 0,
  overall_pass: overrides.overall_pass ?? true,
  created_at: overrides.created_at ?? 0,
  transcript: overrides.transcript ?? null,
  evaluation: overrides.evaluation ?? null,
  client_penalty: overrides.client_penalty ?? null
});

const buildPlayer = (overrides: Partial<MinigamePlayer>): MinigamePlayer => ({
  id: overrides.id ?? "player-1",
  session_id: overrides.session_id ?? "session-1",
  name: overrides.name ?? "Player 1",
  avatar: overrides.avatar ?? "astro",
  team_id: overrides.team_id ?? null,
  created_at: overrides.created_at ?? 0
});

const buildTeam = (overrides: Partial<MinigameTeam>): MinigameTeam => ({
  id: overrides.id ?? "team-1",
  session_id: overrides.session_id ?? "session-1",
  name: overrides.name ?? "Team 1",
  color: overrides.color ?? "teal",
  created_at: overrides.created_at ?? 0
});

describe("computeWinner", () => {
  it("returns player winner for ffa", () => {
    const players = [buildPlayer({ id: "p1", name: "Ava" }), buildPlayer({ id: "p2", name: "Ben" })];
    const results = [
      buildResult({ id: "r1", player_id: "p1", overall_score: 5 }),
      buildResult({ id: "r2", player_id: "p2", overall_score: 3 })
    ];

    const summary = computeWinner({ mode: "ffa", players, teams: [], results });

    expect(summary.kind).toBe("player");
    expect(summary.label).toBe("Player Ava wins!");
    expect(summary.winnerIds).toEqual(["p1"]);
  });

  it("returns team winner for tdm", () => {
    const teams = [buildTeam({ id: "t1", name: "Alpha" }), buildTeam({ id: "t2", name: "Bravo" })];
    const players = [
      buildPlayer({ id: "p1", name: "Ava", team_id: "t1" }),
      buildPlayer({ id: "p2", name: "Ben", team_id: "t2" })
    ];
    const results = [
      buildResult({ id: "r1", player_id: "p1", overall_score: 5 }),
      buildResult({ id: "r2", player_id: "p2", overall_score: 3 })
    ];

    const summary = computeWinner({ mode: "tdm", players, teams, results });

    expect(summary.kind).toBe("team");
    expect(summary.label).toBe("Team Alpha wins!");
    expect(summary.winnerIds).toEqual(["t1"]);
  });

  it("returns tie when totals and averages match", () => {
    const players = [buildPlayer({ id: "p1", name: "Ava" }), buildPlayer({ id: "p2", name: "Ben" })];
    const results = [
      buildResult({ id: "r1", player_id: "p1", overall_score: 4 }),
      buildResult({ id: "r2", player_id: "p2", overall_score: 4 })
    ];

    const summary = computeWinner({ mode: "ffa", players, teams: [], results });

    expect(summary.kind).toBe("tie");
    expect(summary.label).toBe("Player Ava & Ben tie!");
    expect(summary.winnerIds).toEqual(["p1", "p2"]);
  });

  it("breaks tie using average then rounds", () => {
    const players = [buildPlayer({ id: "p1", name: "Ava" }), buildPlayer({ id: "p2", name: "Ben" })];
    const results = [
      buildResult({ id: "r1", player_id: "p1", overall_score: 6 }),
      buildResult({ id: "r2", player_id: "p1", overall_score: 0 }),
      buildResult({ id: "r3", player_id: "p2", overall_score: 6 })
    ];

    const summary = computeWinner({ mode: "ffa", players, teams: [], results });

    expect(summary.kind).toBe("player");
    expect(summary.label).toBe("Player Ben wins!");
  });
});
