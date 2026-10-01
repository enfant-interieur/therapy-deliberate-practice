import {
  TEST_AUTH_SECRET,
  createAuthTestEnv,
  createManagedSessionHeaders,
} from "./authFixture";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { resolveEnv } from "../src/env";
import {
  attempts,
  minigamePlayers,
  minigameRoundResults,
  minigameRounds,
  minigameSessions,
  taskCriteria,
  taskExamples,
  tasks,
  userSettings,
  users,
} from "../src/db/schema";

const createAuthHeader = async (
  db: Parameters<typeof createManagedSessionHeaders>[0],
) => ({
  ...(await createManagedSessionHeaders(db, createAuthTestEnv(), "learner", {
    email: "learner@example.com",
  })),
  "Content-Type": "application/json",
});

test("the winning claimed-attempt completion atomically binds its transcript and evaluation", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-attempt-transcript-atomicity-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  const originalFetch = globalThis.fetch;
  const firstTranscript = "The first concurrent transcript.";
  const winningTranscript = "The second concurrent transcript wins.";
  let claimedAttemptId = "";
  let providerCalls = 0;
  let releaseFirstProvider!: () => void;
  const firstProviderGate = new Promise<void>((resolve) => {
    releaseFirstProvider = resolve;
  });
  let markFirstProviderStarted!: () => void;
  const firstProviderStarted = new Promise<void>((resolve) => {
    markFirstProviderStarted = resolve;
  });

  try {
    globalThis.fetch = async () => {
      providerCalls += 1;
      const call = providerCalls;
      const transcriptText = call === 1 ? firstTranscript : winningTranscript;
      if (call === 1) {
        markFirstProviderStarted();
        await firstProviderGate;
      }
      const score = call === 1 ? 2 : 4;
      const evaluation = {
        version: "2.0",
        task_id: "task",
        example_id: "example",
        attempt_id: claimedAttemptId,
        transcript: { text: transcriptText },
        criterion_scores: [
          {
            criterion_id: "criterion",
            score,
            rationale_short: `Concurrent evaluation ${call}.`,
          },
        ],
        overall: {
          score,
          pass: call !== 1,
          summary_feedback: `Concurrent evaluation ${call}.`,
          what_to_improve_next: ["Stay concise."],
        },
        patient_reaction: { emotion: "engaged", intensity: 2 },
      };
      return new Response(
        JSON.stringify({
          id: `response-concurrent-${call}`,
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: JSON.stringify(evaluation) },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-request-id": `request-concurrent-${call}`,
          },
        },
      );
    };

    const app = createApiApp({
      env: resolveEnv({
        ENV: "test",
        AUTH_SECRET: TEST_AUTH_SECRET,
        AUTH_BASE_URL: "http://localhost",
        OPENAI_API_KEY: `attempt-transcript-${path.basename(tempDirectory)}`,
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
    const now = Date.now();
    await db.insert(users).values({
      id: "learner",
      email: "learner@example.com",
      display_name: "Learner",
      bio: null,
      created_at: now,
    });
    await db.insert(userSettings).values({
      user_id: "learner",
      ai_mode: "openai_only",
      local_base_url: null,
      local_stt_url: null,
      local_llm_url: null,
      store_audio: false,
      openai_key_ciphertext: null,
      openai_key_iv: null,
      openai_key_kid: null,
      updated_at: now,
      created_at: now,
    });
    await db.insert(tasks).values({
      id: "task",
      slug: "task",
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
    await db.insert(taskCriteria).values({
      task_id: "task",
      id: "criterion",
      label: "Criterion",
      description: "Respond accurately.",
      rubric: null,
      sort_order: 0,
    });
    await db.insert(taskExamples).values({
      id: "example",
      task_id: "task",
      difficulty: 2,
      severity_label: null,
      patient_text: "I am uncertain.",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    });
    await db.insert(minigameSessions).values({
      id: "game",
      user_id: "learner",
      game_type: "ffa",
      visibility_mode: "normal",
      task_selection: { strategy: "manual", task_ids: ["task"] },
      settings: {},
      created_at: now,
      ended_at: null,
      last_active_at: now,
      current_round_id: "round",
      current_player_id: "player",
      deleted_at: null,
    });
    await db.insert(minigamePlayers).values({
      id: "player",
      session_id: "game",
      name: "Player",
      avatar: "astro",
      team_id: null,
      created_at: now,
    });
    await db.insert(minigameRounds).values({
      id: "round",
      session_id: "game",
      position: 0,
      task_id: "task",
      example_id: "example",
      player_a_id: "player",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "active",
      started_at: now,
      completed_at: null,
    });

    const headers = await createAuthHeader(db);
    const claimResponse = await app.request(
      "/api/v1/minigames/sessions/game/rounds/round/submit",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          player_id: "player",
          transcript_text: "Prepared incomplete transcript.",
          skip_scoring: true,
          mode: "openai_only",
        }),
      },
    );
    assert.equal(claimResponse.status, 200);
    claimedAttemptId = ((await claimResponse.json()) as { attemptId: string })
      .attemptId;

    const submit = (transcriptText: string) =>
      app.request("/api/v1/minigames/sessions/game/rounds/round/submit", {
        method: "POST",
        headers,
        body: JSON.stringify({
          player_id: "player",
          attempt_id: claimedAttemptId,
          transcript_text: transcriptText,
          mode: "openai_only",
        }),
      });
    const firstResponsePromise = submit(firstTranscript);
    await firstProviderStarted;
    const winningResponse = await submit(winningTranscript);
    releaseFirstProvider();
    const losingResponse = await firstResponsePromise;

    assert.equal(winningResponse.status, 200);
    assert.equal(losingResponse.status, 200);
    assert.equal(providerCalls, 2);
    const winningPayload = (await winningResponse.json()) as {
      attemptId: string;
      transcript: { text: string };
      scoring: { evaluation: { transcript: { text: string } } };
      adjusted_score: number;
    };
    const losingPayload =
      (await losingResponse.json()) as typeof winningPayload;
    for (const payload of [winningPayload, losingPayload]) {
      assert.equal(payload.attemptId, claimedAttemptId);
      assert.equal(payload.transcript.text, winningTranscript);
      assert.equal(
        payload.scoring.evaluation.transcript.text,
        winningTranscript,
      );
      assert.equal(payload.adjusted_score, 4);
    }

    const [storedAttempt] = await db
      .select({
        transcript: attempts.transcript,
        evaluation: attempts.evaluation,
        overall_score: attempts.overall_score,
      })
      .from(attempts)
      .where(eq(attempts.id, claimedAttemptId));
    assert.equal(storedAttempt?.transcript, winningTranscript);
    assert.equal(storedAttempt?.overall_score, 4);
    assert.equal(
      (
        storedAttempt?.evaluation as {
          transcript?: { text?: string };
        }
      )?.transcript?.text,
      winningTranscript,
    );
    assert.equal(
      (
        await db
          .select()
          .from(minigameRoundResults)
          .where(eq(minigameRoundResults.round_id, "round"))
      ).length,
      1,
    );
  } finally {
    releaseFirstProvider?.();
    globalThis.fetch = originalFetch;
    sqlite.close();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
