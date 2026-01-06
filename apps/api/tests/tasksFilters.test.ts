import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import { tasks } from "../src/db/schema";
import { resolveEnv } from "../src/env";

const createTempDb = async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(path.join(__dirname, "tmp-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  return { db, tempDir };
};

const createApp = async () => {
  const { db, tempDir } = await createTempDb();
  const env = resolveEnv({ ENV: "development", BYPASS_ADMIN_AUTH: "true" });
  const storage = {
    headObject: async () => ({ exists: false }),
    putObject: async () => ({}),
    getObject: async () => ({ body: new Uint8Array(), contentType: "audio/mpeg" })
  };
  const app = createApiApp({ env, db, tts: { storage } });
  return { app, db, tempDir };
};

test("GET /api/v1/tasks/languages returns distinct sorted languages", async () => {
  const { app, db, tempDir } = await createApp();
  await db.insert(tasks).values([
    {
      id: "task-1",
      slug: "task-1",
      title: "Alpha",
      description: "First task",
      skill_domain: "CBT",
      base_difficulty: 2,
      general_objective: null,
      tags: ["intro"],
      language: "en",
      is_published: true,
      parent_task_id: null,
      created_at: 10,
      updated_at: 10
    },
    {
      id: "task-2",
      slug: "task-2",
      title: "Beta",
      description: "Second task",
      skill_domain: "CBT",
      base_difficulty: 3,
      general_objective: null,
      tags: ["intro"],
      language: "fr",
      is_published: true,
      parent_task_id: null,
      created_at: 20,
      updated_at: 20
    },
    {
      id: "task-3",
      slug: "task-3",
      title: "Gamma",
      description: "Third task",
      skill_domain: "DBT",
      base_difficulty: 4,
      general_objective: null,
      tags: ["advanced"],
      language: "es",
      is_published: false,
      parent_task_id: null,
      created_at: 30,
      updated_at: 30
    }
  ]);

  const response = await app.request("/api/v1/tasks/languages");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.languages, ["en", "fr"]);

  await rm(tempDir, { recursive: true, force: true });
});

test("GET /api/v1/tasks filters by published, language, skill_domain, tags, and sorts", async () => {
  const { app, db, tempDir } = await createApp();
  await db.insert(tasks).values([
    {
      id: "task-a",
      slug: "task-a",
      title: "Alpha Task",
      description: "First",
      skill_domain: "CBT",
      base_difficulty: 2,
      general_objective: null,
      tags: ["anxiety", "intro"],
      language: "en",
      is_published: true,
      parent_task_id: null,
      created_at: 100,
      updated_at: 100
    },
    {
      id: "task-b",
      slug: "task-b",
      title: "Beta Task",
      description: "Second",
      skill_domain: "CBT",
      base_difficulty: 4,
      general_objective: null,
      tags: ["stress"],
      language: "en",
      is_published: true,
      parent_task_id: null,
      created_at: 200,
      updated_at: 200
    },
    {
      id: "task-c",
      slug: "task-c",
      title: "Gamma Task",
      description: "Third",
      skill_domain: "DBT",
      base_difficulty: 3,
      general_objective: null,
      tags: ["anxiety"],
      language: "fr",
      is_published: false,
      parent_task_id: null,
      created_at: 300,
      updated_at: 300
    }
  ]);

  const response = await app.request(
    "/api/v1/tasks?published=1&language=en&skill_domain=CBT&tags=anxiety,stress&sort=title_desc"
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.length, 2);
  assert.equal(body[0].title, "Beta Task");
  assert.equal(body[1].title, "Alpha Task");

  await rm(tempDir, { recursive: true, force: true });
});
