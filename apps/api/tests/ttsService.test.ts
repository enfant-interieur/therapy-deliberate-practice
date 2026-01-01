import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import { ttsAssets } from "../src/db/schema";
import type { RuntimeEnv } from "../src/env";
import { getOrCreateTtsAsset } from "../src/services/ttsService";

const createEnv = (): RuntimeEnv => ({
  aiMode: "local_prefer",
  openaiApiKey: "test-openai",
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
  supabaseUrl: "",
  supabaseAnonKey: "",
  supabaseJwtSecret: "test-secret",
  r2Bucket: "tts-bucket",
  r2PublicBaseUrl: ""
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

test("getOrCreateTtsAsset returns generating when a request is in progress", async () => {
  const { db } = setupDb();
  const env = createEnv();
  let resolveSynthesize: ((value: { bytes: Uint8Array; contentType: string }) => void) | null =
    null;
  const synthesizePromise = new Promise<{ bytes: Uint8Array; contentType: string }>((resolve) => {
    resolveSynthesize = resolve;
  });
  const provider = {
    kind: "openai" as const,
    model: "tts-1",
    voice: "alloy",
    format: "mp3" as const,
    healthCheck: async () => true,
    synthesize: async () => synthesizePromise
  };
  const storage = {
    headObject: async () => ({ exists: true }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3
    })
  };

  const firstPromise = getOrCreateTtsAsset(
    db,
    env,
    storage,
    provider,
    { text: "Hello there", voice: "alloy", model: "tts-1", format: "mp3" }
  );
  const secondResult = await getOrCreateTtsAsset(
    db,
    env,
    storage,
    provider,
    { text: "Hello there", voice: "alloy", model: "tts-1", format: "mp3" }
  );

  assert.equal(secondResult.status, "generating");
  resolveSynthesize?.({ bytes: new Uint8Array([9, 9, 9]), contentType: "audio/mpeg" });
  const firstResult = await firstPromise;
  assert.equal(firstResult.status, "ready");
});

test("tts route returns 404 when not ready and 200 when ready", async () => {
  const { db } = setupDb();
  const env = createEnv();
  const storage = {
    headObject: async () => ({ exists: true }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3
    })
  };
  const app = createApiApp({ env, db, tts: { storage } });
  const token = await new SignJWT({ email: "user@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-1")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(env.supabaseJwtSecret));

  await db.insert(ttsAssets).values({
    id: "asset-1",
    cache_key: "cache-missing",
    text: "Hello",
    voice: "alloy",
    model: "tts-1",
    format: "mp3",
    r2_key: "tts/tts-1/alloy/cache-missing.mp3",
    bytes: null,
    content_type: "audio/mpeg",
    etag: null,
    status: "generating",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now()
  });

  const notReady = await app.request("/api/v1/tts/cache-missing", {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(notReady.status, 404);

  await db.insert(ttsAssets).values({
    id: "asset-2",
    cache_key: "cache-ready",
    text: "Hello",
    voice: "alloy",
    model: "tts-1",
    format: "mp3",
    r2_key: "tts/tts-1/alloy/cache-ready.mp3",
    bytes: 3,
    content_type: "audio/mpeg",
    etag: "etag",
    status: "ready",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now()
  });

  const ready = await app.request("/api/v1/tts/cache-ready", {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("content-type"), "audio/mpeg");
});
