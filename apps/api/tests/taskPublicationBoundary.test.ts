import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import {
  attempts,
  minigamePlayers,
  minigameRoundResults,
  minigameRounds,
  minigameSessions,
  minigameSubmissionClaims,
  practiceSessions,
  taskCriteria,
  taskExamples,
  tasks,
  userTaskProgress,
} from "../src/db/schema";
import { resolveEnv } from "../src/env";

const jwtSecret = "publication-boundary-secret";

const authHeaders = async () => {
  const token = await new SignJWT({ email: "learner@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("learner-1")
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(jwtSecret));
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

test("learner task and session routes hide drafts while administrator detail retains access", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-task-publication-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  let storageCalls = 0;
  const app = createApiApp({
    env: resolveEnv({
      ENV: "development",
      BYPASS_ADMIN_AUTH: "true",
      SUPABASE_JWT_SECRET: jwtSecret,
    }),
    db,
    tts: {
      storage: {
        headObject: async () => {
          storageCalls += 1;
          return { exists: false };
        },
        putObject: async () => {
          storageCalls += 1;
          return {};
        },
        getObject: async () => {
          storageCalls += 1;
          return {
            body: new Uint8Array(),
            contentType: "audio/mpeg",
          };
        },
      },
    },
  });

  try {
    const now = Date.now();
    await db.insert(tasks).values([
      {
        id: "published-task",
        slug: "published-task",
        title: "Published task",
        description: "Visible to learners.",
        skill_domain: "validation",
        base_difficulty: 2,
        general_objective: null,
        tags: ["test"],
        language: "en",
        is_published: true,
        parent_task_id: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "draft-task",
        slug: "draft-task",
        title: "Draft task",
        description: "Administrator work in progress.",
        skill_domain: "validation",
        base_difficulty: 2,
        general_objective: null,
        tags: ["private"],
        language: "en",
        is_published: false,
        parent_task_id: null,
        created_at: now,
        updated_at: now,
      },
    ]);
    await db.insert(taskCriteria).values([
      {
        id: "published-criterion",
        task_id: "published-task",
        label: "Published criterion",
        description: "Visible criterion.",
        rubric: null,
        sort_order: 0,
      },
      {
        id: "draft-criterion",
        task_id: "draft-task",
        label: "Draft criterion",
        description: "Private criterion.",
        rubric: null,
        sort_order: 0,
      },
    ]);
    await db.insert(taskExamples).values([
      {
        id: "published-example",
        task_id: "published-task",
        difficulty: 2,
        severity_label: null,
        patient_text: "Published prompt",
        language: "en",
        meta: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "draft-example",
        task_id: "draft-task",
        difficulty: 2,
        severity_label: null,
        patient_text: "Private draft prompt",
        language: "en",
        meta: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    const listResponse = await app.request("/api/v1/tasks");
    assert.equal(listResponse.status, 200);
    const list = (await listResponse.json()) as Array<{ id: string }>;
    assert.deepEqual(
      list.map((task) => task.id),
      ["published-task"],
    );

    const explicitDraftList = await app.request("/api/v1/tasks?published=0");
    assert.equal(explicitDraftList.status, 200);
    assert.deepEqual(await explicitDraftList.json(), []);

    assert.equal((await app.request("/api/v1/tasks/draft-task")).status, 404);
    assert.equal(
      (await app.request("/api/v1/tasks/draft-task/examples")).status,
      404,
    );
    assert.equal(
      (await app.request("/api/v1/tasks/published-task")).status,
      200,
    );
    assert.equal(
      (await app.request("/api/v1/tasks/published-task/examples")).status,
      200,
    );

    const adminDraft = await app.request("/api/v1/admin/tasks/draft-task");
    assert.equal(adminDraft.status, 200);

    const headers = await authHeaders();
    const draftPrefetch = await app.request(
      "/api/v1/practice/patient-audio/prefetch",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          exercise_id: "draft-task",
          statement_id: "draft-example",
          practice_mode: "real_time",
        }),
      },
    );
    assert.equal(draftPrefetch.status, 404);
    assert.equal(
      "cache_key" in ((await draftPrefetch.json()) as Record<string, unknown>),
      false,
    );

    const draftBatchPrefetch = await app.request(
      "/api/v1/practice/patient-audio/prefetch-batch",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          exercise_id: "draft-task",
          statement_ids: ["draft-example"],
          practice_mode: "real_time",
        }),
      },
    );
    assert.equal(draftBatchPrefetch.status, 404);
    assert.equal(
      "cache_key" in
        ((await draftBatchPrefetch.json()) as Record<string, unknown>),
      false,
    );
    assert.equal(storageCalls, 0);

    const draftSession = await app.request("/api/v1/sessions/start", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "single_task",
        task_id: "draft-task",
        item_count: 1,
      }),
    });
    assert.equal(draftSession.status, 404);
    assert.equal((await db.select().from(practiceSessions)).length, 0);
    assert.equal((await db.select().from(userTaskProgress)).length, 0);

    const publishedSession = await app.request("/api/v1/sessions/start", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "single_task",
        task_id: "published-task",
        item_count: 1,
      }),
    });
    assert.equal(publishedSession.status, 200);
    const createdSession = (await publishedSession.json()) as {
      session_id: string;
      items: Array<{ session_item_id: string }>;
    };
    const preparedAttempt = await app.request(
      "/api/v1/practice/local/prepare",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          session_item_id: createdSession.items[0]?.session_item_id,
          input_mode: "typed",
          transcript: { text: "Prepared but not completed." },
        }),
      },
    );
    assert.equal(preparedAttempt.status, 200);
    const beforeUnpublishList = await app.request("/api/v1/sessions", {
      headers,
    });
    const beforeUnpublish = (await beforeUnpublishList.json()) as Array<{
      completed_count: number;
    }>;
    assert.equal(beforeUnpublish[0]?.completed_count, 0);

    const draftMinigame = await app.request("/api/v1/minigames/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_type: "ffa",
        visibility_mode: "normal",
        task_selection: {
          strategy: "manual",
          task_ids: ["draft-task"],
          shuffle: true,
          seed: "draft",
        },
        settings: { rounds_per_player: 1 },
      }),
    });
    assert.equal(draftMinigame.status, 404);
    const mixedManualMinigame = await app.request(
      "/api/v1/minigames/sessions",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          game_type: "ffa",
          visibility_mode: "normal",
          task_selection: {
            strategy: "manual",
            task_ids: ["published-task", "draft-task"],
            shuffle: true,
            seed: "mixed",
          },
          settings: { rounds_per_player: 1 },
        }),
      },
    );
    assert.equal(mixedManualMinigame.status, 404);

    await db.insert(minigameSessions).values({
      id: "published-game",
      user_id: "learner-1",
      game_type: "ffa",
      visibility_mode: "normal",
      task_selection: {
        strategy: "manual",
        task_ids: ["published-task"],
      },
      settings: {},
      created_at: now,
      ended_at: null,
      last_active_at: now,
      current_round_id: "previous-active-round",
      current_player_id: "published-player",
      deleted_at: null,
    });
    await db.insert(minigamePlayers).values({
      id: "published-player",
      session_id: "published-game",
      name: "Learner",
      avatar: "🙂",
      team_id: null,
      created_at: now,
    });
    await db.insert(minigameRounds).values({
      id: "published-round",
      session_id: "published-game",
      position: 1,
      task_id: "published-task",
      example_id: "published-example",
      player_a_id: "published-player",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "pending",
      started_at: null,
      completed_at: null,
    });
    await db.insert(minigameRounds).values({
      id: "previous-active-round",
      session_id: "published-game",
      position: 0,
      task_id: "published-task",
      example_id: "published-example",
      player_a_id: "published-player",
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "active",
      started_at: now - 100,
      completed_at: null,
    });
    const switchedRound = await app.request(
      "/api/v1/minigames/sessions/published-game/rounds/published-round/start",
      { method: "POST", headers },
    );
    assert.equal(switchedRound.status, 200);
    const switchedRoundRows = await db
      .select({
        id: minigameRounds.id,
        status: minigameRounds.status,
        started_at: minigameRounds.started_at,
      })
      .from(minigameRounds);
    assert.deepEqual(
      switchedRoundRows
        .map((entry) => ({
          id: entry.id,
          status: entry.status,
          started_at: entry.started_at,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      [
        {
          id: "previous-active-round",
          status: "pending",
          started_at: null,
        },
        {
          id: "published-round",
          status: "active",
          started_at: switchedRoundRows.find(
            (entry) => entry.id === "published-round",
          )?.started_at,
        },
      ],
    );
    assert.equal(
      typeof switchedRoundRows.find((entry) => entry.id === "published-round")
        ?.started_at,
      "number",
    );
    await db.insert(minigameSubmissionClaims).values({
      round_id: "published-round",
      player_id: "published-player",
      attempt_id: "published-attempt",
      created_at: now,
    });
    await db.insert(attempts).values({
      id: "published-attempt",
      user_id: "learner-1",
      session_id: null,
      session_item_id: null,
      task_id: "published-task",
      example_id: "published-example",
      started_at: now,
      completed_at: now,
      audio_ref: null,
      transcript: "Historical minigame response.",
      evaluation: {},
      overall_pass: true,
      overall_score: 4,
      score_trust: "cloud_trusted",
      model_info: {
        practice: {
          scope: {
            kind: "minigame",
            session_id: "published-game",
            round_id: "published-round",
            player_id: "published-player",
          },
        },
      },
    });
    await db.insert(minigameRoundResults).values({
      id: "published-result",
      round_id: "published-round",
      player_id: "published-player",
      attempt_id: "published-attempt",
      overall_score: 4,
      overall_pass: true,
      created_at: now,
    });

    await db
      .update(tasks)
      .set({ is_published: false, updated_at: Date.now() })
      .where(eq(tasks.id, "published-task"));

    const restoredSession = await app.request(
      `/api/v1/sessions/${createdSession.session_id}`,
      { headers },
    );
    assert.equal(restoredSession.status, 200);
    const restored = (await restoredSession.json()) as { items: unknown[] };
    assert.deepEqual(restored.items, []);

    const sessionList = await app.request("/api/v1/sessions", { headers });
    assert.equal(sessionList.status, 200);
    const listed = (await sessionList.json()) as Array<{ items: unknown[] }>;
    assert.deepEqual(listed[0]?.items, []);

    const hostedExecution = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_item_id: createdSession.items[0]?.session_item_id,
        input_mode: "typed",
        transcript_text: "This must not execute after unpublishing.",
        skip_scoring: true,
      }),
    });
    assert.equal(hostedExecution.status, 404);

    const localExecution = await app.request("/api/v1/practice/local/prepare", {
      method: "POST",
      headers,
      body: JSON.stringify({
        session_item_id: createdSession.items[0]?.session_item_id,
        input_mode: "typed",
        transcript: { text: "This must not prepare after unpublishing." },
      }),
    });
    assert.equal(localExecution.status, 404);

    const unavailableStart = await app.request(
      "/api/v1/minigames/sessions/published-game/rounds/published-round/start",
      { method: "POST", headers },
    );
    assert.equal(unavailableStart.status, 404);
    const unavailableGenerate = await app.request(
      "/api/v1/minigames/sessions/published-game/rounds/generate",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ count: 1 }),
      },
    );
    assert.equal(unavailableGenerate.status, 404);
    const unavailableSubmit = await app.request(
      "/api/v1/minigames/sessions/published-game/rounds/published-round/submit",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          player_id: "published-player",
          transcript_text: "Must not submit.",
        }),
      },
    );
    assert.equal(unavailableSubmit.status, 404);
    const unavailableCommit = await app.request(
      "/api/v1/minigames/sessions/published-game/rounds/published-round/commit-local",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          player_id: "published-player",
          attempt_id: "nonexistent-attempt",
        }),
      },
    );
    assert.equal(unavailableCommit.status, 404);
    const unavailableResume = await app.request(
      "/api/v1/minigames/sessions/published-game/resume",
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          current_round_id: "published-round",
          current_player_id: "published-player",
        }),
      },
    );
    assert.equal(unavailableResume.status, 409);

    const gameStateResponse = await app.request(
      "/api/v1/minigames/sessions/published-game/state",
      { headers },
    );
    assert.equal(gameStateResponse.status, 200);
    const gameState = (await gameStateResponse.json()) as {
      session: {
        current_round_id: string | null;
        current_player_id: string | null;
      };
      rounds: unknown[];
      results: unknown[];
    };
    assert.equal(gameState.session.current_round_id, null);
    assert.equal(gameState.session.current_player_id, null);
    assert.deepEqual(gameState.rounds, []);
    assert.deepEqual(gameState.results, []);

    const gameListResponse = await app.request(
      "/api/v1/minigames/sessions?status=all",
      { headers },
    );
    const gameList = (await gameListResponse.json()) as {
      sessions: Array<{
        id: string;
        current_round_id: string | null;
        progress: { completed: number; total: number };
      }>;
    };
    const unavailableSummary = gameList.sessions.find(
      (session) => session.id === "published-game",
    );
    assert.equal(unavailableSummary?.current_round_id, null);
    assert.deepEqual(unavailableSummary?.progress, { completed: 0, total: 0 });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
