import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { attempts, tasks, users } from "../src/db/schema";
import { fetchLeaderboardEntries } from "../src/services/leaderboardService";

const setupDb = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      skill_domain TEXT NOT NULL,
      base_difficulty INTEGER NOT NULL,
      general_objective TEXT,
      tags TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      is_published INTEGER NOT NULL,
      parent_task_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT,
      session_item_id TEXT,
      task_id TEXT NOT NULL,
      example_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      audio_ref TEXT,
      transcript TEXT NOT NULL,
      evaluation TEXT NOT NULL,
      overall_pass INTEGER NOT NULL,
      overall_score REAL NOT NULL,
      model_info TEXT
    );
  `);
  const db = drizzle(sqlite);
  return { db, sqlite };
};

const seedBaseData = async () => {
  const { db } = setupDb();
  const now = Date.now();
  await db.insert(users).values([
    { id: "user-1", email: "alpha@example.com", created_at: now },
    { id: "user-2", email: "beta@example.com", created_at: now }
  ]);
  await db.insert(tasks).values([
    {
      id: "task-1",
      slug: "task-1",
      title: "Task 1",
      description: "Task 1",
      skill_domain: "cbt",
      base_difficulty: 2,
      general_objective: null,
      tags: ["a", "b"],
      language: "en",
      is_published: true,
      parent_task_id: null,
      created_at: now,
      updated_at: now
    },
    {
      id: "task-2",
      slug: "task-2",
      title: "Task 2",
      description: "Task 2",
      skill_domain: "cbt",
      base_difficulty: 2,
      general_objective: null,
      tags: ["b"],
      language: "en",
      is_published: true,
      parent_task_id: null,
      created_at: now,
      updated_at: now
    },
    {
      id: "task-3",
      slug: "task-3",
      title: "Task 3",
      description: "Task 3",
      skill_domain: "dbt",
      base_difficulty: 2,
      general_objective: null,
      tags: ["c"],
      language: "fr",
      is_published: true,
      parent_task_id: null,
      created_at: now,
      updated_at: now
    }
  ]);

  await db.insert(attempts).values([
    {
      id: "attempt-1",
      user_id: "user-1",
      session_id: null,
      session_item_id: null,
      task_id: "task-1",
      example_id: "example-1",
      started_at: 90,
      completed_at: 100,
      audio_ref: null,
      transcript: "test",
      evaluation: { overall_score: 2 },
      overall_pass: true,
      overall_score: 2,
      model_info: null
    },
    {
      id: "attempt-2",
      user_id: "user-1",
      session_id: null,
      session_item_id: null,
      task_id: "task-1",
      example_id: "example-2",
      started_at: 190,
      completed_at: 200,
      audio_ref: null,
      transcript: "test",
      evaluation: { overall_score: 4 },
      overall_pass: true,
      overall_score: 4,
      model_info: null
    },
    {
      id: "attempt-3",
      user_id: "user-1",
      session_id: null,
      session_item_id: null,
      task_id: "task-2",
      example_id: "example-3",
      started_at: 140,
      completed_at: 150,
      audio_ref: null,
      transcript: "test",
      evaluation: { overall_score: 3 },
      overall_pass: true,
      overall_score: 3,
      model_info: null
    },
    {
      id: "attempt-4",
      user_id: "user-2",
      session_id: null,
      session_item_id: null,
      task_id: "task-1",
      example_id: "example-4",
      started_at: 170,
      completed_at: 180,
      audio_ref: null,
      transcript: "test",
      evaluation: { overall_score: 5 },
      overall_pass: true,
      overall_score: 5,
      model_info: null
    },
    {
      id: "attempt-5",
      user_id: "user-2",
      session_id: null,
      session_item_id: null,
      task_id: "task-2",
      example_id: "example-5",
      started_at: 210,
      completed_at: 220,
      audio_ref: null,
      transcript: "test",
      evaluation: { overall_score: 1 },
      overall_pass: false,
      overall_score: 1,
      model_info: null
    }
  ]);

  return db;
};

test("fetchLeaderboardEntries aggregates latest attempts per task", async () => {
  const db = await seedBaseData();
  const entries = await fetchLeaderboardEntries(db, {
    tags: ["b"],
    skillDomain: "cbt",
    language: "en",
    limit: 50
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].user_id, "user-1");
  assert.equal(entries[0].display_name, "alpha");
  assert.equal(entries[0].score, 3.5);
  assert.equal(entries[0].played, 2);
  assert.equal(entries[0].last_active_at, 200);

  assert.equal(entries[1].user_id, "user-2");
  assert.equal(entries[1].score, 3);
  assert.equal(entries[1].played, 2);
  assert.equal(entries[1].last_active_at, 220);
});

test("fetchLeaderboardEntries returns empty when no tasks match", async () => {
  const db = await seedBaseData();
  const entries = await fetchLeaderboardEntries(db, {
    tags: ["missing"],
    skillDomain: "cbt",
    language: "en",
    limit: 50
  });

  assert.equal(entries.length, 0);
});
