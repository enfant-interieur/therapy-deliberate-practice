import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import {
  attempts,
  practiceSessionItems,
  practiceSessions,
  taskExamples,
  tasks,
  users,
} from "../src/db/schema";
import { createSqliteDb } from "../src/db/sqlite";
import { resolveEnv } from "../src/env";

const jwtSecret = "practice-session-atomic-route-secret";

const authHeaders = async (userId: string) => {
  const token = await new SignJWT({ email: `${userId}@example.com` })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(jwtSecret));
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

test("practice-session writes roll back atomically and preserve cross-user ownership", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-practice-session-atomic-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const app = createApiApp({
    env: resolveEnv({
      ENV: "test",
      SUPABASE_JWT_SECRET: jwtSecret,
    }),
    db,
    tts: {
      storage: {
        headObject: async () => ({ exists: false }),
        putObject: async () => ({}),
        getObject: async () => ({
          body: new Uint8Array(),
          contentType: "audio/mpeg",
        }),
      },
    },
  });

  try {
    const now = Date.now();
    await db.insert(users).values([
      {
        id: "user-1",
        email: "user-1@example.com",
        display_name: "User One",
        bio: null,
        created_at: now,
      },
      {
        id: "user-2",
        email: "user-2@example.com",
        display_name: "User Two",
        bio: null,
        created_at: now,
      },
    ]);
    await db.insert(tasks).values({
      id: "task-1",
      slug: "task-1",
      title: "Atomic session task",
      description: "Exercises session transaction boundaries.",
      skill_domain: "validation",
      base_difficulty: 2,
      general_objective: null,
      tags: ["test"],
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
      patient_text: "I am worried about the next step.",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    });

    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TRIGGER reject_practice_item_insert
      BEFORE INSERT ON practice_session_items
      BEGIN
        SELECT RAISE(ABORT, 'forced practice-session child insert failure');
      END;
    `);
    sqlite.close();

    const userOneHeaders = await authHeaders("user-1");
    const failedStart = await app.request("/api/v1/sessions/start", {
      method: "POST",
      headers: userOneHeaders,
      body: JSON.stringify({
        mode: "single_task",
        task_id: "task-1",
        item_count: 1,
      }),
    });
    assert.equal(failedStart.status, 500);
    assert.equal((await db.select().from(practiceSessions)).length, 0);
    assert.equal((await db.select().from(practiceSessionItems)).length, 0);

    const sqliteAfterStart = new Database(dbPath);
    sqliteAfterStart.exec("DROP TRIGGER reject_practice_item_insert");
    sqliteAfterStart.close();

    await db.insert(practiceSessions).values([
      {
        id: "owned-session",
        user_id: "user-1",
        mode: "single_task",
        source_task_id: "task-1",
        random_seed: "owned-seed",
        created_at: now + 1,
        ended_at: null,
      },
      {
        id: "other-session",
        user_id: "user-2",
        mode: "single_task",
        source_task_id: "task-1",
        random_seed: "other-seed",
        created_at: now + 2,
        ended_at: null,
      },
    ]);
    await db.insert(practiceSessionItems).values([
      {
        id: "owned-item",
        session_id: "owned-session",
        position: 0,
        task_id: "task-1",
        example_id: "example-1",
        target_difficulty: 2,
        created_at: now + 1,
      },
      {
        id: "other-item",
        session_id: "other-session",
        position: 0,
        task_id: "task-1",
        example_id: "example-1",
        target_difficulty: 2,
        created_at: now + 2,
      },
    ]);
    await db.insert(attempts).values([
      {
        id: "owned-attempt",
        user_id: "user-1",
        session_id: "owned-session",
        session_item_id: "owned-item",
        task_id: "task-1",
        example_id: "example-1",
        started_at: now + 1,
        completed_at: now + 3,
        audio_ref: null,
        transcript: "",
        evaluation: {},
        overall_pass: false,
        overall_score: 0,
        score_trust: "local_unverified",
        model_info: {
          provider: { llm: { kind: "openai", model: "historical-evaluator" } },
          timing_ms: { llm: 123 },
        },
      },
      {
        id: "other-attempt",
        user_id: "user-2",
        session_id: "other-session",
        session_item_id: "other-item",
        task_id: "task-1",
        example_id: "example-1",
        started_at: now + 2,
        completed_at: null,
        audio_ref: null,
        transcript: "",
        evaluation: {},
        overall_pass: false,
        overall_score: 0,
        score_trust: "local_unverified",
        model_info: null,
      },
    ]);

    const resumed = await app.request(
      "/api/v1/sessions/owned-session/attempts",
      {
        headers: userOneHeaders,
      },
    );
    assert.equal(resumed.status, 200);
    const resumedAttempts = (await resumed.json()) as Array<
      Record<string, unknown>
    >;
    assert.equal(resumedAttempts.length, 1);
    assert.deepEqual(resumedAttempts[0]?.scoring_provider, {
      kind: "openai",
      model: "historical-evaluator",
    });
    assert.equal("model_info" in resumedAttempts[0]!, false);
    const otherUserResume = await app.request(
      "/api/v1/sessions/owned-session/attempts",
      {
        headers: await authHeaders("user-2"),
      },
    );
    assert.equal(otherUserResume.status, 404);
    await db
      .update(attempts)
      .set({ model_info: null })
      .where(eq(attempts.id, "owned-attempt"));
    const legacyResume = await app.request(
      "/api/v1/sessions/owned-session/attempts",
      {
        headers: userOneHeaders,
      },
    );
    const legacyAttempts = (await legacyResume.json()) as Array<
      Record<string, unknown>
    >;
    assert.equal(legacyAttempts[0]?.scoring_provider, null);

    const sqliteBeforeDelete = new Database(dbPath);
    sqliteBeforeDelete.exec(`
      CREATE TRIGGER reject_owned_practice_item_delete
      BEFORE DELETE ON practice_session_items
      WHEN OLD.session_id = 'owned-session'
      BEGIN
        SELECT RAISE(ABORT, 'forced practice-session child delete failure');
      END;
    `);
    sqliteBeforeDelete.close();

    const failedDelete = await app.request("/api/v1/sessions/owned-session", {
      method: "DELETE",
      headers: userOneHeaders,
    });
    assert.equal(failedDelete.status, 500);
    assert.equal(
      (await db.select().from(attempts).where(eq(attempts.id, "owned-attempt")))
        .length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(practiceSessionItems)
          .where(eq(practiceSessionItems.id, "owned-item"))
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(practiceSessions)
          .where(eq(practiceSessions.id, "owned-session"))
      ).length,
      1,
    );

    const sqliteAfterDelete = new Database(dbPath);
    sqliteAfterDelete.exec("DROP TRIGGER reject_owned_practice_item_delete");
    sqliteAfterDelete.close();

    const crossUserDelete = await app.request(
      "/api/v1/sessions/other-session",
      {
        method: "DELETE",
        headers: userOneHeaders,
      },
    );
    assert.equal(crossUserDelete.status, 404);
    assert.equal(
      (
        await db
          .select()
          .from(practiceSessions)
          .where(
            and(
              eq(practiceSessions.id, "other-session"),
              eq(practiceSessions.user_id, "user-2"),
            ),
          )
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select()
          .from(practiceSessionItems)
          .where(eq(practiceSessionItems.id, "other-item"))
      ).length,
      1,
    );
    assert.equal(
      (await db.select().from(attempts).where(eq(attempts.id, "other-attempt")))
        .length,
      1,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
