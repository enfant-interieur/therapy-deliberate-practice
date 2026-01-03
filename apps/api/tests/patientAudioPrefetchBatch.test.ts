import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import type { RuntimeEnv } from "../src/env";
import { taskExamples, userSettings, users } from "../src/db/schema";

const createEnv = (overrides: Partial<RuntimeEnv> = {}): RuntimeEnv => ({
  aiMode: "openai_only",
  openaiApiKey: "server-openai-key",
  openaiKeyEncryptionSecret: "",
  adminEmails: [],
  adminGroups: [],
  cfAccessAud: "",
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
  supabaseUrl: "",
  supabaseAnonKey: "",
  supabaseJwtSecret: "test-secret",
  r2Bucket: "tts-bucket",
  r2PublicBaseUrl: "",
  ...overrides
});

const setupDb = () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE user_settings (
      user_id TEXT PRIMARY KEY,
      ai_mode TEXT NOT NULL DEFAULT 'local_prefer',
      local_stt_url TEXT,
      local_llm_url TEXT,
      store_audio INTEGER NOT NULL DEFAULT 0,
      openai_key_ciphertext TEXT,
      openai_key_iv TEXT,
      openai_key_kid TEXT,
      updated_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE task_examples (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      difficulty INTEGER NOT NULL,
      severity_label TEXT,
      patient_text TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      meta TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE tts_assets (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL,
      text TEXT NOT NULL,
      voice TEXT NOT NULL,
      model TEXT NOT NULL,
      format TEXT NOT NULL,
      r2_key TEXT NOT NULL,
      bytes INTEGER,
      content_type TEXT NOT NULL,
      etag TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX tts_assets_cache_key_idx ON tts_assets (cache_key);
  `);
  const db = drizzle(sqlite);
  return { db, sqlite };
};

const createAuthHeader = async (env: RuntimeEnv, userId: string) => {
  const token = await new SignJWT({ email: "user@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(env.supabaseJwtSecret));
  return { Authorization: `Bearer ${token}` };
};

test("prefetch batch returns ready items for patient audio", async () => {
  const { db } = setupDb();
  const env = createEnv();
  const storage = {
    headObject: async () => ({ exists: true, etag: "etag", size: 3 }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3
    })
  };
  const app = createApiApp({ env, db, tts: { storage } });
  const userId = "user-1";

  await db.insert(users).values({ id: userId, email: "user@example.com", created_at: Date.now() });
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
    created_at: Date.now()
  });
  await db.insert(taskExamples).values([
    {
      id: "statement-1",
      task_id: "task-1",
      difficulty: 1,
      severity_label: null,
      patient_text: "Patient line one.",
      language: "en",
      meta: null,
      created_at: Date.now(),
      updated_at: Date.now()
    },
    {
      id: "statement-2",
      task_id: "task-1",
      difficulty: 2,
      severity_label: null,
      patient_text: "Patient line two.",
      language: "en",
      meta: null,
      created_at: Date.now(),
      updated_at: Date.now()
    }
  ]);

  const response = await app.request("/api/v1/practice/patient-audio/prefetch-batch", {
    method: "POST",
    headers: {
      ...(await createAuthHeader(env, userId)),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      exercise_id: "task-1",
      practice_mode: "real_time",
      statement_ids: ["statement-1", "statement-2"]
    })
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ready_count, 2);
  assert.equal(payload.total_count, 2);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].status, "ready");
  assert.ok(payload.items[0].cache_key);
  assert.ok(payload.items[0].audio_url);
});

test("prefetch batch relies on server OpenAI key", async () => {
  const { db } = setupDb();
  const env = createEnv({ openaiApiKey: "" });
  const storage = {
    headObject: async () => ({ exists: false }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3
    })
  };
  const app = createApiApp({ env, db, tts: { storage } });
  const userId = "user-1";

  await db.insert(users).values({ id: userId, email: "user@example.com", created_at: Date.now() });
  await db.insert(userSettings).values({
    user_id: userId,
    ai_mode: "openai_only",
    local_stt_url: null,
    local_llm_url: null,
    store_audio: 0,
    openai_key_ciphertext: "cipher",
    openai_key_iv: "iv",
    openai_key_kid: null,
    updated_at: Date.now(),
    created_at: Date.now()
  });
  await db.insert(taskExamples).values({
    id: "statement-1",
    task_id: "task-1",
    difficulty: 1,
    severity_label: null,
    patient_text: "Patient line one.",
    language: "en",
    meta: null,
    created_at: Date.now(),
    updated_at: Date.now()
  });

  const response = await app.request("/api/v1/practice/patient-audio/prefetch-batch", {
    method: "POST",
    headers: {
      ...(await createAuthHeader(env, userId)),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      exercise_id: "task-1",
      practice_mode: "real_time",
      statement_ids: ["statement-1"]
    })
  });

  assert.equal(response.status, 502);
});
