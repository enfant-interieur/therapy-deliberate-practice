import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import {
  attempts,
  taskCriteria,
  taskExamples,
  tasks,
  userSettings,
  users,
} from "../src/db/schema";
import { resolveEnv } from "../src/env";

const jwtSecret = "typed-practice-secret";
const typedText =
  "It sounds like this has been exhausting, and I wonder what support would help most.";

const authHeaders = async (userId = "typed-user") => {
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

const evaluationFor = (attemptId: string, transcript = typedText) => ({
  version: "2.0",
  task_id: "task-typed",
  example_id: "example-typed",
  attempt_id: attemptId,
  transcript: { text: transcript },
  criterion_scores: [
    {
      criterion_id: "criterion-reflect",
      score: 4,
      rationale_short: "Names the experience.",
    },
    {
      criterion_id: "criterion-explore",
      score: 2,
      rationale_short: "Invites more detail.",
    },
  ],
  overall: {
    score: 0,
    pass: false,
    summary_feedback: "The server must replace this tampered aggregate.",
    what_to_improve_next: ["Ask one concise follow-up."],
  },
  patient_reaction: { emotion: "engaged", intensity: 2 },
  diagnostics: {
    provider: {
      stt: { kind: "openai", model: "fabricated-stt" },
      llm: { kind: "openai", model: "test-llm" },
    },
    timing_ms: { stt: 999, llm: 20, total: 1019 },
  },
});

test("typed cloud and local attempts persist transcript/evaluation without audio or fabricated STT provenance", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-typed-practice-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const app = createApiApp({
    env: resolveEnv({
      ENV: "test",
      SUPABASE_JWT_SECRET: jwtSecret,
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
    await db.insert(users).values([
      {
        id: "typed-user",
        email: "typed-user@example.com",
        display_name: "Typed User",
        bio: null,
        created_at: now,
      },
      {
        id: "other-user",
        email: "other-user@example.com",
        display_name: "Other User",
        bio: null,
        created_at: now,
      },
    ]);
    await db.insert(userSettings).values({
      user_id: "typed-user",
      ai_mode: "openai_only",
      local_base_url: null,
      local_stt_url: null,
      local_llm_url: null,
      store_audio: true,
      openai_key_ciphertext: null,
      openai_key_iv: null,
      openai_key_kid: null,
      updated_at: now,
      created_at: now,
    });
    await db.insert(tasks).values([
      {
        id: "task-typed",
        slug: "task-typed",
        title: "Typed task",
        description: "A typed practice test.",
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
        id: "task-draft",
        slug: "task-draft",
        title: "Draft task",
        description: "Not learner visible.",
        skill_domain: "validation",
        base_difficulty: 2,
        general_objective: null,
        tags: ["test"],
        language: "en",
        is_published: false,
        parent_task_id: null,
        created_at: now,
        updated_at: now,
      },
    ]);
    await db.insert(taskCriteria).values([
      {
        id: "criterion-reflect",
        task_id: "task-typed",
        label: "Reflect",
        description: "Reflect the experience.",
        rubric: null,
        sort_order: 0,
      },
      {
        id: "criterion-explore",
        task_id: "task-typed",
        label: "Explore",
        description: "Invite exploration.",
        rubric: null,
        sort_order: 1,
      },
      {
        id: "criterion-draft",
        task_id: "task-draft",
        label: "Draft",
        description: "Draft criterion.",
        rubric: null,
        sort_order: 0,
      },
    ]);
    await db.insert(taskExamples).values([
      {
        id: "example-typed",
        task_id: "task-typed",
        difficulty: 2,
        severity_label: null,
        patient_text: "I am worn out.",
        language: "en",
        meta: null,
        created_at: now,
        updated_at: now,
      },
      {
        id: "example-draft",
        task_id: "task-draft",
        difficulty: 2,
        severity_label: null,
        patient_text: "Private draft.",
        language: "en",
        meta: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    const headers = await authHeaders();
    const settingsResponse = await app.request("/api/v1/me/settings", {
      headers,
    });
    assert.equal(settingsResponse.status, 200);
    assert.equal(
      ((await settingsResponse.json()) as { storeAudio: boolean }).storeAudio,
      false,
    );

    const updateSettingsResponse = await app.request("/api/v1/me/settings", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        aiMode: "openai_only",
        localAiBaseUrl: null,
        localSttUrl: null,
        localLlmUrl: null,
        storeAudio: true,
      }),
    });
    assert.equal(updateSettingsResponse.status, 200);
    assert.equal(
      ((await updateSettingsResponse.json()) as { storeAudio: boolean })
        .storeAudio,
      false,
    );
    const [normalizedSettings] = await db
      .select({ store_audio: userSettings.store_audio })
      .from(userSettings)
      .where(eq(userSettings.user_id, "typed-user"));
    assert.equal(normalizedSettings?.store_audio, false);

    let providerCalls = 0;
    globalThis.fetch = async (input, init) => {
      providerCalls += 1;
      const requestBody =
        input instanceof Request
          ? await input.clone().text()
          : String(init?.body ?? "");
      const request = JSON.parse(requestBody) as {
        input?: string;
      };
      const evaluatorInput = JSON.parse(request.input ?? "{}") as {
        attempt_id: string;
      };
      return new Response(
        JSON.stringify({
          id: `response-${evaluatorInput.attempt_id}`,
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(
                    evaluationFor(evaluatorInput.attempt_id),
                  ),
                },
              ],
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    await db.insert(attempts).values({
      id: "legacy-audio-attempt",
      user_id: "typed-user",
      session_id: null,
      session_item_id: null,
      task_id: "task-typed",
      example_id: "example-typed",
      started_at: now,
      completed_at: null,
      audio_ref: null,
      transcript: typedText,
      evaluation: {},
      overall_pass: false,
      overall_score: 0,
      score_trust: "cloud_trusted",
      model_info: {
        provider: {
          stt: { kind: "openai", model: "legacy-stt" },
          llm: null,
        },
        timing_ms: { stt: 15 },
      },
    });
    const legacyRelabel = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        attempt_id: "legacy-audio-attempt",
        input_mode: "typed",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(legacyRelabel.status, 409);
    assert.equal(providerCalls, 0);

    const cloudResponse = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        input_mode: "typed",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(cloudResponse.status, 200);
    const cloud = (await cloudResponse.json()) as {
      attemptId: string;
      score_trust: string;
      transcript: {
        input_mode: string;
        provider: unknown;
        duration_ms: unknown;
      };
      scoring: {
        evaluation: {
          overall: { score: number; pass: boolean };
          diagnostics?: unknown;
        };
      };
    };
    assert.equal(cloud.score_trust, "cloud_trusted");
    assert.equal(cloud.transcript.input_mode, "typed");
    assert.equal(cloud.transcript.provider, null);
    assert.equal(cloud.transcript.duration_ms, null);
    assert.equal(cloud.scoring.evaluation.overall.score, 3);
    assert.equal(cloud.scoring.evaluation.overall.pass, true);
    assert.equal(cloud.scoring.evaluation.diagnostics, undefined);
    assert.equal(providerCalls, 1);

    const [cloudAttempt] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.id, cloud.attemptId));
    assert.equal(cloudAttempt?.transcript, typedText);
    assert.equal(cloudAttempt?.audio_ref, null);
    assert.equal(cloudAttempt?.overall_score, 3);
    assert.equal(cloudAttempt?.model_info?.input_mode, "typed");
    assert.equal(cloudAttempt?.model_info?.provider?.stt, null);
    assert.equal(cloudAttempt?.model_info?.timing_ms?.stt, undefined);
    assert.equal(cloudAttempt?.evaluation?.diagnostics, undefined);

    const conflictingMode = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        attempt_id: cloud.attemptId,
        input_mode: "audio",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(conflictingMode.status, 409);
    assert.equal(providerCalls, 1);

    const missingAttempt = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        attempt_id: "missing-attempt",
        input_mode: "typed",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(missingAttempt.status, 404);
    const missingAttemptBody = (await missingAttempt.json()) as {
      errors: unknown;
    };

    await db.insert(attempts).values({
      id: "other-user-attempt",
      user_id: "other-user",
      session_id: null,
      session_item_id: null,
      task_id: "task-typed",
      example_id: "example-typed",
      started_at: now,
      completed_at: null,
      audio_ref: null,
      transcript: typedText,
      evaluation: {},
      overall_pass: false,
      overall_score: 0,
      score_trust: "cloud_trusted",
      model_info: { input_mode: "typed", provider: { stt: null, llm: null } },
    });
    const foreignAttempt = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        attempt_id: "other-user-attempt",
        input_mode: "typed",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(foreignAttempt.status, 404);
    const foreignAttemptBody = (await foreignAttempt.json()) as {
      errors: unknown;
    };
    assert.deepEqual(foreignAttemptBody.errors, missingAttemptBody.errors);

    const transcriptLabeledAudio = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        input_mode: "audio",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(transcriptLabeledAudio.status, 409);

    const draftAttempt = await app.request("/api/v1/practice/run", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-draft",
        example_id: "example-draft",
        input_mode: "typed",
        transcript_text: typedText,
        mode: "openai_only",
      }),
    });
    assert.equal(draftAttempt.status, 404);
    assert.equal(providerCalls, 1);

    const typedPrepare = await app.request("/api/v1/practice/local/prepare", {
      method: "POST",
      headers,
      body: JSON.stringify({
        task_id: "task-typed",
        example_id: "example-typed",
        input_mode: "typed",
        transcript: { text: typedText },
      }),
    });
    assert.equal(typedPrepare.status, 200);
    const preparation = (await typedPrepare.json()) as {
      attemptId: string;
      input_mode: string;
    };
    assert.equal(preparation.input_mode, "typed");

    const localCommitBody = {
      attempt_id: preparation.attemptId,
      input_mode: "typed",
      transcript: { text: typedText },
      evaluation: evaluationFor(preparation.attemptId),
      llm: { model: "local-test-llm", duration_ms: 25 },
      practice_mode: "standard",
    };
    const localCommit = await app.request("/api/v1/practice/local/commit", {
      method: "POST",
      headers,
      body: JSON.stringify(localCommitBody),
    });
    assert.equal(localCommit.status, 200);
    const local = (await localCommit.json()) as {
      transcript: {
        input_mode: string;
        provider: unknown;
        duration_ms: unknown;
      };
      scoring: { evaluation: { overall: { score: number } } };
    };
    assert.equal(local.transcript.input_mode, "typed");
    assert.equal(local.transcript.provider, null);
    assert.equal(local.transcript.duration_ms, null);
    assert.equal(local.scoring.evaluation.overall.score, 3);

    const localRetry = await app.request("/api/v1/practice/local/commit", {
      method: "POST",
      headers,
      body: JSON.stringify(localCommitBody),
    });
    assert.equal(localRetry.status, 200);

    const localConflict = await app.request("/api/v1/practice/local/commit", {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...localCommitBody,
        input_mode: "audio",
        transcript: {
          text: typedText,
          model: "fake-stt",
          duration_ms: 10,
        },
      }),
    });
    assert.equal(localConflict.status, 409);

    const [localAttempt] = await db
      .select()
      .from(attempts)
      .where(eq(attempts.id, preparation.attemptId));
    assert.equal(localAttempt?.transcript, typedText);
    assert.equal(localAttempt?.audio_ref, null);
    assert.equal(localAttempt?.overall_score, 3);
    assert.equal(localAttempt?.model_info?.input_mode, "typed");
    assert.equal(localAttempt?.model_info?.provider?.stt, null);
    assert.equal(localAttempt?.model_info?.timing_ms?.stt, undefined);
    assert.equal(localAttempt?.evaluation?.diagnostics, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
