import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  minigamePlayerPromptHistory,
  minigamePlayers,
  minigameRounds,
  minigameSessions,
  minigameTeams,
  taskExamples,
  tasks
} from "../src/db/schema";
import { generateMinigameRounds, NoUniquePatientStatementsLeftError } from "../src/services/minigameRoundsService";

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
    updated_at: now
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
      updated_at: now
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
      updated_at: now
    }
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
    deleted_at: null
  });
  await db.insert(minigamePlayers).values({
    id: "player-1",
    session_id: "session-ffa",
    name: "Alpha",
    avatar: "a",
    team_id: null,
    created_at: now
  });
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-ffa"));

  const result = await generateMinigameRounds({ db, session, count: 2 });
  assert.equal(result.roundCount, 2);

  await assert.rejects(
    () => generateMinigameRounds({ db, session, count: 1 }),
    (error) => error instanceof NoUniquePatientStatementsLeftError
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
      updated_at: now
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
      updated_at: now
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
      updated_at: now
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
      updated_at: now
    }
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
    deleted_at: null
  });
  await db.insert(minigameTeams).values([
    { id: "team-1", session_id: "session-tdm", name: "Red", color: "#f00", created_at: now },
    { id: "team-2", session_id: "session-tdm", name: "Blue", color: "#00f", created_at: now }
  ]);
  await db.insert(minigamePlayers).values([
    { id: "p1", session_id: "session-tdm", name: "P1", avatar: "a", team_id: "team-1", created_at: now },
    { id: "p2", session_id: "session-tdm", name: "P2", avatar: "b", team_id: "team-1", created_at: now },
    { id: "p3", session_id: "session-tdm", name: "P3", avatar: "c", team_id: "team-2", created_at: now },
    { id: "p4", session_id: "session-tdm", name: "P4", avatar: "d", team_id: "team-2", created_at: now }
  ]);
  const [session] = await db
    .select()
    .from(minigameSessions)
    .where(eq(minigameSessions.id, "session-tdm"));

  const result = await generateMinigameRounds({ db, session });
  assert.ok(result.roundCount > 0);

  const rounds = await db
    .select({ player_a_id: minigameRounds.player_a_id, player_b_id: minigameRounds.player_b_id, example_id: minigameRounds.example_id })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, "session-tdm"));

  const usedByPlayer = new Map<string, Set<string>>();
  for (const round of rounds) {
    const ids = [round.player_a_id, round.player_b_id].filter(Boolean) as string[];
    for (const playerId of ids) {
      if (!usedByPlayer.has(playerId)) {
        usedByPlayer.set(playerId, new Set());
      }
      const usedSet = usedByPlayer.get(playerId) ?? new Set();
      assert.ok(!usedSet.has(round.example_id));
      usedSet.add(round.example_id);
      usedByPlayer.set(playerId, usedSet);
    }
  }
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
      updated_at: now
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
      updated_at: now
    }
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
    deleted_at: null
  });
  await db.insert(minigamePlayers).values({
    id: "player-1",
    session_id: "session-history",
    name: "Alpha",
    avatar: "a",
    team_id: null,
    created_at: now
  });
  await db.insert(minigamePlayerPromptHistory).values({
    session_id: "session-history",
    player_id: "player-1",
    patient_statement_id: "ex-1",
    created_at: now
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
