import {
  applyAuthTestMigration,
  createAuthTestEnv,
  createManagedSessionHeaders,
} from "./authFixture";
import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createApiApp } from "../src/app";
import type { RuntimeEnv } from "../src/env";
import { taskExamples, tasks, userSettings, users } from "../src/db/schema";

const createEnv = (overrides: Partial<RuntimeEnv> = {}): RuntimeEnv => ({
  ...createAuthTestEnv(),
  aiMode: "local_prefer",
  openaiApiKey: "",
  openaiKeyEncryptionSecret: "",
  adminEmails: [],
  adminGroups: [],
  cfAccessAud: "",
  cfAccessIssuer: "",
  bypassAdminAuth: false,
  devAdminToken: "",
  environment: "test",
  localSttUrl: "http://localhost:7001",
  localLlmUrl: "http://localhost:7002",
  localLlmModel: "test-llm",
  localTtsUrl: "http://localhost:7003",
  localTtsModel: "test-tts",
  localTtsVoice: "marin",
  localTtsFormat: "mp3",
  openaiTtsModel: "gpt-4o-mini-tts",
  openaiTtsVoice: "marin",
  openaiTtsFormat: "mp3",
  openaiTtsInstructions: "Speak like a patient.",
  r2Bucket: "tts-bucket",
  r2PublicBaseUrl: "",
  ...overrides,
});

const setupDb = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT 'Player',
      bio TEXT,
      is_profile_public INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY,
      ai_mode TEXT NOT NULL DEFAULT 'local_prefer',
      local_base_url TEXT,
      local_stt_url TEXT,
      local_llm_url TEXT,
      store_audio INTEGER NOT NULL DEFAULT 0,
      openai_key_ciphertext TEXT,
      openai_key_iv TEXT,
      openai_key_kid TEXT,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
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
      score_trust TEXT NOT NULL DEFAULT 'local_unverified',
      model_info TEXT
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
  `);
  applyAuthTestMigration(sqlite);
  const db = drizzle(sqlite);
  return { db, sqlite };
};

const createAuthHeader = async (
  db: Parameters<typeof createManagedSessionHeaders>[0],
  env: RuntimeEnv,
  userId: string,
) =>
  createManagedSessionHeaders(db, env, userId, { email: "user@example.com" });

test("practice run returns 400 when openai_only has no key", async () => {
  const { db } = setupDb();
  const env = createEnv();
  const storage = {
    headObject: async () => ({ exists: false }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3,
    }),
  };
  const app = createApiApp({ env, db, tts: { storage } });
  const userId = "user-1";

  await db.insert(users).values({
    id: userId,
    email: "user@example.com",
    display_name: "Player One",
    bio: null,
    is_profile_public: 1,
    created_at: Date.now(),
  });
  await db.insert(userSettings).values({
    user_id: userId,
    ai_mode: "openai_only",
    local_stt_url: null,
    local_llm_url: null,
    store_audio: 0,
    openai_key_ciphertext: null,
    openai_key_iv: null,
    openai_key_kid: null,
    updated_at: Date.now(),
    created_at: Date.now(),
  });
  const now = Date.now();
  await db.insert(tasks).values({
    id: "task-1",
    slug: "task-1",
    title: "Task",
    description: "Description",
    skill_domain: "validation",
    base_difficulty: 2,
    general_objective: null,
    tags: [],
    language: "en",
    is_published: true,
    parent_task_id: null,
    created_at: now,
    updated_at: now,
  });
  await db.insert(taskExamples).values({
    id: "example-1",
    task_id: "task-1",
    difficulty: 2,
    severity_label: null,
    patient_text: "Prompt",
    language: "en",
    meta: null,
    created_at: now,
    updated_at: now,
  });

  const headers = await createAuthHeader(db, env, userId);
  const response = await app.request("/api/v1/practice/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      task_id: "task-1",
      example_id: "example-1",
      input_mode: "typed",
      transcript_text: "hello",
      practice_mode: "real_time",
      skip_scoring: true,
    }),
  });

  assert.equal(response.status, 400);
  const payload = (await response.json()) as {
    errors?: Array<{ message?: string }>;
  };
  assert.ok(
    payload.errors?.[0]?.message?.includes("OpenAI mode requires an API key"),
  );
});
