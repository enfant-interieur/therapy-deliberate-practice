import {
  TEST_AUTH_SECRET,
  createAuthTestEnv,
  createManagedSessionHeaders,
} from "./authFixture";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { resolveEnv } from "../src/env";
import { MINIGAME_LIMITS } from "../src/services/minigameLimits";
import {
  attempts,
  minigamePlayers,
  minigameRoundResults,
  minigameRounds,
  minigameSessions,
  minigameSubmissionClaims,
  taskCriteria,
  taskExamples,
  tasks,
  userSettings,
  users,
} from "../src/db/schema";

const createAuthHeader = async (
  db: Parameters<typeof createManagedSessionHeaders>[0],
  userId: string,
) => ({
  ...(await createManagedSessionHeaders(db, createAuthTestEnv(), userId)),
  "Content-Type": "application/json",
});

const installOpenAiEvaluationMock = (attemptId: string) => {
  const evaluation = {
    version: "2.0",
    task_id: "task-1",
    example_id: "example-1",
    attempt_id: attemptId,
    transcript: { text: "A cloud-evaluated local transcript." },
    criterion_scores: [
      {
        criterion_id: "c1",
        score: 4,
        rationale_short: "Reflects the concern.",
      },
      { criterion_id: "c2", score: 4, rationale_short: "Invites exploration." },
    ],
    overall: {
      score: 4,
      pass: true,
      summary_feedback: "Strong cloud evaluation.",
      what_to_improve_next: ["Keep the invitation concise."],
    },
    patient_reaction: { emotion: "engaged", intensity: 2 },
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: `response-${attemptId}`,
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
          "x-request-id": `request-${attemptId}`,
        },
      },
    );
};

test("local practice is validated, private in history, and safely committed to a minigame", async () => {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "therapy-local-practice-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  try {
    const env = resolveEnv({
      ENV: "test",
      AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_BASE_URL: "http://localhost",
      OPENAI_API_KEY: "test-openai-key",
    });
    const app = createApiApp({
      env,
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
    await db.insert(userSettings).values([
      {
        user_id: "user-1",
        ai_mode: "local_only",
        local_base_url: "http://127.0.0.1:8484",
        local_stt_url: null,
        local_llm_url: null,
        store_audio: false,
        openai_key_ciphertext: null,
        openai_key_iv: null,
        openai_key_kid: null,
        updated_at: now,
        created_at: now,
      },
      {
        user_id: "user-2",
        ai_mode: "local_only",
        local_base_url: "http://127.0.0.1:8484",
        local_stt_url: null,
        local_llm_url: null,
        store_audio: false,
        openai_key_ciphertext: null,
        openai_key_iv: null,
        openai_key_kid: null,
        updated_at: now,
        created_at: now,
      },
    ]);
    await db.insert(tasks).values({
      id: "task-1",
      slug: "local-practice-task",
      title: "Local practice task",
      description: "Test local scoring.",
      skill_domain: "validation",
      base_difficulty: 2,
      general_objective: "Respond with validation.",
      tags: ["test"],
      language: "en",
      is_published: false,
      parent_task_id: null,
      created_at: now,
      updated_at: now,
    });
    await db.insert(taskCriteria).values([
      {
        id: "c1",
        task_id: "task-1",
        label: "Reflect",
        description: "Reflect the patient's concern.",
        rubric: null,
        sort_order: 0,
      },
      {
        id: "c2",
        task_id: "task-1",
        label: "Explore",
        description: "Invite further exploration.",
        rubric: null,
        sort_order: 1,
      },
    ]);
    await db.insert(taskExamples).values({
      id: "example-1",
      task_id: "task-1",
      difficulty: 2,
      severity_label: null,
      patient_text: "I do not know if I can manage this.",
      language: "en",
      meta: null,
      created_at: now,
      updated_at: now,
    });

    const userOneHeaders = await createAuthHeader(db, "user-1");
    const removedServerHealth = await app.request("/api/v1/health/local-ai", {
      headers: userOneHeaders,
    });
    assert.equal(removedServerHealth.status, 404);
    const publicUrlSettings = await app.request("/api/v1/me/settings", {
      method: "PUT",
      headers: userOneHeaders,
      body: JSON.stringify({
        aiMode: "local_only",
        localAiBaseUrl: "https://example.com",
        localSttUrl: null,
        localLlmUrl: null,
        storeAudio: false,
      }),
    });
    assert.equal(publicUrlSettings.status, 400);
    const splitOriginSettings = await app.request("/api/v1/me/settings", {
      method: "PUT",
      headers: userOneHeaders,
      body: JSON.stringify({
        aiMode: "local_only",
        localAiBaseUrl: null,
        localSttUrl: "http://127.0.0.1:8484",
        localLlmUrl: "http://127.0.0.1:8585",
        storeAudio: false,
      }),
    });
    assert.equal(splitOriginSettings.status, 400);
    const unpublishedResponse = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({ task_id: "task-1", example_id: "example-1" }),
      },
    );
    assert.equal(unpublishedResponse.status, 404);

    await db.update(tasks).set({ is_published: true });
    const oversizedAudioHeaders = {
      ...userOneHeaders,
      "content-length": String(24 * 1024 * 1024 + 1),
    };
    assert.equal(
      (
        await app.request("/api/v1/practice/run", {
          method: "POST",
          headers: oversizedAudioHeaders,
          body: "{}",
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await app.request(
          "/api/v1/minigames/sessions/missing/rounds/missing/submit",
          {
            method: "POST",
            headers: oversizedAudioHeaders,
            body: "{}",
          },
        )
      ).status,
      413,
    );
    assert.equal(
      (
        await app.request("/api/v1/practice/local/prepare", {
          method: "POST",
          headers: {
            ...userOneHeaders,
            "content-length": String(256 * 1024 + 1),
          },
          body: "{}",
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await app.request("/api/v1/practice/local/commit", {
          method: "POST",
          headers: {
            ...userOneHeaders,
            "content-length": String(2 * 1024 * 1024 + 1),
          },
          body: "{}",
        })
      ).status,
      413,
    );
    const oversizedSettings = await app.request("/api/v1/minigames/sessions", {
      method: "POST",
      headers: userOneHeaders,
      body: JSON.stringify({
        game_type: "tdm",
        visibility_mode: "normal",
        task_selection: {
          strategy: "manual",
          task_ids: ["task-1"],
          shuffle: true,
          seed: "limits",
        },
        settings: {
          rounds_per_player: MINIGAME_LIMITS.roundsPerPlayer + 1,
        },
      }),
    });
    assert.equal(oversizedSettings.status, 400);
    const oversizedSelectionValue = await app.request(
      "/api/v1/minigames/sessions",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          game_type: "ffa",
          visibility_mode: "normal",
          task_selection: {
            strategy: "manual",
            task_ids: ["x".repeat(MINIGAME_LIMITS.selectionValueLength + 1)],
          },
          settings: { rounds_per_player: 1 },
        }),
      },
    );
    assert.equal(oversizedSelectionValue.status, 400);
    const oversizedSessionBody = await app.request(
      "/api/v1/minigames/sessions",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          game_type: "ffa",
          visibility_mode: "normal",
          task_selection: {
            strategy: "manual",
            task_ids: ["task-1"],
            seed: "x".repeat(MINIGAME_LIMITS.mutationBodyBytes),
          },
          settings: { rounds_per_player: 1 },
        }),
      },
    );
    assert.equal(oversizedSessionBody.status, 413);

    const boundedSessionResponse = await app.request(
      "/api/v1/minigames/sessions",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          game_type: "ffa",
          visibility_mode: "normal",
          task_selection: {
            strategy: "manual",
            task_ids: ["task-1"],
            shuffle: true,
            seed: "limits-valid",
          },
          settings: { rounds_per_player: 1 },
        }),
      },
    );
    assert.equal(boundedSessionResponse.status, 200);
    const boundedSession = (await boundedSessionResponse.json()) as {
      session_id: string;
    };
    const oversizedTeamName = await app.request(
      `/api/v1/minigames/sessions/${boundedSession.session_id}/teams`,
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          teams: [
            {
              name: "x".repeat(MINIGAME_LIMITS.teamNameLength + 1),
              color: "#000",
            },
          ],
        }),
      },
    );
    assert.equal(oversizedTeamName.status, 400);
    const oversizedMutationBody = await app.request(
      `/api/v1/minigames/sessions/${boundedSession.session_id}/players`,
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          players: [
            {
              name: "Player",
              avatar: "x".repeat(MINIGAME_LIMITS.mutationBodyBytes),
              team_id: null,
            },
          ],
        }),
      },
    );
    assert.equal(oversizedMutationBody.status, 413);
    const oversizedPlayers = await app.request(
      `/api/v1/minigames/sessions/${boundedSession.session_id}/players`,
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          players: Array.from(
            { length: MINIGAME_LIMITS.players + 1 },
            (_, index) => ({
              name: `Player ${index}`,
              avatar: "avatar",
              team_id: null,
            }),
          ),
        }),
      },
    );
    assert.equal(oversizedPlayers.status, 400);
    const malformedGenerateBody = await app.request(
      `/api/v1/minigames/sessions/${boundedSession.session_id}/rounds/generate`,
      {
        method: "POST",
        headers: userOneHeaders,
        body: "{",
      },
    );
    assert.equal(malformedGenerateBody.status, 400);
    const roundsAfterMalformedGenerate = await db
      .select()
      .from(minigameRounds)
      .where(eq(minigameRounds.session_id, boundedSession.session_id));
    assert.equal(roundsAfterMalformedGenerate.length, 0);
    const oversizedGenerateBody = await app.request(
      `/api/v1/minigames/sessions/${boundedSession.session_id}/rounds/generate`,
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          count: 1,
          padding: "x".repeat(MINIGAME_LIMITS.mutationBodyBytes),
        }),
      },
    );
    assert.equal(oversizedGenerateBody.status, 413);
    const oversizedRoundBatch = await app.request(
      `/api/v1/minigames/sessions/${boundedSession.session_id}/rounds/generate`,
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          count: MINIGAME_LIMITS.ffaRoundBatch + 1,
        }),
      },
    );
    assert.equal(oversizedRoundBatch.status, 400);

    const prepareResponse = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({ task_id: "task-1", example_id: "example-1" }),
      },
    );
    assert.equal(prepareResponse.status, 200);
    const preparation = (await prepareResponse.json()) as {
      attemptId: string;
      score_trust: string;
    };
    assert.equal(preparation.score_trust, "local_unverified");

    const pendingHistory = await app.request("/api/v1/attempts", {
      headers: userOneHeaders,
    });
    assert.deepEqual(await pendingHistory.json(), []);

    const transcript =
      "It sounds overwhelming, and I wonder what feels hardest right now.";
    const buildLocalCommitBody = (attemptId: string) => ({
      attempt_id: attemptId,
      transcript: { text: transcript, model: "local-stt", duration_ms: 120 },
      evaluation: {
        version: "2.0",
        task_id: "task-1",
        example_id: "example-1",
        attempt_id: attemptId,
        transcript: { text: transcript },
        criterion_scores: [
          {
            criterion_id: "c1",
            score: 4,
            rationale_short: "Reflects overwhelm.",
          },
          {
            criterion_id: "c2",
            score: 2,
            rationale_short: "Offers a focused question.",
          },
        ],
        overall: {
          score: 0,
          pass: false,
          summary_feedback: "Tampered client totals must be ignored.",
          what_to_improve_next: ["Use a broader open question."],
        },
        patient_reaction: { emotion: "engaged", intensity: 2 },
      },
      llm: { model: "local-llm", duration_ms: 220 },
      practice_mode: "real_time",
    });

    const cloudPrepareResponse = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          task_id: "task-1",
          example_id: "example-1",
          input_mode: "audio",
          transcript: {
            text: "A cloud-evaluated local transcript.",
            model: "local-stt",
            duration_ms: 100,
          },
        }),
      },
    );
    assert.equal(cloudPrepareResponse.status, 200);
    const cloudPreparation = (await cloudPrepareResponse.json()) as {
      attemptId: string;
    };
    const standardOriginalFetch = globalThis.fetch;
    try {
      installOpenAiEvaluationMock(cloudPreparation.attemptId);
      const cloudFallbackResponse = await app.request("/api/v1/practice/run", {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          task_id: "task-1",
          example_id: "example-1",
          attempt_id: cloudPreparation.attemptId,
          transcript_text: "A cloud-evaluated local transcript.",
          mode: "openai_only",
        }),
      });
      assert.equal(cloudFallbackResponse.status, 200);
      const cloudFallback = (await cloudFallbackResponse.json()) as {
        score_trust: string;
        scoring: { provider: { kind: string } };
      };
      assert.equal(cloudFallback.scoring.provider.kind, "openai");
      assert.equal(cloudFallback.score_trust, "cloud_trusted");
    } finally {
      globalThis.fetch = standardOriginalFetch;
    }
    const [cloudAttempt] = await db
      .select({
        score_trust: attempts.score_trust,
        model_info: attempts.model_info,
      })
      .from(attempts)
      .where(eq(attempts.id, cloudPreparation.attemptId));
    assert.equal(cloudAttempt?.score_trust, "cloud_trusted");
    assert.equal(cloudAttempt?.model_info?.score_trust, "cloud_trusted");
    assert.equal(cloudAttempt?.model_info?.provider?.llm?.kind, "openai");

    const commitBody = buildLocalCommitBody(preparation.attemptId);
    const commitResponse = await app.request("/api/v1/practice/local/commit", {
      method: "POST",
      headers: userOneHeaders,
      body: JSON.stringify(commitBody),
    });
    assert.equal(commitResponse.status, 200);
    const committed = (await commitResponse.json()) as {
      scoring: { evaluation: { overall: { score: number; pass: boolean } } };
      score_trust: string;
    };
    assert.equal(committed.scoring.evaluation.overall.score, 3);
    assert.equal(committed.scoring.evaluation.overall.pass, true);
    assert.equal(committed.score_trust, "local_unverified");
    const retryCommitResponse = await app.request(
      "/api/v1/practice/local/commit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify(commitBody),
      },
    );
    assert.equal(retryCommitResponse.status, 200);
    const changedTranscript = `${transcript} Changed.`;
    const conflictingCommitResponse = await app.request(
      "/api/v1/practice/local/commit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          ...commitBody,
          transcript: { ...commitBody.transcript, text: changedTranscript },
          evaluation: {
            ...commitBody.evaluation,
            transcript: { text: changedTranscript },
          },
        }),
      },
    );
    assert.equal(conflictingCommitResponse.status, 409);
    const [beforeRecovery] = await db
      .select({ model_info: attempts.model_info })
      .from(attempts)
      .where(eq(attempts.id, preparation.attemptId));
    const originalFetch = globalThis.fetch;
    let providerFetches = 0;
    globalThis.fetch = async () => {
      providerFetches += 1;
      throw new Error("A completed attempt must not invoke a provider.");
    };
    try {
      const recoveryResponse = await app.request("/api/v1/practice/run", {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          task_id: "task-1",
          example_id: "example-1",
          attempt_id: preparation.attemptId,
          transcript_text:
            "A different retry body must still return stored truth.",
          mode: "openai_only",
        }),
      });
      assert.equal(recoveryResponse.status, 200);
      const recovered = (await recoveryResponse.json()) as {
        scoring: { evaluation: { overall: { score: number } } };
      };
      assert.equal(recovered.scoring.evaluation.overall.score, 3);
      assert.equal(providerFetches, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const [afterRecovery] = await db
      .select({ model_info: attempts.model_info })
      .from(attempts)
      .where(eq(attempts.id, preparation.attemptId));
    assert.deepEqual(afterRecovery?.model_info, beforeRecovery?.model_info);

    await db.insert(minigameSessions).values({
      id: "game-1",
      user_id: "user-1",
      game_type: "ffa",
      visibility_mode: "normal",
      task_selection: {},
      settings: {},
      created_at: now,
      ended_at: null,
      last_active_at: now,
      current_round_id: "round-1",
      current_player_id: "player-1",
      deleted_at: null,
    });
    await db.insert(minigamePlayers).values([
      {
        id: "player-1",
        session_id: "game-1",
        name: "Player One",
        avatar: "astro",
        team_id: null,
        created_at: now,
      },
      {
        id: "unassigned-player",
        session_id: "game-1",
        name: "Unassigned",
        avatar: "astro",
        team_id: null,
        created_at: now,
      },
    ]);
    await db.insert(minigameRounds).values({
      id: "round-1",
      session_id: "game-1",
      position: 0,
      task_id: "task-1",
      example_id: "example-1",
      player_a_id: "player-1",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "active",
      started_at: now,
      completed_at: null,
    });

    const unassignedResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-1/commit-local",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "unassigned-player",
          attempt_id: preparation.attemptId,
        }),
      },
    );
    assert.equal(unassignedResponse.status, 404);

    const userTwoHeaders = await createAuthHeader(db, "user-2");
    const otherUserResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-1/commit-local",
      {
        method: "POST",
        headers: userTwoHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          attempt_id: preparation.attemptId,
        }),
      },
    );
    assert.equal(otherUserResponse.status, 404);

    const standardAttemptReuse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-1/commit-local",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          attempt_id: preparation.attemptId,
        }),
      },
    );
    assert.equal(standardAttemptReuse.status, 409);

    const scopedPrepareBody = {
      task_id: "task-1",
      example_id: "example-1",
      minigame: {
        session_id: "game-1",
        round_id: "round-1",
        player_id: "player-1",
      },
    };
    const scopedPrepareResponse = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify(scopedPrepareBody),
      },
    );
    assert.equal(scopedPrepareResponse.status, 200);
    const scopedPreparation = (await scopedPrepareResponse.json()) as {
      attemptId: string;
    };
    const retriedScopedPrepareResponse = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify(scopedPrepareBody),
      },
    );
    assert.equal(retriedScopedPrepareResponse.status, 200);
    const retriedScopedPreparation =
      (await retriedScopedPrepareResponse.json()) as { attemptId: string };
    assert.equal(
      retriedScopedPreparation.attemptId,
      scopedPreparation.attemptId,
    );
    const submissionClaims = await db.select().from(minigameSubmissionClaims);
    assert.equal(submissionClaims.length, 1);
    assert.equal(submissionClaims[0]?.round_id, "round-1");
    assert.equal(submissionClaims[0]?.player_id, "player-1");
    assert.equal(submissionClaims[0]?.attempt_id, scopedPreparation.attemptId);
    const scopedCommitResponse = await app.request(
      "/api/v1/practice/local/commit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify(buildLocalCommitBody(scopedPreparation.attemptId)),
      },
    );
    assert.equal(scopedCommitResponse.status, 200);
    const finalizeRequest = {
      method: "POST",
      headers: userOneHeaders,
      body: JSON.stringify({
        player_id: "player-1",
        attempt_id: scopedPreparation.attemptId,
      }),
    };
    const [finalizeResponse, concurrentFinalizeResponse] = await Promise.all([
      app.request(
        "/api/v1/minigames/sessions/game-1/rounds/round-1/commit-local",
        finalizeRequest,
      ),
      app.request(
        "/api/v1/minigames/sessions/game-1/rounds/round-1/commit-local",
        finalizeRequest,
      ),
    ]);
    assert.equal(finalizeResponse.status, 200);
    assert.equal(concurrentFinalizeResponse.status, 200);
    const finalized = (await finalizeResponse.json()) as {
      adjusted_score: number;
      score_trust: string;
    };
    assert.equal(finalized.adjusted_score, 3);
    assert.equal(finalized.score_trust, "local_unverified");

    const idempotentResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-1/commit-local",
      finalizeRequest,
    );
    assert.equal(idempotentResponse.status, 200);

    const stateResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/state",
      {
        headers: userOneHeaders,
      },
    );
    assert.equal(stateResponse.status, 200);
    const state = (await stateResponse.json()) as {
      results: Array<{ score_trust: string }>;
    };
    assert.equal(state.results.length, 1);
    assert.equal(state.results[0]?.score_trust, "local_unverified");

    await db.insert(minigameRounds).values({
      id: "round-2",
      session_id: "game-1",
      position: 1,
      task_id: "task-1",
      example_id: "example-1",
      player_a_id: "player-1",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "active",
      started_at: now,
      completed_at: null,
    });
    const wrongRoundResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-2/commit-local",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          attempt_id: scopedPreparation.attemptId,
        }),
      },
    );
    assert.equal(wrongRoundResponse.status, 409);
    await db
      .update(minigameRounds)
      .set({ status: "completed", completed_at: Date.now() })
      .where(eq(minigameRounds.id, "round-2"));

    await db.insert(minigameRounds).values({
      id: "round-cloud",
      session_id: "game-1",
      position: 2,
      task_id: "task-1",
      example_id: "example-1",
      player_a_id: "player-1",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "active",
      started_at: now,
      completed_at: null,
    });
    const cloudMinigamePrepareResponse = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          task_id: "task-1",
          example_id: "example-1",
          input_mode: "audio",
          transcript: {
            text: "A cloud-evaluated local transcript.",
            model: "local-stt",
            duration_ms: 100,
          },
          minigame: {
            session_id: "game-1",
            round_id: "round-cloud",
            player_id: "player-1",
          },
        }),
      },
    );
    assert.equal(cloudMinigamePrepareResponse.status, 200);
    const cloudMinigamePreparation =
      (await cloudMinigamePrepareResponse.json()) as { attemptId: string };
    const minigameOriginalFetch = globalThis.fetch;
    try {
      installOpenAiEvaluationMock(cloudMinigamePreparation.attemptId);
      const cloudMinigameFallbackResponse = await app.request(
        "/api/v1/minigames/sessions/game-1/rounds/round-cloud/submit",
        {
          method: "POST",
          headers: userOneHeaders,
          body: JSON.stringify({
            player_id: "player-1",
            attempt_id: cloudMinigamePreparation.attemptId,
            transcript_text: "A cloud-evaluated local transcript.",
            mode: "openai_only",
            practice_mode: "real_time",
          }),
        },
      );
      assert.equal(cloudMinigameFallbackResponse.status, 200);
      const cloudMinigameFallback =
        (await cloudMinigameFallbackResponse.json()) as {
          score_trust: string;
          scoring: { provider: { kind: string } };
        };
      assert.equal(cloudMinigameFallback.scoring.provider.kind, "openai");
      assert.equal(cloudMinigameFallback.score_trust, "cloud_trusted");
    } finally {
      globalThis.fetch = minigameOriginalFetch;
    }
    const [cloudMinigameAttempt] = await db
      .select({
        score_trust: attempts.score_trust,
        model_info: attempts.model_info,
      })
      .from(attempts)
      .where(eq(attempts.id, cloudMinigamePreparation.attemptId));
    assert.equal(cloudMinigameAttempt?.score_trust, "cloud_trusted");
    assert.equal(
      cloudMinigameAttempt?.model_info?.score_trust,
      "cloud_trusted",
    );
    assert.equal(
      cloudMinigameAttempt?.model_info?.provider?.llm?.kind,
      "openai",
    );

    await db.insert(minigameRounds).values({
      id: "round-skip",
      session_id: "game-1",
      position: 3,
      task_id: "task-1",
      example_id: "example-1",
      player_a_id: "player-1",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "active",
      started_at: now,
      completed_at: null,
    });
    const poisonedClaimResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-skip/submit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          attempt_id: preparation.attemptId,
          transcript_text: "An ordinary attempt must not claim this round.",
          mode: "openai_only",
        }),
      },
    );
    assert.equal(poisonedClaimResponse.status, 409);
    assert.equal(
      (
        await db
          .select()
          .from(minigameSubmissionClaims)
          .where(eq(minigameSubmissionClaims.round_id, "round-skip"))
      ).length,
      0,
    );
    const skipResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-skip/submit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          transcript_text: "A cloud-evaluated local transcript.",
          skip_scoring: true,
          mode: "openai_only",
        }),
      },
    );
    assert.equal(skipResponse.status, 200);
    const skipped = (await skipResponse.json()) as { attemptId: string };
    const [skippedAttempt] = await db
      .select({ completed_at: attempts.completed_at })
      .from(attempts)
      .where(eq(attempts.id, skipped.attemptId));
    assert.equal(skippedAttempt?.completed_at, null);
    assert.equal(
      (
        await db
          .select()
          .from(minigameRoundResults)
          .where(eq(minigameRoundResults.round_id, "round-skip"))
      ).length,
      0,
    );

    const skipOriginalFetch = globalThis.fetch;
    try {
      installOpenAiEvaluationMock(skipped.attemptId);
      const scoreAfterSkipResponse = await app.request(
        "/api/v1/minigames/sessions/game-1/rounds/round-skip/submit",
        {
          method: "POST",
          headers: userOneHeaders,
          body: JSON.stringify({
            player_id: "player-1",
            attempt_id: skipped.attemptId,
            transcript_text: "A cloud-evaluated local transcript.",
            mode: "openai_only",
          }),
        },
      );
      assert.equal(scoreAfterSkipResponse.status, 200);
      const scoredAfterSkip = (await scoreAfterSkipResponse.json()) as {
        attemptId: string;
      };
      assert.equal(scoredAfterSkip.attemptId, skipped.attemptId);
    } finally {
      globalThis.fetch = skipOriginalFetch;
    }
    const [completedSkippedAttempt] = await db
      .select({ completed_at: attempts.completed_at })
      .from(attempts)
      .where(eq(attempts.id, skipped.attemptId));
    assert.equal(typeof completedSkippedAttempt?.completed_at, "number");
    const completedRetryResponse = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-skip/submit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          attempt_id: skipped.attemptId,
          transcript_text: "A retry must return the stored completed result.",
          mode: "openai_only",
        }),
      },
    );
    assert.equal(completedRetryResponse.status, 200);
    const completedRetry = (await completedRetryResponse.json()) as {
      attemptId: string;
    };
    assert.equal(completedRetry.attemptId, skipped.attemptId);
    const lostResponseRetry = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-skip/submit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          transcript_text:
            "A lost response retry omits the attempt identifier.",
          mode: "openai_only",
        }),
      },
    );
    assert.equal(lostResponseRetry.status, 200);
    const recoveredLostResponse = (await lostResponseRetry.json()) as {
      attemptId: string;
    };
    assert.equal(recoveredLostResponse.attemptId, skipped.attemptId);

    await db
      .update(minigameRounds)
      .set({ status: "active", completed_at: null })
      .where(eq(minigameRounds.id, "round-skip"));
    const seededResultReplay = await app.request(
      "/api/v1/minigames/sessions/game-1/rounds/round-skip/submit",
      {
        method: "POST",
        headers: userOneHeaders,
        body: JSON.stringify({
          player_id: "player-1",
          transcript_text:
            "Replay an accepted result after finalization was lost.",
          mode: "openai_only",
        }),
      },
    );
    assert.equal(seededResultReplay.status, 200);
    const [reFinalizedRound] = await db
      .select({
        status: minigameRounds.status,
        completed_at: minigameRounds.completed_at,
      })
      .from(minigameRounds)
      .where(eq(minigameRounds.id, "round-skip"));
    assert.equal(reFinalizedRound?.status, "completed");
    assert.equal(typeof reFinalizedRound?.completed_at, "number");
    assert.equal(
      (
        await db
          .select()
          .from(minigameRoundResults)
          .where(eq(minigameRoundResults.round_id, "round-skip"))
      ).length,
      1,
    );
  } finally {
    sqlite.close();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
