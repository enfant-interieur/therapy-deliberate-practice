import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import {
  taskCriteria,
  taskExamples,
  taskInteractionExamples,
  tasks,
} from "../src/db/schema";
import { createSqliteDb } from "../src/db/sqlite";
import { resolveEnv } from "../src/env";

const adminHeaders = { "Content-Type": "application/json" };

const createPayload = (
  title: string,
  criterionId: string,
  exampleId: string,
  interactionId = `${exampleId}-interaction`,
  therapistText = "Test therapist response.",
) => ({
  title,
  description: "Exercises administrator transaction boundaries.",
  skill_domain: "validation",
  base_difficulty: 2,
  general_objective: null,
  tags: ["test"],
  language: "en",
  is_published: false,
  criteria: [
    {
      id: criterionId,
      label: "FAIL-CREATE",
      description: "A child insert failure must roll back the parent.",
    },
  ],
  examples: [
    {
      id: exampleId,
      difficulty: 2,
      severity_label: null,
      patient_text: "Test patient prompt.",
      language: "en",
      meta: null,
    },
  ],
  interaction_examples: [
    {
      id: interactionId,
      difficulty: 2,
      title: "Test interaction",
      patient_text: "Test interaction prompt.",
      therapist_text: therapistText,
    },
  ],
});

test("administrator create, duplicate, and translate routes roll back failed child writes", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-admin-create-atomic-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const app = createApiApp({
    env: resolveEnv({
      ENV: "development",
      BYPASS_ADMIN_AUTH: "true",
      OPENAI_API_KEY: "test-openai-key",
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
  const originalFetch = globalThis.fetch;

  try {
    const now = Date.now();
    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TRIGGER reject_admin_create_criterion
      BEFORE INSERT ON task_criteria
      WHEN NEW.label = 'FAIL-CREATE'
      BEGIN
        SELECT RAISE(ABORT, 'forced administrator create child failure');
      END;
    `);
    sqlite.close();

    const failedCreate = await app.request("/api/v1/admin/tasks", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(
        createPayload(
          "Create must roll back",
          "criterion-create",
          "example-create",
        ),
      ),
    });
    assert.equal(failedCreate.status, 500);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.title, "Create must roll back"))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(taskCriteria)
          .where(eq(taskCriteria.id, "criterion-create"))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(taskExamples)
          .where(eq(taskExamples.id, "example-create"))
      ).length,
      0,
    );

    const sqliteAfterCreate = new Database(dbPath);
    sqliteAfterCreate.exec("DROP TRIGGER reject_admin_create_criterion");
    sqliteAfterCreate.exec(`
      CREATE TRIGGER reject_admin_create_interaction
      BEFORE INSERT ON task_interaction_examples
      WHEN NEW.therapist_text = 'FAIL-CREATE-INTERACTION'
      BEGIN
        SELECT RAISE(ABORT, 'forced administrator create interaction failure');
      END;
    `);
    sqliteAfterCreate.close();

    const failedInteractionCreate = await app.request("/api/v1/admin/tasks", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(
        createPayload(
          "Interaction create must roll back",
          "criterion-interaction-failure",
          "example-interaction-failure",
          "interaction-failure",
          "FAIL-CREATE-INTERACTION",
        ),
      ),
    });
    assert.equal(failedInteractionCreate.status, 500);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.title, "Interaction create must roll back"))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(taskInteractionExamples)
          .where(eq(taskInteractionExamples.id, "interaction-failure"))
      ).length,
      0,
    );

    const sqliteAfterInteractionCreate = new Database(dbPath);
    sqliteAfterInteractionCreate.exec(
      "DROP TRIGGER reject_admin_create_interaction",
    );
    sqliteAfterInteractionCreate.close();

    const duplicateChildId = await app.request("/api/v1/admin/tasks", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(
        createPayload(
          "Duplicate child identifiers",
          "shared-child-id",
          "shared-child-id",
        ),
      ),
    });
    assert.equal(duplicateChildId.status, 409);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.title, "Duplicate child identifiers"))
      ).length,
      0,
    );

    const duplicateInteractionId = await app.request("/api/v1/admin/tasks", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(
        createPayload(
          "Duplicate interaction identifier",
          "shared-interaction-id",
          "distinct-example-id",
          "shared-interaction-id",
        ),
      ),
    });
    assert.equal(duplicateInteractionId.status, 409);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.title, "Duplicate interaction identifier"))
      ).length,
      0,
    );

    await db.insert(tasks).values({
      id: "source-task",
      slug: "source-task",
      title: "Source task",
      description: "Source for duplication and translation.",
      skill_domain: "validation",
      base_difficulty: 2,
      general_objective: null,
      tags: ["source"],
      language: "en",
      is_published: false,
      parent_task_id: null,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskCriteria).values({
      id: "source-criterion",
      task_id: "source-task",
      label: "Source criterion",
      description: "Reflect the concern.",
      rubric: null,
      sort_order: 0,
    });
    await db.insert(taskExamples).values({
      id: "source-example",
      task_id: "source-task",
      difficulty: 2,
      severity_label: null,
      patient_text: "Duplicate source prompt",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskInteractionExamples).values({
      id: "source-interaction",
      task_id: "source-task",
      difficulty: 2,
      title: "Source interaction",
      patient_text: "Can we talk about this?",
      therapist_text: "Yes, let us slow down and understand it together.",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    });

    const sqliteBeforeDuplicate = new Database(dbPath);
    sqliteBeforeDuplicate.exec(`
      CREATE TRIGGER reject_admin_duplicate_example
      BEFORE INSERT ON task_examples
      WHEN NEW.task_id <> 'source-task'
        AND NEW.patient_text = 'Duplicate source prompt'
      BEGIN
        SELECT RAISE(ABORT, 'forced administrator duplicate child failure');
      END;
    `);
    sqliteBeforeDuplicate.close();

    const failedDuplicate = await app.request(
      "/api/v1/admin/tasks/source-task/duplicate",
      {
        method: "POST",
        headers: adminHeaders,
      },
    );
    assert.equal(failedDuplicate.status, 500);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.title, "Source task (Copy)"))
      ).length,
      0,
    );

    const sqliteAfterDuplicate = new Database(dbPath);
    sqliteAfterDuplicate.exec("DROP TRIGGER reject_admin_duplicate_example");
    sqliteAfterDuplicate.exec(`
      CREATE TRIGGER reject_admin_translation_interaction
      BEFORE INSERT ON task_interaction_examples
      WHEN NEW.therapist_text = 'FAIL-TRANSLATE'
      BEGIN
        SELECT RAISE(ABORT, 'forced administrator translation child failure');
      END;
    `);
    sqliteAfterDuplicate.close();

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "response-admin-translation",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    version: "2.1",
                    task: {
                      title: "Tâche traduite",
                      description:
                        "Une tâche traduite pour vérifier la transaction.",
                      skill_domain: "validation",
                      base_difficulty: 2,
                      general_objective: null,
                      tags: ["traduction"],
                      language: "fr",
                    },
                    criteria: [
                      {
                        id: "source-criterion",
                        label: "Critère traduit",
                        description: "Refléter la préoccupation.",
                      },
                    ],
                    examples: [
                      {
                        id: "source-example",
                        difficulty: 2,
                        severity_label: null,
                        patient_text: "Exemple traduit.",
                        language: "fr",
                        meta: null,
                      },
                    ],
                    interaction_examples: [
                      {
                        id: "source-interaction",
                        difficulty: 2,
                        title: "Interaction traduite",
                        patient_text: "Pouvons-nous en parler ?",
                        therapist_text: "FAIL-TRANSLATE",
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": "request-admin-translation",
          },
        },
      );

    const failedTranslation = await app.request(
      "/api/v1/admin/tasks/source-task/translate",
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ target_language: "fr" }),
      },
    );
    assert.equal(failedTranslation.status, 500);
    assert.equal(
      (
        await db
          .select()
          .from(tasks)
          .where(eq(tasks.parent_task_id, "source-task"))
      ).length,
      0,
    );
    assert.equal(
      (
        await db
          .select()
          .from(taskInteractionExamples)
          .where(eq(taskInteractionExamples.therapist_text, "FAIL-TRANSLATE"))
      ).length,
      0,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
