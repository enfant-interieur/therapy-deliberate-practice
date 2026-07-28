import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  minigamePlayerPromptHistory,
  minigamePlayers,
  minigameRedrawClaims,
  minigameRounds,
  minigameSessions,
  minigameTeams,
  taskExamples,
  tasks,
} from "../src/db/schema";
import {
  generateTdmSchedule,
  generateMinigameRounds,
  InvalidTdmConfigurationError,
  MinigameRedrawConflictError,
  NoUniquePatientStatementsLeftError,
  redrawMinigameRound,
} from "../src/services/minigameRoundsService";

const setupDb = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      skill_domain TEXT NOT NULL,
      base_difficulty INTEGER NOT NULL,
      general_objective TEXT,
      tags TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '[]',
      language TEXT NOT NULL,
      is_published INTEGER NOT NULL,
      parent_task_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE task_examples (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      severity_label TEXT,
      patient_text TEXT NOT NULL,
      language TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE minigame_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      game_type TEXT NOT NULL,
      visibility_mode TEXT NOT NULL,
      task_selection TEXT NOT NULL,
      settings TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ended_at INTEGER,
      last_active_at INTEGER,
      current_round_id TEXT,
      current_player_id TEXT,
      deleted_at INTEGER
    );
    CREATE TABLE minigame_teams (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE minigame_players (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      team_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE minigame_rounds (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      task_id TEXT NOT NULL,
      example_id TEXT NOT NULL,
      player_a_id TEXT NOT NULL,
      player_b_id TEXT,
      team_a_id TEXT,
      team_b_id TEXT,
      status TEXT NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE TABLE minigame_player_prompt_history (
      session_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      patient_statement_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(session_id, player_id, patient_statement_id)
    );
    CREATE TABLE minigame_redraw_claims (
      replaced_round_id TEXT PRIMARY KEY,
      replacement_round_id TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);
  const db = drizzle(sqlite);
  return { db, sqlite };
};

const seedTasks = async (db: ReturnType<typeof setupDb>["db"]) => {
  const now = Date.now();
  await db.insert(tasks).values({
    id: "task-1",
    slug: "task-1",
    title: "Task 1",
    description: "Desc",
    skill_domain: "general",
    base_difficulty: 1,
    general_objective: null,
    tags: JSON.stringify([]),
    language: "en",
    is_published: true,
    parent_task_id: null,
    created_at: now,
    updated_at: now,
  });
};

test("generateMinigameRounds enforces no repeats for FFA and errors on exhaustion", async () => {
  const { db } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(taskExamples).values([
    {
      id: "ex-1",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "A",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "ex-2",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "B",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
  ]);
  await db.insert(minigameSessions).values({
    id: "session-ffa",
    user_id: "user-1",
    game_type: "ffa",
    visibility_mode: "normal",
    task_selection: { strategy: "manual", task_ids: ["task-1"], seed: "seed" },
    settings: {},
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: null,
    current_player_id: null,
    deleted_at: null,
  });
  await db.insert(minigamePlayers).values({
    id: "player-1",
    session_id: "session-ffa",
    name: "Alpha",
    avatar: "a",
    team_id: null,
    created_at: now,
  });
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-ffa"));

  const result = await generateMinigameRounds({ db, session, count: 2 });
  assert.equal(result.roundCount, 2);

  await assert.rejects(
    () => generateMinigameRounds({ db, session, count: 1 }),
    (error) => error instanceof NoUniquePatientStatementsLeftError,
  );
});

test("generateMinigameRounds avoids repeats per player in TDM", async () => {
  const { db } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(taskExamples).values([
    {
      id: "ex-1",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "A",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "ex-2",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "B",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "ex-3",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "C",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "ex-4",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "D",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
  ]);
  await db.insert(minigameSessions).values({
    id: "session-tdm",
    user_id: "user-1",
    game_type: "tdm",
    visibility_mode: "normal",
    task_selection: { strategy: "manual", task_ids: ["task-1"], seed: "seed" },
    settings: { rounds_per_player: 2 },
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: null,
    current_player_id: null,
    deleted_at: null,
  });
  await db.insert(minigameTeams).values([
    {
      id: "team-1",
      session_id: "session-tdm",
      name: "Red",
      color: "#f00",
      created_at: now,
    },
    {
      id: "team-2",
      session_id: "session-tdm",
      name: "Blue",
      color: "#00f",
      created_at: now,
    },
  ]);
  await db.insert(minigamePlayers).values([
    {
      id: "p1",
      session_id: "session-tdm",
      name: "P1",
      avatar: "a",
      team_id: "team-1",
      created_at: now,
    },
    {
      id: "p2",
      session_id: "session-tdm",
      name: "P2",
      avatar: "b",
      team_id: "team-1",
      created_at: now,
    },
    {
      id: "p3",
      session_id: "session-tdm",
      name: "P3",
      avatar: "c",
      team_id: "team-2",
      created_at: now,
    },
    {
      id: "p4",
      session_id: "session-tdm",
      name: "P4",
      avatar: "d",
      team_id: "team-2",
      created_at: now,
    },
  ]);
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-tdm"));

  const result = await generateMinigameRounds({ db, session });
  assert.equal(result.roundCount, 4);

  const rounds = await db
    .select({
      player_a_id: minigameRounds.player_a_id,
      player_b_id: minigameRounds.player_b_id,
      example_id: minigameRounds.example_id,
    })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, "session-tdm"));

  const usedByPlayer = new Map<string, Set<string>>();
  const appearances = new Map<string, number>();
  for (const round of rounds) {
    const ids = [round.player_a_id, round.player_b_id].filter(
      Boolean,
    ) as string[];
    for (const playerId of ids) {
      appearances.set(playerId, (appearances.get(playerId) ?? 0) + 1);
      if (!usedByPlayer.has(playerId)) {
        usedByPlayer.set(playerId, new Set());
      }
      const usedSet = usedByPlayer.get(playerId) ?? new Set();
      assert.ok(!usedSet.has(round.example_id));
      usedSet.add(round.example_id);
      usedByPlayer.set(playerId, usedSet);
    }
  }
  assert.deepEqual(
    [...appearances.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [
      ["p1", 2],
      ["p2", 2],
      ["p3", 2],
      ["p4", 2],
    ],
  );
});

test("generateTdmSchedule rejects incomplete or infeasible team quotas", () => {
  const invalidCases: Array<{
    name: string;
    players: Array<{ id: string; team_id: string | null }>;
    roundsPerPlayer: number;
  }> = [
    {
      name: "same-team",
      players: [
        { id: "a", team_id: "red" },
        { id: "b", team_id: "red" },
      ],
      roundsPerPlayer: 1,
    },
    {
      name: "null-team",
      players: [
        { id: "a", team_id: "red" },
        { id: "b", team_id: null },
      ],
      roundsPerPlayer: 1,
    },
    {
      name: "unbalanced",
      players: [
        { id: "a", team_id: "red" },
        { id: "b", team_id: "red" },
        { id: "c", team_id: "red" },
        { id: "d", team_id: "blue" },
      ],
      roundsPerPlayer: 1,
    },
    {
      name: "odd-total",
      players: [
        { id: "a", team_id: "red" },
        { id: "b", team_id: "blue" },
        { id: "c", team_id: "green" },
      ],
      roundsPerPlayer: 1,
    },
  ];

  for (const invalidCase of invalidCases) {
    assert.throws(
      () =>
        generateTdmSchedule(
          invalidCase.players,
          invalidCase.roundsPerPlayer,
          invalidCase.name,
        ),
      InvalidTdmConfigurationError,
      invalidCase.name,
    );
  }
});

test("generateTdmSchedule gives every player the exact feasible quota", () => {
  const players = [
    { id: "a", team_id: "red" },
    { id: "b", team_id: "red" },
    { id: "c", team_id: "blue" },
    { id: "d", team_id: "green" },
  ];
  const matches = generateTdmSchedule(players, 4, "exact-quota");
  const appearances = new Map(players.map((player) => [player.id, 0]));
  for (const match of matches) {
    assert.notEqual(
      players.find((player) => player.id === match.playerA)?.team_id,
      players.find((player) => player.id === match.playerB)?.team_id,
    );
    appearances.set(match.playerA, (appearances.get(match.playerA) ?? 0) + 1);
    appearances.set(match.playerB, (appearances.get(match.playerB) ?? 0) + 1);
  }
  assert.equal(matches.length, 8);
  assert.deepEqual([...appearances.values()], [4, 4, 4, 4]);
});

test("generateMinigameRounds rejects a TDM schedule when selected tasks have no examples", async () => {
  const { db } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(minigameSessions).values({
    id: "session-tdm-no-examples",
    user_id: "user-1",
    game_type: "tdm",
    visibility_mode: "normal",
    task_selection: { strategy: "manual", task_ids: ["task-1"] },
    settings: { rounds_per_player: 1 },
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: null,
    current_player_id: null,
    deleted_at: null,
  });
  await db.insert(minigameTeams).values([
    {
      id: "team-no-examples-a",
      session_id: "session-tdm-no-examples",
      name: "A",
      color: "#f00",
      created_at: now,
    },
    {
      id: "team-no-examples-b",
      session_id: "session-tdm-no-examples",
      name: "B",
      color: "#00f",
      created_at: now,
    },
  ]);
  await db.insert(minigamePlayers).values([
    {
      id: "no-examples-a",
      session_id: "session-tdm-no-examples",
      name: "A",
      avatar: "a",
      team_id: "team-no-examples-a",
      created_at: now,
    },
    {
      id: "no-examples-b",
      session_id: "session-tdm-no-examples",
      name: "B",
      avatar: "b",
      team_id: "team-no-examples-b",
      created_at: now,
    },
  ]);
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-tdm-no-examples"));

  await assert.rejects(
    () => generateMinigameRounds({ db, session }),
    InvalidTdmConfigurationError,
  );
});

test("generateMinigameRounds respects existing prompt history", async () => {
  const { db } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(taskExamples).values([
    {
      id: "ex-1",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "A",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "ex-2",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "B",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
  ]);
  await db.insert(minigameSessions).values({
    id: "session-history",
    user_id: "user-1",
    game_type: "ffa",
    visibility_mode: "normal",
    task_selection: { strategy: "manual", task_ids: ["task-1"], seed: "seed" },
    settings: {},
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: null,
    current_player_id: null,
    deleted_at: null,
  });
  await db.insert(minigamePlayers).values({
    id: "player-1",
    session_id: "session-history",
    name: "Alpha",
    avatar: "a",
    team_id: null,
    created_at: now,
  });
  await db.insert(minigamePlayerPromptHistory).values({
    session_id: "session-history",
    player_id: "player-1",
    patient_statement_id: "ex-1",
    created_at: now,
  });

  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-history"));

  const result = await generateMinigameRounds({ db, session, count: 1 });
  assert.equal(result.roundCount, 1);
  const [round] = await db
    .select({ example_id: minigameRounds.example_id })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, "session-history"));
  assert.equal(round.example_id, "ex-2");
});

test("redraw preserves the pending round when no replacement prompt is available", async () => {
  const { db } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(taskExamples).values({
    id: "only-example",
    task_id: "task-1",
    difficulty: 1,
    severity_label: null,
    patient_text: "Only prompt",
    language: "en",
    meta: null,
    created_at: now,
    updated_at: now,
  });
  await db.insert(minigameSessions).values({
    id: "session-redraw",
    user_id: "user-1",
    game_type: "tdm",
    visibility_mode: "normal",
    task_selection: { strategy: "manual", task_ids: ["task-1"], seed: "seed" },
    settings: { rounds_per_player: 1 },
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: "round-existing",
    current_player_id: "player-a",
    deleted_at: null,
  });
  await db.insert(minigameTeams).values([
    {
      id: "team-a",
      session_id: "session-redraw",
      name: "A",
      color: "#f00",
      created_at: now,
    },
    {
      id: "team-b",
      session_id: "session-redraw",
      name: "B",
      color: "#00f",
      created_at: now,
    },
  ]);
  await db.insert(minigamePlayers).values([
    {
      id: "player-a",
      session_id: "session-redraw",
      name: "A",
      avatar: "a",
      team_id: "team-a",
      created_at: now,
    },
    {
      id: "player-b",
      session_id: "session-redraw",
      name: "B",
      avatar: "b",
      team_id: "team-b",
      created_at: now,
    },
  ]);
  await db.insert(minigameRounds).values({
    id: "round-existing",
    session_id: "session-redraw",
    position: 0,
    task_id: "task-1",
    example_id: "only-example",
    player_a_id: "player-a",
    player_b_id: "player-b",
    team_a_id: "team-a",
    team_b_id: "team-b",
    status: "pending",
    started_at: null,
    completed_at: null,
  });
  await db.insert(minigamePlayerPromptHistory).values([
    {
      session_id: "session-redraw",
      player_id: "player-a",
      patient_statement_id: "only-example",
      created_at: now,
    },
    {
      session_id: "session-redraw",
      player_id: "player-b",
      patient_statement_id: "only-example",
      created_at: now,
    },
  ]);
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-redraw"));

  await assert.rejects(
    () =>
      redrawMinigameRound({
        db,
        session,
        replacedRoundId: "round-existing",
      }),
    (error) => error instanceof NoUniquePatientStatementsLeftError,
  );
  const [existingRound] = await db
    .select({ status: minigameRounds.status })
    .from(minigameRounds)
    .where(eq(minigameRounds.id, "round-existing"));
  assert.equal(existingRound.status, "pending");
});

test("redraw preserves a valid replaced-round pair in a three-player three-team game", async () => {
  const { db } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(taskExamples).values([
    {
      id: "odd-redraw-original",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "Original",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "odd-redraw-replacement",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "Replacement",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
  ]);
  await db.insert(minigameSessions).values({
    id: "session-odd-redraw",
    user_id: "user-1",
    game_type: "tdm",
    visibility_mode: "normal",
    task_selection: {
      strategy: "manual",
      task_ids: ["task-1"],
      seed: "odd-redraw",
    },
    settings: { rounds_per_player: 1 },
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: "odd-redraw-round",
    current_player_id: "odd-player-a",
    deleted_at: null,
  });
  await db.insert(minigameTeams).values([
    {
      id: "odd-team-a",
      session_id: "session-odd-redraw",
      name: "A",
      color: "#f00",
      created_at: now,
    },
    {
      id: "odd-team-b",
      session_id: "session-odd-redraw",
      name: "B",
      color: "#00f",
      created_at: now,
    },
    {
      id: "odd-team-c",
      session_id: "session-odd-redraw",
      name: "C",
      color: "#0f0",
      created_at: now,
    },
  ]);
  await db.insert(minigamePlayers).values([
    {
      id: "odd-player-a",
      session_id: "session-odd-redraw",
      name: "A",
      avatar: "a",
      team_id: "odd-team-a",
      created_at: now,
    },
    {
      id: "odd-player-b",
      session_id: "session-odd-redraw",
      name: "B",
      avatar: "b",
      team_id: "odd-team-b",
      created_at: now,
    },
    {
      id: "odd-player-c",
      session_id: "session-odd-redraw",
      name: "C",
      avatar: "c",
      team_id: "odd-team-c",
      created_at: now,
    },
  ]);
  await db.insert(minigameRounds).values({
    id: "odd-redraw-round",
    session_id: "session-odd-redraw",
    position: 0,
    task_id: "task-1",
    example_id: "odd-redraw-original",
    player_a_id: "odd-player-a",
    player_b_id: "odd-player-b",
    team_a_id: "odd-team-a",
    team_b_id: "odd-team-b",
    status: "pending",
    started_at: null,
    completed_at: null,
  });
  await db.insert(minigamePlayerPromptHistory).values([
    {
      session_id: "session-odd-redraw",
      player_id: "odd-player-a",
      patient_statement_id: "odd-redraw-original",
      created_at: now,
    },
    {
      session_id: "session-odd-redraw",
      player_id: "odd-player-b",
      patient_statement_id: "odd-redraw-original",
      created_at: now,
    },
  ]);
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-odd-redraw"));

  const result = await redrawMinigameRound({
    db,
    session,
    replacedRoundId: "odd-redraw-round",
  });
  assert.equal(result.roundCount, 1);
  const rounds = await db
    .select()
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, "session-odd-redraw"));
  const replacement = rounds.find((round) => round.id !== "odd-redraw-round");
  assert.equal(
    rounds.find((round) => round.id === "odd-redraw-round")?.status,
    "completed",
  );
  assert.equal(replacement?.example_id, "odd-redraw-replacement");
  assert.equal(replacement?.player_a_id, "odd-player-a");
  assert.equal(replacement?.player_b_id, "odd-player-b");
  assert.equal(replacement?.team_a_id, "odd-team-a");
  assert.equal(replacement?.team_b_id, "odd-team-b");
});

test("concurrent redraws create exactly one durable replacement claim", async () => {
  const { db, sqlite } = setupDb();
  const now = Date.now();
  await seedTasks(db);
  await db.insert(taskExamples).values([
    {
      id: "redraw-original",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "Original prompt",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "redraw-candidate-a",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "Candidate A",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
    {
      id: "redraw-candidate-b",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "Candidate B",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    },
  ]);
  await db.insert(minigameSessions).values({
    id: "session-concurrent-redraw",
    user_id: "user-1",
    game_type: "tdm",
    visibility_mode: "normal",
    task_selection: { strategy: "manual", task_ids: ["task-1"], seed: "seed" },
    settings: { rounds_per_player: 1 },
    created_at: now,
    ended_at: null,
    last_active_at: now,
    current_round_id: "round-to-redraw",
    current_player_id: "redraw-player-a",
    deleted_at: null,
  });
  await db.insert(minigameTeams).values([
    {
      id: "redraw-team-a",
      session_id: "session-concurrent-redraw",
      name: "A",
      color: "#f00",
      created_at: now,
    },
    {
      id: "redraw-team-b",
      session_id: "session-concurrent-redraw",
      name: "B",
      color: "#00f",
      created_at: now,
    },
  ]);
  await db.insert(minigamePlayers).values([
    {
      id: "redraw-player-a",
      session_id: "session-concurrent-redraw",
      name: "A",
      avatar: "a",
      team_id: "redraw-team-a",
      created_at: now,
    },
    {
      id: "redraw-player-b",
      session_id: "session-concurrent-redraw",
      name: "B",
      avatar: "b",
      team_id: "redraw-team-b",
      created_at: now,
    },
  ]);
  await db.insert(minigameRounds).values({
    id: "round-to-redraw",
    session_id: "session-concurrent-redraw",
    position: 0,
    task_id: "task-1",
    example_id: "redraw-original",
    player_a_id: "redraw-player-a",
    player_b_id: "redraw-player-b",
    team_a_id: "redraw-team-a",
    team_b_id: "redraw-team-b",
    status: "pending",
    started_at: null,
    completed_at: null,
  });
  await db.insert(minigamePlayerPromptHistory).values([
    {
      session_id: "session-concurrent-redraw",
      player_id: "redraw-player-a",
      patient_statement_id: "redraw-original",
      created_at: now,
    },
    {
      session_id: "session-concurrent-redraw",
      player_id: "redraw-player-b",
      patient_statement_id: "redraw-original",
      created_at: now,
    },
  ]);
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-concurrent-redraw"));

  const outcomes = await Promise.allSettled([
    redrawMinigameRound({
      db,
      session,
      replacedRoundId: "round-to-redraw",
    }),
    redrawMinigameRound({
      db,
      session,
      replacedRoundId: "round-to-redraw",
    }),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const [rejected] = outcomes.filter(
    (outcome): outcome is PromiseRejectedResult =>
      outcome.status === "rejected",
  );
  assert.ok(rejected?.reason instanceof MinigameRedrawConflictError);

  const claims = await db.select().from(minigameRedrawClaims);
  assert.equal(claims.length, 1);
  assert.equal(claims[0]?.replaced_round_id, "round-to-redraw");
  const rounds = await db
    .select()
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, "session-concurrent-redraw"));
  assert.equal(rounds.length, 2);
  assert.equal(
    rounds.find((round) => round.id === "round-to-redraw")?.status,
    "completed",
  );
  assert.equal(
    rounds.find((round) => round.id === claims[0]?.replacement_round_id)
      ?.status,
    "pending",
  );
  sqlite.close();
});
