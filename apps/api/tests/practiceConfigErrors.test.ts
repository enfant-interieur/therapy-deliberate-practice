import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import type { RuntimeEnv } from "../src/env";
import { userSettings, users } from "../src/db/schema";

const createEnv = (overrides: Partial<RuntimeEnv> = {}): RuntimeEnv => ({
  aiMode: "local_prefer",
  openaiApiKey: "",
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

  const headers = await createAuthHeader(env, userId);
  const response = await app.request("/api/v1/practice/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      task_id: "task-1",
      example_id: "example-1",
      attempt_id: "attempt-1",
      transcript_text: "hello",
      practice_mode: "real_time",
      skip_scoring: true
    })
  });

  assert.equal(response.status, 400);
  const payload = (await response.json()) as { errors?: Array<{ message?: string }> };
  assert.ok(payload.errors?.[0]?.message?.includes("OpenAI mode requires an API key"));
});
