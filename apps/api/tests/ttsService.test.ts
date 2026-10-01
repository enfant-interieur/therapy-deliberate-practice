import {
  applyAuthTestMigration,
  createAuthTestEnv,
  createManagedSessionHeaders,
} from "./authFixture";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { createApiApp } from "../src/app";
import { taskExamples, tasks, ttsAssets } from "../src/db/schema";
import type { RuntimeEnv } from "../src/env";
import { getOrCreateTtsAsset } from "../src/services/ttsService";
import { buildTtsCacheKey, buildTtsR2Key } from "../src/utils/ttsCache";

const openTestDatabases = new Set<InstanceType<typeof Database>>();

afterEach(() => {
  for (const sqlite of openTestDatabases) {
    if (sqlite.open) {
      sqlite.close();
    }
  }
  openTestDatabases.clear();
});

const createEnv = (): RuntimeEnv => ({
  ...createAuthTestEnv(),
  aiMode: "local_prefer",
  openaiApiKey: "test-openai",
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
});

const setupDb = () => {
  const sqlite = new Database(":memory:");
  openTestDatabases.add(sqlite);
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
      language TEXT NOT NULL DEFAULT 'en',
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
      language TEXT NOT NULL DEFAULT 'en',
      meta TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  applyAuthTestMigration(sqlite);
  const db = drizzle(sqlite);
  return { db, sqlite };
};

test("getOrCreateTtsAsset returns generating when a request is in progress", async () => {
  const { db } = setupDb();
  const env = createEnv();
  let resolveSynthesize:
    ((value: { bytes: Uint8Array; contentType: string }) => void) | null = null;
  const synthesizePromise = new Promise<{
    bytes: Uint8Array;
    contentType: string;
  }>((resolve) => {
    resolveSynthesize = resolve;
  });
  let markSynthesizeStarted!: () => void;
  const synthesizeStarted = new Promise<void>((resolve) => {
    markSynthesizeStarted = resolve;
  });
  const provider = {
    kind: "openai" as const,
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3" as const,
    healthCheck: async () => true,
    synthesize: async () => {
      markSynthesizeStarted();
      return synthesizePromise;
    },
  };
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

  const firstPromise = getOrCreateTtsAsset(db, env, storage, provider, {
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
  });
  await synthesizeStarted;
  const secondResult = await getOrCreateTtsAsset(db, env, storage, provider, {
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
  });

  assert.equal(secondResult.status, "generating");
  resolveSynthesize?.({
    bytes: new Uint8Array([9, 9, 9]),
    contentType: "audio/mpeg",
  });
  const firstResult = await firstPromise;
  assert.equal(firstResult.status, "ready");
});

test("getOrCreateTtsAsset returns ready when DB missing but R2 exists", async () => {
  const { db } = setupDb();
  const env = createEnv();
  let synthesizeCalled = false;
  const provider = {
    kind: "openai" as const,
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3" as const,
    healthCheck: async () => true,
    synthesize: async () => {
      synthesizeCalled = true;
      return { bytes: new Uint8Array([1]), contentType: "audio/mpeg" };
    },
  };
  const storage = {
    headObject: async () => ({ exists: true, etag: "etag", size: 3 }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3,
    }),
  };

  const result = await getOrCreateTtsAsset(db, env, storage, provider, {
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
  });

  assert.equal(result.status, "ready");
  assert.equal(synthesizeCalled, false);
});

test("getOrCreateTtsAsset regenerates when DB ready but R2 missing", async () => {
  const { db } = setupDb();
  const env = createEnv();
  let synthesizeCalled = false;
  const provider = {
    kind: "openai" as const,
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3" as const,
    healthCheck: async () => true,
    synthesize: async () => {
      synthesizeCalled = true;
      return { bytes: new Uint8Array([4, 5, 6]), contentType: "audio/mpeg" };
    },
  };
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

  const { cacheKey } = await buildTtsCacheKey({
    text: "Hello there",
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3",
  });
  const r2Key = buildTtsR2Key({
    cacheKey,
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3",
  });

  await db.insert(ttsAssets).values({
    id: "asset-ready",
    cache_key: cacheKey,
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
    r2_key: r2Key,
    bytes: 3,
    content_type: "audio/mpeg",
    etag: "etag",
    status: "ready",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const result = await getOrCreateTtsAsset(db, env, storage, provider, {
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
  });

  assert.equal(result.status, "ready");
  assert.equal(synthesizeCalled, true);
});

test("getOrCreateTtsAsset flips generating to ready when R2 exists", async () => {
  const { db } = setupDb();
  const env = createEnv();
  let synthesizeCalled = false;
  const provider = {
    kind: "openai" as const,
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3" as const,
    healthCheck: async () => true,
    synthesize: async () => {
      synthesizeCalled = true;
      return { bytes: new Uint8Array([1]), contentType: "audio/mpeg" };
    },
  };
  const storage = {
    headObject: async () => ({ exists: true, etag: "etag", size: 3 }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3,
    }),
  };

  const { cacheKey } = await buildTtsCacheKey({
    text: "Hello there",
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3",
  });
  const r2Key = buildTtsR2Key({
    cacheKey,
    model: "gpt-4o-mini-tts",
    voice: "marin",
    format: "mp3",
  });

  await db.insert(ttsAssets).values({
    id: "asset-generating",
    cache_key: cacheKey,
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
    r2_key: r2Key,
    bytes: null,
    content_type: "audio/mpeg",
    etag: null,
    status: "generating",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const result = await getOrCreateTtsAsset(db, env, storage, provider, {
    text: "Hello there",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
  });

  assert.equal(result.status, "ready");
  assert.equal(synthesizeCalled, false);
});

test("tts route serves shared ready audio when at least one associated task is published", async () => {
  const { db } = setupDb();
  const env = createEnv();
  const storage = {
    headObject: async () => ({ exists: true }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: "audio/mpeg",
      etag: "etag",
      contentLength: 3,
    }),
  };
  const app = createApiApp({ env, db, tts: { storage } });
  const headers = await createManagedSessionHeaders(db, env, "user-1", {
    email: "user@example.com",
  });

  await db.insert(ttsAssets).values({
    id: "asset-1",
    cache_key: "cache-missing",
    text: "Hello",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
    r2_key: "tts/gpt-4o-mini-tts/marin/cache-missing.mp3",
    bytes: null,
    content_type: "audio/mpeg",
    etag: null,
    status: "generating",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const notReady = await app.request("/api/v1/tts/cache-missing", {
    headers,
  });
  assert.equal(notReady.status, 404);

  await db.insert(ttsAssets).values({
    id: "asset-2",
    cache_key: "cache-ready",
    text: "Hello",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
    r2_key: "tts/gpt-4o-mini-tts/marin/cache-ready.mp3",
    bytes: 3,
    content_type: "audio/mpeg",
    etag: "etag",
    status: "ready",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.insert(tasks).values({
    id: "task-published",
    slug: "published",
    title: "Published",
    description: "Published task",
    skill_domain: "reflection",
    base_difficulty: 1,
    general_objective: null,
    tags: [],
    language: "en",
    is_published: true,
    parent_task_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.insert(taskExamples).values({
    id: "example-published",
    task_id: "task-published",
    difficulty: 1,
    severity_label: null,
    patient_text: "Hello",
    language: "en",
    meta: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.insert(tasks).values({
    id: "task-shared-draft",
    slug: "shared-draft",
    title: "Shared draft",
    description: "Draft task with the same patient statement",
    skill_domain: "reflection",
    base_difficulty: 1,
    general_objective: null,
    tags: [],
    language: "en",
    is_published: false,
    parent_task_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.insert(taskExamples).values({
    id: "example-shared-draft",
    task_id: "task-shared-draft",
    difficulty: 1,
    severity_label: null,
    patient_text: "Hello",
    language: "en",
    meta: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const ready = await app.request("/api/v1/tts/cache-ready");
  assert.equal(ready.status, 200);
  assert.equal(ready.headers.get("content-type"), "audio/mpeg");
});

test("tts route hides ready audio associated only with a draft task without reading storage", async () => {
  const { db } = setupDb();
  const env = createEnv();
  let storageReads = 0;
  const storage = {
    headObject: async () => ({ exists: true }),
    putObject: async () => ({ etag: "etag" }),
    getObject: async () => {
      storageReads += 1;
      return {
        body: new Uint8Array([1, 2, 3]),
        contentType: "audio/mpeg",
        etag: "etag",
        contentLength: 3,
      };
    },
  };
  const app = createApiApp({ env, db, tts: { storage } });

  await db.insert(tasks).values({
    id: "task-draft",
    slug: "draft",
    title: "Draft",
    description: "Draft task",
    skill_domain: "reflection",
    base_difficulty: 1,
    general_objective: null,
    tags: [],
    language: "en",
    is_published: false,
    parent_task_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.insert(taskExamples).values({
    id: "example-draft",
    task_id: "task-draft",
    difficulty: 1,
    severity_label: null,
    patient_text: "Private draft statement",
    language: "en",
    meta: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await db.insert(ttsAssets).values({
    id: "asset-draft",
    cache_key: "cache-draft",
    text: "Private draft statement",
    voice: "marin",
    model: "gpt-4o-mini-tts",
    format: "mp3",
    r2_key: "tts/gpt-4o-mini-tts/marin/cache-draft.mp3",
    bytes: 3,
    content_type: "audio/mpeg",
    etag: "etag",
    status: "ready",
    error: null,
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  const response = await app.request("/api/v1/tts/cache-draft");

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "TTS asset not found." });
  assert.equal(storageReads, 0);
});
