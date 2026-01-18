import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliberatePracticeTaskV2, LlmProvider } from "@deliberate/shared";
import { createApiApp } from "../src/app";
import { resolveEnv } from "../src/env";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import { taskInteractionExamples } from "../src/db/schema";
import { eq } from "drizzle-orm";

const createTempDb = async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(path.join(__dirname, "tmp-"));
  const dbPath = path.join(tempDir, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  return { db, dbPath, tempDir };
};

test("translating a task sends interaction examples to the LLM and persists translations", async () => {
  const { db, tempDir } = await createTempDb();
  const env = resolveEnv({
    ENV: "development",
    BYPASS_ADMIN_AUTH: "true",
    OPENAI_API_KEY: "test-key",
    AI_MODE: "openai_only"
  });
  const storage = {
    headObject: async () => ({ exists: false }),
    putObject: async () => ({}),
    getObject: async () => ({ body: new Uint8Array(), contentType: "audio/mpeg" })
  };

  const translateCalls: Array<{
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }> = [];
  const fakeProvider: LlmProvider = {
    kind: "openai",
    model: "fake-translate",
    healthCheck: async () => true,
    evaluateDeliberatePractice: async () => {
      throw new Error("not implemented");
    },
    parseExercise: async () => {
      throw new Error("not implemented");
    },
    translateTask: async (input) => {
      translateCalls.push(input);
      return {
        ...input.source,
        task: {
          ...input.source.task,
          language: input.targetLanguage
        },
        examples: input.source.examples.map((example) => ({
          ...example,
          language: input.targetLanguage
        })),
        interaction_examples: input.source.interaction_examples
      };
    }
  };

  const app = createApiApp({
    env,
    db,
    tts: { storage },
    providerOverrides: {
      selectLlmProvider: async () => ({
        provider: fakeProvider,
        health: { local: false, openai: true }
      })
    }
  });

  try {
    const payload = {
      task_v2: {
        version: "2.1",
        task: {
          title: "Interaction Example Task",
          description: "Practice short, high-quality responses.",
          skill_domain: "Therapy Skills",
          base_difficulty: 3,
          general_objective: null,
          tags: ["demo"],
          language: "en"
        },
        criteria: [
          {
            id: "c1",
            label: "Validate",
            description: "Reflect emotion and need.",
            rubric: {
              score_min: 0,
              score_max: 4,
              anchors: [
                { score: 0, meaning: "Misses emotion." },
                { score: 2, meaning: "Partially validates." },
                { score: 4, meaning: "Clearly validates." }
              ]
            }
          }
        ],
        examples: [
          {
            id: "ex1",
            difficulty: 2,
            severity_label: null,
            patient_text: "I need to hear I'm okay.",
            language: "en",
            meta: null
          }
        ],
        interaction_examples: [
          {
            id: "ix1",
            difficulty: 3,
            title: "Warmth with boundaries",
            patient_text: "Can you tell me I'm not too much?",
            therapist_text:
              "I hear how tender that feels, and I care about you. I can offer support here, and we can also build your own steadying tools so you feel held between sessions. Let's name the need and pick one small self-soothing step you can take today."
          }
        ]
      }
    };

    const importResponse = await app.request("/api/v1/admin/import-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(importResponse.status, 200);
    const importBody = await importResponse.json();
    assert.ok(importBody.id);

    const translateResponse = await app.request(
      `/api/v1/admin/tasks/${importBody.id}/translate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target_language: "fr" })
      }
    );
    assert.equal(translateResponse.status, 200);
    const translateBody = await translateResponse.json();
    assert.ok(translateBody.id);

    assert.equal(translateCalls.length, 1);
    const call = translateCalls[0];
    assert.equal(call.source.interaction_examples?.length, 1);
    assert.equal(call.targetLanguage, "fr");

    const persistedInteractions = await db
      .select()
      .from(taskInteractionExamples)
      .where(eq(taskInteractionExamples.task_id, translateBody.id));
    assert.equal(persistedInteractions.length, 1);
    assert.equal(persistedInteractions[0].language, "fr");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
