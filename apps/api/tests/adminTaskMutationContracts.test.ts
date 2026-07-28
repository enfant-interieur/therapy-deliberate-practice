import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import {
  attempts,
  minigameSessions,
  practiceSessionItems,
  practiceSessions,
  taskCriteria,
  taskExamples,
  tasks,
} from "../src/db/schema";
import { resolveEnv } from "../src/env";

const buildTaskPayload = (now: number) => ({
  id: "task-1",
  slug: "task-1-updated",
  title: "Updated task",
  description: "Updated description",
  skill_domain: "validation",
  base_difficulty: 3,
  general_objective: null,
  tags: ["updated"],
  language: "en",
  is_published: true,
  parent_task_id: null,
  created_at: now,
  updated_at: now,
  criteria: [
    {
      id: "criterion-new",
      label: "New criterion",
      description: "New description",
    },
  ],
  examples: [
    {
      id: "example-new",
      difficulty: 3,
      severity_label: null,
      patient_text: "FAIL",
      language: "en",
      meta: null,
    },
  ],
  interaction_examples: [],
});

test("administrator task replacement is atomic and referenced tasks cannot be deleted", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-admin-task-mutations-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const app = createApiApp({
    env: resolveEnv({ ENV: "development", BYPASS_ADMIN_AUTH: "true" }),
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
    const sqliteUser = new Database(dbPath);
    sqliteUser
      .prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("learner-1", "learner@example.com", "Learner", now);
    sqliteUser.close();
    await db.insert(tasks).values([
      {
        id: "task-1",
        slug: "task-1",
        title: "Original task",
        description: "Original description",
        skill_domain: "validation",
        base_difficulty: 2,
        general_objective: null,
        tags: ["original"],
        language: "en",
        is_published: true,
        parent_task_id: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "task-delete",
        slug: "task-delete",
        title: "Disposable task",
        description: "No learner history",
        skill_domain: "validation",
        base_difficulty: 2,
        general_objective: null,
        tags: [],
        language: "en",
        is_published: false,
        parent_task_id: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "task-manual-history",
        slug: "task-manual-history",
        title: "Manual-session task",
        description: "Referenced only in saved selection JSON",
        skill_domain: "validation",
        base_difficulty: 2,
        general_objective: null,
        tags: [],
        language: "en",
        is_published: true,
        parent_task_id: null,
        created_at: now,
        updated_at: now,
      },
    ]);
    await db.insert(taskCriteria).values([
      {
        id: "criterion-original",
        task_id: "task-1",
        label: "Original criterion",
        description: "Original description",
        rubric: null,
        sort_order: 0,
      },
      {
        id: "criterion-delete",
        task_id: "task-delete",
        label: "Disposable criterion",
        description: "Disposable description",
        rubric: null,
        sort_order: 0,
      },
    ]);
    await db.insert(taskExamples).values([
      {
        id: "example-original",
        task_id: "task-1",
        difficulty: 2,
        severity_label: null,
        patient_text: "Original prompt",
        language: "en",
        meta: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "example-delete",
        task_id: "task-delete",
        difficulty: 2,
        severity_label: null,
        patient_text: "Disposable prompt",
        language: "en",
        meta: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TRIGGER reject_failed_example
      BEFORE INSERT ON task_examples
      WHEN NEW.patient_text = 'FAIL'
      BEGIN
        SELECT RAISE(ABORT, 'forced child replacement failure');
      END;
    `);
    sqlite.close();

    const failedUpdate = await app.request("/api/v1/admin/tasks/task-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildTaskPayload(now)),
    });
    assert.equal(failedUpdate.status, 500);

    const [taskAfterFailure] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, "task-1"));
    assert.equal(taskAfterFailure.title, "Original task");
    assert.equal(taskAfterFailure.slug, "task-1");
    assert.deepEqual(
      (
        await db
          .select({ id: taskCriteria.id })
          .from(taskCriteria)
          .where(eq(taskCriteria.task_id, "task-1"))
      ).map((row) => row.id),
      ["criterion-original"],
    );
    assert.deepEqual(
      (
        await db
          .select({ id: taskExamples.id })
          .from(taskExamples)
          .where(eq(taskExamples.task_id, "task-1"))
      ).map((row) => row.id),
      ["example-original"],
    );

    await db.insert(attempts).values({
      id: "attempt-history",
      user_id: "learner-1",
      session_id: null,
      session_item_id: null,
      task_id: "task-1",
      example_id: "example-original",
      started_at: now,
      completed_at: null,
      audio_ref: null,
      transcript: "",
      evaluation: {},
      overall_pass: false,
      overall_score: 0,
      score_trust: "local_unverified",
      model_info: null,
    });
    await db.insert(practiceSessions).values({
      id: "practice-history",
      user_id: "learner-1",
      mode: "single_task",
      source_task_id: "task-1",
      random_seed: null,
      created_at: now,
      ended_at: now,
    });
    await db.insert(practiceSessionItems).values({
      id: "practice-item-history",
      session_id: "practice-history",
      position: 0,
      task_id: "task-1",
      example_id: "example-original",
      target_difficulty: 2,
      created_at: now,
    });
    const [attemptBeforeUpdate] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.id, "attempt-history"));
    const [itemBeforeUpdate] = await db
      .select()
      .from(practiceSessionItems)
      .where(eq(practiceSessionItems.id, "practice-item-history"));
    const [exampleBeforeUpdate] = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.id, "example-original"));

    const safePayload = {
      ...buildTaskPayload(now),
      examples: [
        {
          id: "example-original",
          difficulty: 2,
          severity_label: null,
          patient_text: "Original prompt",
          language: "en",
          meta: null,
        },
      ],
    };
    const safeUpdate = await app.request("/api/v1/admin/tasks/task-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(safePayload),
    });
    assert.equal(safeUpdate.status, 200);
    const [attemptAfterUpdate] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.id, "attempt-history"));
    const [itemAfterUpdate] = await db
      .select()
      .from(practiceSessionItems)
      .where(eq(practiceSessionItems.id, "practice-item-history"));
    const [exampleAfterUpdate] = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.id, "example-original"));
    assert.deepEqual(attemptAfterUpdate, attemptBeforeUpdate);
    assert.deepEqual(itemAfterUpdate, itemBeforeUpdate);
    assert.deepEqual(exampleAfterUpdate, exampleBeforeUpdate);

    const historyRewrite = await app.request("/api/v1/admin/tasks/task-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...safePayload,
        examples: [
          {
            ...safePayload.examples[0],
            patient_text: "Rewritten historical prompt",
          },
        ],
      }),
    });
    assert.equal(historyRewrite.status, 409);

    await db.insert(minigameSessions).values({
      id: "manual-history",
      user_id: "learner-1",
      game_type: "ffa",
      visibility_mode: "normal",
      task_selection: {
        strategy: "manual",
        task_ids: ["task-manual-history"],
      },
      settings: {},
      created_at: now,
      ended_at: now,
      last_active_at: now,
      current_round_id: null,
      current_player_id: null,
      deleted_at: null,
    });
    await db
      .update(tasks)
      .set({ is_published: false, updated_at: Date.now() })
      .where(eq(tasks.id, "task-manual-history"));
    const manualHistoryDelete = await app.request(
      "/api/v1/admin/tasks/task-manual-history",
      { method: "DELETE" },
    );
    assert.equal(manualHistoryDelete.status, 409);

    const referencedDelete = await app.request("/api/v1/admin/tasks/task-1", {
      method: "DELETE",
    });
    assert.equal(referencedDelete.status, 409);
    assert.equal(
      (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, "task-1"))
      ).length,
      1,
    );
    assert.equal(
      (
        await db
          .select({ id: attempts.id })
          .from(attempts)
          .where(eq(attempts.id, "attempt-history"))
      ).length,
      1,
    );

    const disposableDelete = await app.request(
      "/api/v1/admin/tasks/task-delete",
      { method: "DELETE" },
    );
    assert.equal(disposableDelete.status, 200);
    assert.equal(
      (
        await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.id, "task-delete"))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select({ id: taskCriteria.id })
          .from(taskCriteria)
          .where(eq(taskCriteria.task_id, "task-delete"))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select({ id: taskExamples.id })
          .from(taskExamples)
          .where(eq(taskExamples.task_id, "task-delete"))
      ).length,
      0,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
