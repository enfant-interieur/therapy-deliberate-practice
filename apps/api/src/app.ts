import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  attempts,
  minigamePlayerPromptHistory,
  minigamePlayers,
  minigameRoundResults,
  minigameRounds,
  minigameRoundStartClaims,
  minigameSessions,
  minigameSubmissionClaims,
  minigameTeams,
  practiceSessionItems,
  practiceSessions,
  taskCriteria,
  taskExamples,
  taskInteractionExamples,
  tasks,
  ttsAssets,
  userSettings,
  userTaskProgress,
  users,
} from "./db/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  deliberatePracticeTaskV2Schema,
  evaluationResultSchema,
  practiceRunInputSchema,
  taskCriterionSchema,
  taskExampleSchema,
  taskInteractionExampleSchema,
  taskSchema,
  type PracticeRunError,
  type SttProvider,
  type Task,
  type TaskCriterion,
  type TaskExample,
  type TaskInteractionExample,
} from "@deliberate/shared";
import { selectLlmProvider, selectSttProvider } from "./providers";
import { attemptJsonRepair } from "./utils/jsonRepair";
import type { RuntimeEnv } from "./env";
import type { ApiDatabase } from "./db/types";
import { createAdminAuth, resolveAdminStatus } from "./middleware/adminAuth";
import { createUserAuth } from "./middleware/userAuth";
import { createApplicationAuth, getProviderAvailability } from "./auth/service";
import type { AuthEmailSender } from "./auth/email";
import { decryptOpenAiKey, encryptOpenAiKey } from "./utils/crypto";
import { generateUuid } from "./utils/uuid";
import {
  createLogger,
  log,
  logServerError,
  makeRequestId,
  safeError,
  safeTruncate,
  type LogFn,
} from "./utils/logger";
import { remapIdReferences, remapUniqueUuids } from "./utils/remap";
import { sanitizeInteractionExamples } from "./utils/interactionExamples";
import { slugify } from "./utils/slug";
import {
  assertOpenAiKey,
  buildEnvAiConfig,
  resolveEffectiveAiConfig,
  type EffectiveAiConfig,
  DEFAULT_LOCAL_BASE_URL,
} from "./providers/config";
import {
  getErrorLogFields,
  getErrorRequestId,
  getOpenAiAccessIssue,
  isProviderConfigError,
} from "./providers/providerErrors";
import { getOrCreateTtsAsset, type TtsStorage } from "./services/ttsService";
import {
  fetchLeaderboardEntries,
  fetchUserProfileStats,
} from "./services/leaderboardService";
import { fetchProfileInsights } from "./services/profileInsightsService";
import {
  listMinigameSessions,
  softDeleteMinigameSession,
  updateMinigameResume,
} from "./services/minigameSessionsService";
import {
  NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
  InvalidTdmConfigurationError,
  MinigameRedrawConflictError,
  NoAvailableMinigameTasksError,
  NoUniquePatientStatementsLeftError,
  generateMinigameRounds,
  redrawMinigameRound,
} from "./services/minigameRoundsService";
import {
  createBatchParseJob,
  getBatchParseStatus,
  runBatchParseJob,
  type BatchParseQueueProducer,
} from "./services/adminBatchParseService";
import { selectPatientTtsProvider } from "./services/patientAudioService";
import type { PatientAudioQueueProducer } from "./services/patientAudioQueueService";
import {
  LocalEvaluationValidationError,
  validateAndDeriveLocalEvaluation,
} from "./services/localPracticeService";
import {
  AdminSourceFetchError,
  fetchAdminSourceText,
  type AdminSourceFetchDependencies,
} from "./services/adminSourceFetch";
import { runAtomicMutation } from "./db/atomic";
import {
  getMinigameLimitCode,
  MINIGAME_LIMIT_CODES,
  MINIGAME_LIMITS,
} from "./services/minigameLimits";
import {
  publishedTaskCondition,
  publishedTasksCondition,
} from "./services/taskPublication";
import type { ApiHonoEnv } from "./httpTypes";

export type ApiDependencies = {
  env: RuntimeEnv;
  db: ApiDatabase;
  tts?: {
    storage?: TtsStorage;
  };
  queues?: {
    adminBatchParse?: BatchParseQueueProducer;
    patientAudio?: PatientAudioQueueProducer;
  };
  providerOverrides?: {
    selectLlmProvider?: typeof selectLlmProvider;
    selectSttProvider?: typeof selectSttProvider;
  };
  adminSourceFetch?: AdminSourceFetchDependencies;
  sendAuthEmail?: AuthEmailSender;
};

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

class RequestBodyTooLargeError extends Error {}
class RequestBodyInvalidJsonError extends Error {}

const REQUEST_BODY_LIMITS = {
  audioPractice: 24 * 1024 * 1024,
  localPrepare: 256 * 1024,
  localCommit: 2 * 1024 * 1024,
  openAiKey: 16 * 1024,
} as const;

const readBoundedJson = async (
  c: Context,
  maxBytes: number,
): Promise<unknown> => {
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  const body = c.req.raw.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyInvalidJsonError();
  }
};

const inferLanguage = (text: string) => {
  const hasAccent = /[àâçéèêëîïôùûüÿœæ]/i.test(text);
  if (hasAccent) return "fr";
  const frenchWords = new Set([
    "je",
    "tu",
    "il",
    "elle",
    "nous",
    "vous",
    "ils",
    "elles",
    "pas",
    "mais",
    "avec",
    "pour",
    "dans",
    "être",
    "et",
    "ou",
    "où",
    "ça",
    "cette",
    "ces",
    "au",
    "aux",
    "des",
    "une",
    "un",
    "du",
    "de",
    "mon",
    "ma",
    "mes",
    "ton",
    "ta",
    "tes",
    "son",
    "sa",
    "ses",
    "leur",
    "leurs",
    "comme",
    "parce",
    "que",
    "qui",
    "quoi",
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-zà-ÿœæ]+/g, " ")
    .split(" ")
    .filter(Boolean);
  let hits = 0;
  for (const token of tokens) {
    if (frenchWords.has(token)) hits += 1;
    if (hits >= 3) return "fr";
  }
  return "en";
};

const toLogFn = (loggerInstance: ReturnType<typeof createLogger>): LogFn => {
  return (level, event, fields) => {
    switch (level) {
      case "debug":
        loggerInstance.debug(event, fields);
        break;
      case "info":
        loggerInstance.info(event, fields);
        break;
      case "warn":
        loggerInstance.warn(event, fields);
        break;
      case "error":
        loggerInstance.error(event, fields);
        break;
    }
  };
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const MAX_TTS_TEXT_LENGTH = 2000;

const checkRateLimit = (key: string) => {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return false;
  }
  bucket.count += 1;
  return true;
};

const validateOpenAiApiKey = async (
  apiKey: string,
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const resp = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (resp.ok) return { ok: true };

    if (resp.status === 401)
      return { ok: false, error: "OpenAI rejected this key (401)." };
    if (resp.status === 429)
      return { ok: false, error: "OpenAI rate-limited this key (429)." };

    return { ok: false, error: `OpenAI validation failed (${resp.status}).` };
  } catch (err) {
    console.error("OpenAI validation network error", err);
    return { ok: false, error: "Unable to reach OpenAI for validation." };
  }
};

const shuffle = <T>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const pickExamplesForDifficulty = (
  examples: TaskExample[],
  target: number,
  count: number,
) => {
  const sorted = shuffle(examples).sort(
    (a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target),
  );
  return sorted.slice(0, Math.min(count, sorted.length));
};

const normalizeAuthors = (authors?: string[] | null) => {
  if (!Array.isArray(authors)) return [];
  const seen = new Set<string>();
  return authors
    .map((author) => author.trim())
    .filter(Boolean)
    .filter((author) => {
      const key = author.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeTask = (row: typeof tasks.$inferSelect): Task => ({
  ...row,
  tags: row.tags as Task["tags"],
  authors: normalizeAuthors(row.authors as Task["authors"]),
  is_published: Boolean(row.is_published),
  general_objective: row.general_objective ?? null,
  parent_task_id: row.parent_task_id ?? null,
});

const normalizeCriterionRow = (
  row: Pick<
    typeof taskCriteria.$inferSelect,
    "id" | "label" | "description" | "rubric"
  >,
): TaskCriterion =>
  taskCriterionSchema.parse({
    id: row.id,
    label: row.label,
    description: row.description,
    rubric: row.rubric ?? undefined,
  });

const normalizeExampleRow = (
  row: typeof taskExamples.$inferSelect,
): TaskExample =>
  taskExampleSchema.parse({
    ...row,
    meta: row.meta ?? null,
  });

const toContentfulStatus = (status: number) => status as ContentfulStatusCode;

const normalizeLoopbackOrigin = (value: string): string => {
  const parsed = new URL(value.trim());
  const isLoopback =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "[::1]";
  if (
    parsed.protocol !== "http:" ||
    !isLoopback ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("Local runtime URLs must be plain loopback HTTP origins.");
  }
  return parsed.origin;
};

type MinigameAttemptScope = {
  kind: "minigame";
  session_id: string;
  round_id: string;
  player_id: string;
};

type AttemptModelInfo = {
  provider?: {
    stt?: { kind?: "local" | "openai"; model?: string } | null;
    llm?: { kind?: "local" | "openai"; model?: string } | null;
  };
  timing_ms?: { stt?: number; llm?: number; total?: number };
  input_mode?: "audio" | "typed";
  practice?: {
    mode?: string;
    turn_context?: unknown;
    scope?: MinigameAttemptScope;
  };
  score_trust?: "cloud_trusted" | "local_unverified";
  state?: string;
};

const readAttemptModelInfo = (value: unknown): AttemptModelInfo =>
  value && typeof value === "object" ? (value as AttemptModelInfo) : {};

const sameMinigameScope = (
  left: MinigameAttemptScope | undefined,
  right: MinigameAttemptScope,
) =>
  left?.kind === "minigame" &&
  left.session_id === right.session_id &&
  left.round_id === right.round_id &&
  left.player_id === right.player_id;

class MinigameSubmissionClaimError extends Error {}

const isMinigameClaimDatabaseError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "MINIGAME_SUBMISSION_CLAIM_INVALID",
    "MINIGAME_SUBMISSION_CLAIM_IMMUTABLE",
    "MINIGAME_ATTEMPT_CLAIM_INVALID",
    "MINIGAME_RESULT_CLAIM_INVALID",
  ].some((code) => message.includes(code));
};

export const createApiApp = ({
  env,
  db,
  tts,
  queues,
  providerOverrides,
  adminSourceFetch,
  sendAuthEmail,
}: ApiDependencies) => {
  const app = new Hono<ApiHonoEnv>();
  const adminAuth = createAdminAuth(env);
  const auth = createApplicationAuth(env, db, sendAuthEmail);
  const userAuth = createUserAuth(env, db, auth);
  const logger = createLogger({ service: "api" });
  const ttsStorage = tts?.storage;
  if (!ttsStorage) {
    throw new Error(
      "TTS storage is not configured. Provide tts.storage (Worker R2 binding).",
    );
  }
  const llmProviderSelector =
    providerOverrides?.selectLlmProvider ?? selectLlmProvider;
  const sttProviderSelector =
    providerOverrides?.selectSttProvider ?? selectSttProvider;

  const getUserSettingsRow = async (userId: string) => {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, userId))
      .limit(1);
    return settings ?? null;
  };

  const acquireMinigameSubmissionClaim = async ({
    roundId,
    playerId,
    requestedAttemptId,
    userId,
    taskId,
    exampleId,
    scope,
  }: {
    roundId: string;
    playerId: string;
    requestedAttemptId?: string;
    userId: string;
    taskId: string;
    exampleId: string;
    scope: MinigameAttemptScope;
  }) => {
    const candidateAttemptId = requestedAttemptId ?? nanoid();
    const readClaim = async () => {
      const [claim] = await db
        .select()
        .from(minigameSubmissionClaims)
        .where(
          or(
            and(
              eq(minigameSubmissionClaims.round_id, roundId),
              eq(minigameSubmissionClaims.player_id, playerId),
            ),
            eq(minigameSubmissionClaims.attempt_id, candidateAttemptId),
          ),
        )
        .limit(1);
      return claim;
    };
    const validateClaim = (
      claim: typeof minigameSubmissionClaims.$inferSelect | undefined,
    ) => {
      if (
        !claim ||
        claim.round_id !== roundId ||
        claim.player_id !== playerId ||
        (requestedAttemptId && claim.attempt_id !== requestedAttemptId)
      ) {
        throw new MinigameSubmissionClaimError(
          "This player or attempt was already submitted.",
        );
      }
      return claim.attempt_id;
    };
    const existingClaim = await readClaim();
    if (existingClaim) {
      return validateClaim(existingClaim);
    }

    if (requestedAttemptId) {
      const [requestedAttempt] = await db
        .select()
        .from(attempts)
        .where(eq(attempts.id, requestedAttemptId))
        .limit(1);
      const requestedScope = readAttemptModelInfo(requestedAttempt?.model_info)
        .practice?.scope;
      if (
        requestedAttempt &&
        (requestedAttempt.user_id !== userId ||
          requestedAttempt.task_id !== taskId ||
          requestedAttempt.example_id !== exampleId ||
          requestedAttempt.completed_at !== null ||
          !sameMinigameScope(requestedScope, scope))
      ) {
        throw new MinigameSubmissionClaimError(
          "Attempt is not available for this minigame submission.",
        );
      }
    }

    try {
      await db
        .insert(minigameSubmissionClaims)
        .values({
          round_id: roundId,
          player_id: playerId,
          attempt_id: candidateAttemptId,
          created_at: Date.now(),
        })
        .onConflictDoNothing();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("MINIGAME_SUBMISSION_CLAIM_INVALID")) {
        const racedClaim = await readClaim();
        if (racedClaim) {
          return validateClaim(racedClaim);
        }
        throw new MinigameSubmissionClaimError(
          "This minigame submission can no longer be started.",
        );
      }
      throw error;
    }

    return validateClaim(await readClaim());
  };

  const finalizeMinigameRoundIfReady = async ({
    roundId,
    playerBId,
  }: {
    roundId: string;
    playerBId: string | null;
  }) => {
    let shouldComplete = !playerBId;
    if (!shouldComplete) {
      const [resultCount] = await db
        .select({ count: count(minigameRoundResults.id) })
        .from(minigameRoundResults)
        .where(eq(minigameRoundResults.round_id, roundId));
      shouldComplete = (resultCount?.count ?? 0) >= 2;
    }
    if (shouldComplete) {
      await db
        .update(minigameRounds)
        .set({ status: "completed", completed_at: Date.now() })
        .where(
          and(
            eq(minigameRounds.id, roundId),
            eq(minigameRounds.status, "active"),
          ),
        );
    }
  };

  const normalizeUrl = (value?: string | null) => {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const normalizeSettings = (settings: typeof userSettings.$inferSelect) => {
    const localSttUrl = settings.local_stt_url ?? null;
    const localLlmUrl = settings.local_llm_url ?? null;
    const localBaseUrl =
      normalizeUrl(settings.local_base_url) ?? DEFAULT_LOCAL_BASE_URL;
    return {
      aiMode: settings.ai_mode,
      localAiBaseUrl: localBaseUrl,
      localSttUrl,
      localLlmUrl,
      storeAudio: false,
      hasOpenAiKey: Boolean(
        env.openaiApiKey ||
        (settings.openai_key_ciphertext && settings.openai_key_iv),
      ),
      hasPersonalOpenAiKey: Boolean(
        settings.openai_key_ciphertext && settings.openai_key_iv,
      ),
      hasServerOpenAiKey: Boolean(env.openaiApiKey),
    };
  };

  const ensureUniqueSlug = async (baseSlug: string) => {
    const normalizedBase = baseSlug || `task-${nanoid(6)}`;
    let slug = normalizedBase;
    let suffix = 1;
    while (true) {
      const [existing] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.slug, slug))
        .limit(1);
      if (!existing) return slug;
      slug = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
  };

  const validateTaskChildIdentifiers = async ({
    taskId,
    criteria,
    examples,
    interactionExamples,
  }: {
    taskId: string;
    criteria: Array<{ id: string }>;
    examples: Array<{ id: string }>;
    interactionExamples: Array<{ id: string }>;
  }) => {
    const allIds = [
      ...criteria.map((item) => item.id),
      ...examples.map((item) => item.id),
      ...interactionExamples.map((item) => item.id),
    ];
    if (new Set(allIds).size !== allIds.length) {
      return "Task child identifiers must be unique.";
    }

    if (examples.length) {
      const existingExamples = await db
        .select({ id: taskExamples.id, task_id: taskExamples.task_id })
        .from(taskExamples)
        .where(
          inArray(
            taskExamples.id,
            examples.map((item) => item.id),
          ),
        );
      if (existingExamples.some((item) => item.task_id !== taskId)) {
        return "An example identifier already belongs to another task.";
      }
    }
    if (interactionExamples.length) {
      const existingInteractions = await db
        .select({
          id: taskInteractionExamples.id,
          task_id: taskInteractionExamples.task_id,
        })
        .from(taskInteractionExamples)
        .where(
          inArray(
            taskInteractionExamples.id,
            interactionExamples.map((item) => item.id),
          ),
        );
      if (existingInteractions.some((item) => item.task_id !== taskId)) {
        return "An interaction-example identifier already belongs to another task.";
      }
    }
    return null;
  };

  const taskHistoryConflictCode = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return ["TASK_EXAMPLE_HISTORY_EXISTS", "TASK_HISTORY_EXISTS"].find((code) =>
      message.includes(code),
    );
  };

  const exampleUpsert = (
    executor: ApiDatabase,
    values: Array<typeof taskExamples.$inferInsert>,
  ) =>
    executor
      .insert(taskExamples)
      .values(values)
      .onConflictDoUpdate({
        target: taskExamples.id,
        set: {
          task_id: sql`excluded.task_id`,
          difficulty: sql`excluded.difficulty`,
          severity_label: sql`excluded.severity_label`,
          patient_text: sql`excluded.patient_text`,
          language: sql`excluded.language`,
          meta: sql`excluded.meta`,
          updated_at: sql`
            CASE
              WHEN task_examples.task_id IS excluded.task_id
                AND task_examples.difficulty IS excluded.difficulty
                AND task_examples.severity_label IS excluded.severity_label
                AND task_examples.patient_text IS excluded.patient_text
                AND task_examples.language IS excluded.language
                AND task_examples.meta IS excluded.meta
              THEN task_examples.updated_at
              ELSE excluded.updated_at
            END
          `,
        },
      });

  const buildStoredAttemptPayload = (
    attempt: typeof attempts.$inferSelect,
    requestId: string,
    additions: Record<string, unknown> = {},
  ) => {
    const evaluation = evaluationResultSchema.safeParse(attempt.evaluation);
    if (!attempt.completed_at || !evaluation.success) return null;
    const modelInfo = readAttemptModelInfo(attempt.model_info);
    const stt = modelInfo.provider?.stt;
    const llm = modelInfo.provider?.llm;
    // Attempts created before input_mode existed were audio-only. Never let a
    // later client relabel that legacy provenance as typed input.
    const inputMode = modelInfo.input_mode ?? "audio";
    return {
      requestId,
      attemptId: attempt.id,
      score_trust: attempt.score_trust,
      transcript: {
        text: attempt.transcript,
        input_mode: inputMode,
        provider:
          inputMode === "typed"
            ? null
            : {
                kind:
                  stt?.kind ??
                  (attempt.score_trust === "local_unverified"
                    ? "local"
                    : "openai"),
                model: stt?.model ?? "unknown",
              },
        duration_ms:
          inputMode === "typed" ? null : (modelInfo.timing_ms?.stt ?? 0),
      },
      scoring: {
        evaluation: evaluation.data,
        provider: {
          kind:
            llm?.kind ??
            (attempt.score_trust === "local_unverified" ? "local" : "openai"),
          model: llm?.model ?? "unknown",
        },
        duration_ms: modelInfo.timing_ms?.llm ?? 0,
      },
      ...additions,
    };
  };

  app.use(async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? makeRequestId();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const start = Date.now();
    const contentLength = c.req.header("content-length");
    log("info", "request.start", {
      requestId,
      method: c.req.method,
      path: c.req.path.startsWith("/api/auth/reset-password/")
        ? "/api/auth/reset-password/[redacted]"
        : c.req.path,
      userId: c.get("user")?.id ?? null,
      content_length: contentLength ? Number(contentLength) : null,
    });
    try {
      await next();
    } catch (error) {
      const duration = Date.now() - start;
      log("error", "request.error", {
        requestId,
        duration_ms: duration,
        stage: c.get("logStage") ?? null,
        error: safeError(error),
      });
      return c.json({ error: "Internal server error", requestId }, 500);
    } finally {
      const duration = Date.now() - start;
      const status = c.res.status || 500;
      log("info", "request.end", {
        requestId,
        status,
        duration_ms: duration,
        userId: c.get("user")?.id ?? null,
      });
    }
  });

  app.get("/api/auth/config", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      ready: Boolean(auth),
      emailPassword: Boolean(auth),
      emailDelivery: Boolean(auth && sendAuthEmail),
      providers: auth
        ? getProviderAvailability(env)
        : { google: false, github: false, apple: false },
    });
  });
  app.all("/api/auth/*", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    if (!auth)
      return c.json(
        {
          code: "AUTH_UNAVAILABLE",
          message: "Sign-in is temporarily unavailable.",
        },
        503,
      );
    if (
      !sendAuthEmail &&
      [
        "/api/auth/sign-up/email",
        "/api/auth/send-verification-email",
        "/api/auth/request-password-reset",
      ].includes(c.req.path)
    ) {
      return c.json(
        {
          code: "EMAIL_DELIVERY_UNAVAILABLE",
          message: "Email delivery is temporarily unavailable.",
        },
        503,
      );
    }
    try {
      // Bound streamed auth input before passing it to the framework.
      const request = c.req.raw;
      let forwarded = request;
      if (request.body) {
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          total += result.value.byteLength;
          if (total > 16 * 1024) {
            await reader.cancel();
            return c.json(
              { code: "BODY_TOO_LARGE", message: "Request is too large." },
              413,
            );
          }
          chunks.push(result.value);
        }
        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
        forwarded = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body,
        });
      }
      const response = await auth.handler(forwarded);
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    } catch {
      log("error", "auth.request.unavailable", {
        requestId: c.get("requestId"),
      });
      return c.json(
        {
          code: "AUTH_UNAVAILABLE",
          message: "Sign-in is temporarily unavailable.",
        },
        503,
      );
    }
  });

  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

  app.get("/api/v1/tasks", async (c) => {
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "tasks_list",
    });
    const url = new URL(c.req.url);
    const normalizeQueryParam = (value: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const tags = [
      ...url.searchParams.getAll("tag"),
      ...(url.searchParams.get("tags")?.split(",") ?? []),
    ]
      .map((tag) => tag.trim())
      .filter(Boolean);

    const querySchema = z.object({
      q: z.string().trim().min(1).optional(),
      published: z.coerce.number().int().min(0).max(1).optional(),
      language: z.string().trim().min(1).optional(),
      skill_domain: z.string().trim().min(1).optional(),
      tags: z.array(z.string()).default([]),
      difficulty_min: z.coerce.number().int().min(1).max(5).optional(),
      difficulty_max: z.coerce.number().int().min(1).max(5).optional(),
      sort: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    });

    const query = querySchema.parse({
      q: normalizeQueryParam(url.searchParams.get("q")),
      published: url.searchParams.get("published") ?? undefined,
      language: normalizeQueryParam(url.searchParams.get("language")),
      skill_domain: normalizeQueryParam(url.searchParams.get("skill_domain")),
      tags,
      difficulty_min: url.searchParams.get("difficulty_min") ?? undefined,
      difficulty_max: url.searchParams.get("difficulty_max") ?? undefined,
      sort: normalizeQueryParam(url.searchParams.get("sort")),
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });

    const filters = [publishedTasksCondition()];
    if (query.q) {
      filters.push(
        or(
          like(tasks.title, `%${query.q}%`),
          like(tasks.description, `%${query.q}%`),
          like(tasks.tags, `%${query.q}%`),
        )!,
      );
    }
    if (query.tags.length > 0) {
      const tagFilters = query.tags.map((tag) =>
        like(tasks.tags, `%"${tag}"%`),
      );
      filters.push(or(...tagFilters)!);
    }
    if (query.skill_domain) {
      filters.push(eq(tasks.skill_domain, query.skill_domain));
    }
    if (query.language) {
      filters.push(eq(tasks.language, query.language));
    }
    if (query.published === 0) {
      return c.json([]);
    }
    if (query.difficulty_min) {
      filters.push(gte(tasks.base_difficulty, query.difficulty_min));
    }
    if (query.difficulty_max) {
      filters.push(lte(tasks.base_difficulty, query.difficulty_max));
    }

    let resultsQuery = db.select().from(tasks).$dynamic();
    if (filters.length) {
      resultsQuery = resultsQuery.where(and(...filters));
    }

    const sort = query.sort;
    switch (sort) {
      case "oldest":
        resultsQuery = resultsQuery.orderBy(asc(tasks.created_at));
        break;
      case "difficulty_asc":
        resultsQuery = resultsQuery.orderBy(asc(tasks.base_difficulty));
        break;
      case "difficulty_desc":
        resultsQuery = resultsQuery.orderBy(desc(tasks.base_difficulty));
        break;
      case "title_asc":
        resultsQuery = resultsQuery.orderBy(asc(tasks.title));
        break;
      case "title_desc":
        resultsQuery = resultsQuery.orderBy(desc(tasks.title));
        break;
      default:
        resultsQuery = resultsQuery.orderBy(desc(tasks.created_at));
        break;
    }

    const results = await resultsQuery.limit(query.limit).offset(query.offset);
    log.info("Tasks fetched", { count: results.length });
    return c.json(results.map((task) => normalizeTask(task)));
  });

  app.get("/api/v1/tasks/languages", async (c) => {
    const rows = await db
      .select({ language: tasks.language })
      .from(tasks)
      .where(publishedTasksCondition())
      .groupBy(tasks.language)
      .orderBy(asc(tasks.language));
    const languages = rows.map((row) => row.language).filter(Boolean);
    return c.json({ languages });
  });

  app.get("/api/v1/tasks/tags", async (c) => {
    const rows = await db
      .select({ tags: tasks.tags })
      .from(tasks)
      .where(publishedTasksCondition());
    const values = new Set<string>();
    rows.forEach((row) => {
      const tags = Array.isArray(row.tags) ? row.tags : [];
      tags.forEach((tag) => {
        if (tag) values.add(tag);
      });
    });
    const tags = Array.from(values).sort((a, b) => a.localeCompare(b));
    return c.json({ tags });
  });

  app.get("/api/v1/tasks/skill-domains", async (c) => {
    const rows = await db
      .select({ skill_domain: tasks.skill_domain })
      .from(tasks)
      .where(publishedTasksCondition())
      .groupBy(tasks.skill_domain)
      .orderBy(asc(tasks.skill_domain));
    const skill_domains = rows.map((row) => row.skill_domain).filter(Boolean);
    return c.json({ skill_domains });
  });

  app.get("/api/v1/leaderboard", userAuth, async (c) => {
    const url = new URL(c.req.url);
    const tags = [
      ...url.searchParams.getAll("tag"),
      ...(url.searchParams.get("tags")?.split(",") ?? []),
    ]
      .map((tag) => tag.trim())
      .filter(Boolean);

    const querySchema = z.object({
      tags: z.array(z.string()).default([]),
      skill_domain: z.string().min(1).nullable().default(null),
      language: z.string().min(1).nullable().default(null),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    });

    const query = querySchema.parse({
      tags,
      skill_domain: url.searchParams.get("skill_domain"),
      language: url.searchParams.get("language"),
      limit: url.searchParams.get("limit") ?? undefined,
    });

    const entries = await fetchLeaderboardEntries(db, {
      tags: query.tags,
      skillDomain: query.skill_domain,
      language: query.language,
      limit: query.limit,
    });

    return c.json({
      query: {
        tags: query.tags,
        skill_domain: query.skill_domain,
        language: query.language,
        limit: query.limit,
      },
      entries,
      generated_at: Date.now(),
    });
  });

  app.get("/api/v1/profiles/:id", userAuth, async (c) => {
    const user = c.get("user");
    const profileId = c.req.param("id");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "profile_public",
      profileId,
    });

    const [row] = await db
      .select({
        id: users.id,
        display_name: users.display_name,
        bio: users.bio,
        is_profile_public: users.is_profile_public,
        created_at: users.created_at,
      })
      .from(users)
      .where(eq(users.id, profileId))
      .limit(1);

    if (!row) {
      log.warn("Profile not found");
      return c.json({ error: "Not found" }, 404);
    }

    if (!row.is_profile_public && user.id !== row.id) {
      log.warn("Profile is private");
      return c.json({ error: "Profile is private" }, 403);
    }

    const [stats, insights] = await Promise.all([
      fetchUserProfileStats(db, row.id),
      fetchProfileInsights(db, row.id),
    ]);
    log.info("Public profile fetched");

    return c.json({
      profile: {
        id: row.id,
        display_name: row.display_name,
        bio: row.bio ?? null,
        created_at: new Date(row.created_at).toISOString(),
        stats: {
          average_score: stats.average_score,
          tasks_played: stats.tasks_played,
          last_active_at: stats.last_active_at
            ? new Date(stats.last_active_at).toISOString()
            : null,
        },
        insights,
      },
    });
  });

  app.get("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const includeInteractions = c.req.query("include_interactions") === "1";
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "tasks_get",
      taskId: id,
    });
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(publishedTaskCondition(id))
      .limit(1);
    if (!taskRow) {
      log.warn("Task not found");
      return c.json({ error: "Not found" }, 404);
    }
    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, id))
      .orderBy(taskCriteria.sort_order);
    const exampleRows = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.task_id, id));
    const interactionRows = includeInteractions
      ? await db
          .select()
          .from(taskInteractionExamples)
          .where(eq(taskInteractionExamples.task_id, id))
          .orderBy(taskInteractionExamples.difficulty)
      : [];
    const counts = exampleRows.reduce<Record<number, number>>(
      (acc, example) => {
        acc[example.difficulty] = (acc[example.difficulty] ?? 0) + 1;
        return acc;
      },
      {},
    );
    log.info("Task detail fetched", {
      criteria: criteriaRows.length,
      examples: exampleRows.length,
      interactionExamples: interactionRows.length,
    });
    return c.json({
      ...normalizeTask(taskRow),
      criteria: criteriaRows.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        description: criterion.description,
        rubric: criterion.rubric ?? undefined,
      })),
      example_counts: counts,
      ...(includeInteractions
        ? {
            interaction_examples: interactionRows.map((example) => ({
              id: example.id,
              difficulty: example.difficulty,
              title: example.title ?? null,
              patient_text: example.patient_text,
              therapist_text: example.therapist_text,
            })),
          }
        : {}),
    });
  });

  app.get("/api/v1/tasks/:id/examples", async (c) => {
    const taskId = c.req.param("id");
    const { difficulty, limit, exclude } = c.req.query();
    const excludeIds = exclude
      ? exclude.split(",").map((value) => value.trim())
      : [];
    const [taskRow] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(publishedTaskCondition(taskId))
      .limit(1);
    if (!taskRow) {
      return c.json({ error: "Not found" }, 404);
    }
    const filters = [eq(taskExamples.task_id, taskId)];
    if (difficulty) {
      filters.push(eq(taskExamples.difficulty, Number(difficulty)));
    }
    const rows = await db
      .select()
      .from(taskExamples)
      .where(filters.length > 1 ? and(...filters) : filters[0]);
    const filtered = rows.filter((row) => !excludeIds.includes(row.id));
    const limited = limit ? filtered.slice(0, Number(limit)) : filtered;
    return c.json(
      limited.map((example) => ({
        ...example,
        meta: example.meta ?? null,
      })),
    );
  });

  app.post("/api/v1/sessions/start", userAuth, async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "sessions_start",
    });
    const body = await c.req.json();
    const schema = z.object({
      mode: z.enum(["single_task", "mixed_set"]),
      task_id: z.string().optional(),
      item_count: z.number().min(1).max(25),
      difficulty: z.number().min(1).max(5).optional(),
    });
    const data = schema.parse(body);

    const sessionId = nanoid();
    const createdAt = Date.now();
    const selectedItems: Array<{
      session_item_id: string;
      task_id: string;
      example_id: string;
      target_difficulty: number;
      patient_text: string;
    }> = [];
    const attemptRows = await db
      .select({ task_id: attempts.task_id, example_id: attempts.example_id })
      .from(attempts)
      .where(eq(attempts.user_id, user.id));
    const attemptMap = attemptRows.reduce((map, row) => {
      const existing = map.get(row.task_id) ?? new Set<string>();
      existing.add(row.example_id);
      map.set(row.task_id, existing);
      return map;
    }, new Map<string, Set<string>>());

    if (data.mode === "single_task") {
      if (!data.task_id) {
        return c.json({ error: "task_id is required for single_task" }, 400);
      }
      const [taskRow] = await db
        .select()
        .from(tasks)
        .where(publishedTaskCondition(data.task_id))
        .limit(1);
      if (!taskRow) {
        return c.json({ error: "Task not found" }, 404);
      }
      const task = normalizeTask(taskRow);
      const [progress] = await db
        .select()
        .from(userTaskProgress)
        .where(
          and(
            eq(userTaskProgress.user_id, user.id),
            eq(userTaskProgress.task_id, task.id),
          ),
        )
        .limit(1);
      const targetDifficulty =
        data.difficulty ?? progress?.current_difficulty ?? task.base_difficulty;
      const examples = await db
        .select()
        .from(taskExamples)
        .where(eq(taskExamples.task_id, task.id));
      const normalized = examples.map(normalizeExampleRow);
      const attemptedIds = attemptMap.get(task.id) ?? new Set<string>();
      const fresh = normalized.filter(
        (example) => !attemptedIds.has(example.id),
      );
      const pool = fresh.length >= data.item_count ? fresh : normalized;
      const picked = pickExamplesForDifficulty(
        pool,
        targetDifficulty,
        data.item_count,
      );
      picked.forEach((example, index) => {
        selectedItems.push({
          session_item_id: nanoid(),
          task_id: task.id,
          example_id: example.id,
          target_difficulty: targetDifficulty,
          patient_text: example.patient_text,
        });
      });
    } else {
      const taskRows = await db
        .select()
        .from(tasks)
        .where(publishedTasksCondition());
      if (!taskRows.length) {
        return c.json({ error: "No tasks available" }, 400);
      }
      const taskList = taskRows.map((row) => normalizeTask(row));
      const progressRows = await db
        .select()
        .from(userTaskProgress)
        .where(eq(userTaskProgress.user_id, user.id));
      const progressMap = new Map(
        progressRows.map((row) => [row.task_id, row]),
      );
      const weighted = [...taskList].sort((a, b) => {
        const aProgress = progressMap.get(a.id)?.attempt_count ?? 0;
        const bProgress = progressMap.get(b.id)?.attempt_count ?? 0;
        return aProgress - bProgress;
      });
      const chosenTasks = shuffle(weighted).slice(
        0,
        Math.min(weighted.length, data.item_count),
      );
      for (const task of chosenTasks) {
        const targetDifficulty =
          progressMap.get(task.id)?.current_difficulty ?? task.base_difficulty;
        const examples = await db
          .select()
          .from(taskExamples)
          .where(eq(taskExamples.task_id, task.id));
        const normalized = examples.map(normalizeExampleRow);
        const attemptedIds = attemptMap.get(task.id) ?? new Set<string>();
        const fresh = normalized.filter(
          (example) => !attemptedIds.has(example.id),
        );
        const pool = fresh.length ? fresh : normalized;
        const picked = pickExamplesForDifficulty(pool, targetDifficulty, 1);
        const example = picked[0];
        if (!example) continue;
        selectedItems.push({
          session_item_id: nanoid(),
          task_id: task.id,
          example_id: example.id,
          target_difficulty: targetDifficulty,
          patient_text: example.patient_text,
        });
      }
    }

    if (!selectedItems.length) {
      return c.json({ error: "No examples available for this session." }, 400);
    }

    const sessionValues = {
      id: sessionId,
      user_id: user.id,
      mode: data.mode,
      source_task_id:
        data.mode === "single_task" ? (data.task_id ?? null) : null,
      random_seed: nanoid(),
      created_at: createdAt,
      ended_at: null,
    };
    const sessionItemValues = selectedItems.map((item, index) => ({
      id: item.session_item_id,
      session_id: sessionId,
      position: index,
      task_id: item.task_id,
      example_id: item.example_id,
      target_difficulty: item.target_difficulty,
      created_at: createdAt,
    }));
    await runAtomicMutation(db, (executor) => [
      executor.insert(practiceSessions).values(sessionValues),
      executor.insert(practiceSessionItems).values(sessionItemValues),
    ]);

    log.info("Session created", { sessionId, itemCount: selectedItems.length });
    return c.json({ session_id: sessionId, items: selectedItems });
  });

  app.get("/api/v1/sessions", userAuth, async (c) => {
    const user = c.get("user");
    const { task_id: taskId } = c.req.query();
    const filters = [eq(practiceSessions.user_id, user.id)];
    if (taskId) {
      filters.push(eq(practiceSessions.source_task_id, taskId));
    }
    const sessionWhere = filters.length > 1 ? and(...filters) : filters[0];

    const sessions = await db
      .select()
      .from(practiceSessions)
      .where(sessionWhere)
      .orderBy(desc(practiceSessions.created_at));

    if (!sessions.length) {
      return c.json([]);
    }

    const sessionIds = sessions.map((session) => session.id);
    const items: Array<{
      session_id: string | null;
      session_item_id: string;
      task_id: string;
      example_id: string | null;
      target_difficulty: number | null;
      patient_text: string | null;
      position: number | null;
    }> = [];
    const rawItems = await db
      .select({
        session_id: practiceSessionItems.session_id,
        session_item_id: practiceSessionItems.id,
        task_id: practiceSessionItems.task_id,
        example_id: practiceSessionItems.example_id,
        target_difficulty: practiceSessionItems.target_difficulty,
        patient_text: taskExamples.patient_text,
        position: practiceSessionItems.position,
      })
      .from(practiceSessionItems)
      .innerJoin(
        tasks,
        and(
          eq(practiceSessionItems.task_id, tasks.id),
          publishedTasksCondition(),
        ),
      )
      .leftJoin(
        taskExamples,
        eq(practiceSessionItems.example_id, taskExamples.id),
      )
      .where(inArray(practiceSessionItems.session_id, sessionIds))
      .orderBy(practiceSessionItems.session_id, practiceSessionItems.position);
    for (const item of rawItems) {
      if (!item.session_id) continue;
      items.push(item);
    }

    items.sort((a, b) => {
      if (a.session_id === b.session_id) {
        return (a.position ?? 0) - (b.position ?? 0);
      }
      return (a.session_id ?? "").localeCompare(b.session_id ?? "");
    });

    const attemptsRows: Array<{
      session_id: string | null;
      session_item_id: string | null;
    }> = [];
    const rawAttempts = await db
      .select({
        session_id: attempts.session_id,
        session_item_id: attempts.session_item_id,
      })
      .from(attempts)
      .where(
        and(
          eq(attempts.user_id, user.id),
          inArray(attempts.session_id, sessionIds),
          isNotNull(attempts.completed_at),
        ),
      );
    attemptsRows.push(...rawAttempts);

    const attemptsBySession = attemptsRows.reduce((map, row) => {
      if (!row.session_id || !row.session_item_id) return map;
      const existing = map.get(row.session_id) ?? new Set<string>();
      existing.add(row.session_item_id);
      map.set(row.session_id, existing);
      return map;
    }, new Map<string, Set<string>>());

    const itemsBySession = items.reduce((map, item) => {
      if (
        !item.session_id ||
        !item.example_id ||
        item.target_difficulty === null
      ) {
        return map;
      }
      const entry = map.get(item.session_id) ?? [];
      entry.push({
        session_item_id: item.session_item_id,
        task_id: item.task_id,
        example_id: item.example_id,
        target_difficulty: item.target_difficulty,
        patient_text: item.patient_text ?? "",
      });
      map.set(item.session_id, entry);
      return map;
    }, new Map<string, Array<{ session_item_id: string; task_id: string; example_id: string; target_difficulty: number; patient_text: string }>>());

    return c.json(
      sessions.map((session) => {
        const sessionItems = itemsBySession.get(session.id) ?? [];
        const completed =
          attemptsBySession.get(session.id) ?? new Set<string>();
        return {
          id: session.id,
          mode: session.mode,
          source_task_id: session.source_task_id ?? null,
          created_at: session.created_at,
          ended_at: session.ended_at ?? null,
          item_count: sessionItems.length,
          completed_count: completed.size,
          items: sessionItems,
        };
      }),
    );
  });

  app.get("/api/v1/sessions/:id", userAuth, async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select()
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.id, sessionId),
          eq(practiceSessions.user_id, user.id),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const items = await db
      .select({
        session_item_id: practiceSessionItems.id,
        task_id: practiceSessionItems.task_id,
        example_id: practiceSessionItems.example_id,
        target_difficulty: practiceSessionItems.target_difficulty,
        patient_text: taskExamples.patient_text,
        position: practiceSessionItems.position,
      })
      .from(practiceSessionItems)
      .innerJoin(
        tasks,
        and(
          eq(practiceSessionItems.task_id, tasks.id),
          publishedTasksCondition(),
        ),
      )
      .leftJoin(
        taskExamples,
        eq(practiceSessionItems.example_id, taskExamples.id),
      )
      .where(eq(practiceSessionItems.session_id, sessionId))
      .orderBy(practiceSessionItems.position);

    return c.json({
      id: session.id,
      mode: session.mode,
      source_task_id: session.source_task_id ?? null,
      created_at: session.created_at,
      ended_at: session.ended_at ?? null,
      items: items.map((item) => ({
        session_item_id: item.session_item_id,
        task_id: item.task_id,
        example_id: item.example_id,
        target_difficulty: item.target_difficulty,
        patient_text: item.patient_text ?? "",
      })),
    });
  });

  app.get("/api/v1/sessions/:id/attempts", userAuth, async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.id, sessionId),
          eq(practiceSessions.user_id, user.id),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const attemptRows = await db
      .select({
        id: attempts.id,
        session_item_id: attempts.session_item_id,
        completed_at: attempts.completed_at,
        transcript: attempts.transcript,
        evaluation: attempts.evaluation,
        overall_score: attempts.overall_score,
        overall_pass: attempts.overall_pass,
        score_trust: attempts.score_trust,
        model_info: attempts.model_info,
      })
      .from(attempts)
      .where(
        and(
          eq(attempts.user_id, user.id),
          eq(attempts.session_id, sessionId),
          isNotNull(attempts.completed_at),
        ),
      )
      .orderBy(desc(attempts.completed_at));

    const latestByItem = new Map<
      string,
      {
        id: string;
        session_item_id: string;
        completed_at: number | null;
        transcript: string;
        evaluation: unknown | null;
        overall_score: number;
        overall_pass: boolean;
        score_trust: string;
        scoring_provider?: { kind: "local" | "openai"; model: string } | null;
      }
    >();

    for (const attempt of attemptRows) {
      if (!attempt.session_item_id) continue;
      if (!latestByItem.has(attempt.session_item_id)) {
        const evaluation =
          attempt.evaluation &&
          evaluationResultSchema.safeParse(attempt.evaluation).success
            ? attempt.evaluation
            : null;
        const { model_info, ...publicAttempt } = attempt;
        const llm = readAttemptModelInfo(model_info).provider?.llm;
        latestByItem.set(attempt.session_item_id, {
          ...publicAttempt,
          scoring_provider:
            llm?.model && (llm.kind === "openai" || llm.kind === "local")
              ? { kind: llm.kind, model: llm.model }
              : null,
          session_item_id: attempt.session_item_id,
          evaluation,
        });
      }
    }

    return c.json(Array.from(latestByItem.values()));
  });

  app.delete("/api/v1/sessions/:id", userAuth, async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(
        and(
          eq(practiceSessions.id, sessionId),
          eq(practiceSessions.user_id, user.id),
        ),
      )
      .limit(1);

    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await runAtomicMutation(db, (executor) => [
      executor.delete(attempts).where(
        and(
          eq(attempts.user_id, user.id),
          eq(attempts.session_id, sessionId),
          sql`EXISTS (
              SELECT 1
              FROM ${practiceSessions}
              WHERE ${practiceSessions.id} = ${attempts.session_id}
                AND ${practiceSessions.user_id} = ${user.id}
            )`,
        ),
      ),
      executor.delete(practiceSessionItems).where(
        and(
          eq(practiceSessionItems.session_id, sessionId),
          sql`EXISTS (
            SELECT 1
            FROM ${practiceSessions}
            WHERE ${practiceSessions.id} = ${practiceSessionItems.session_id}
              AND ${practiceSessions.user_id} = ${user.id}
          )`,
        ),
      ),
      executor
        .delete(practiceSessions)
        .where(
          and(
            eq(practiceSessions.id, sessionId),
            eq(practiceSessions.user_id, user.id),
          ),
        ),
    ]);

    return c.json({ ok: true });
  });

  app.get("/api/v1/admin/whoami", async (c) => {
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "admin_whoami",
    });
    const result = await resolveAdminStatus(env, c.req.raw.headers);
    if (!result.ok) {
      if (result.status >= 500) {
        logServerError("admin.whoami.error", new Error(result.message), {
          requestId: c.get("requestId"),
          status: result.status,
        });
      } else {
        log.warn("Admin whoami failed", { status: result.status });
      }
      return c.json(
        { isAuthenticated: false, isAdmin: false, email: null },
        result.status >= 500 ? 500 : 200,
      );
    }
    const { identity } = result;
    log.info("Admin whoami resolved", {
      isAuthenticated: identity.isAuthenticated,
      isAdmin: result.isAdmin,
    });
    return c.json({
      isAuthenticated: identity.isAuthenticated,
      isAdmin: identity.isAuthenticated ? result.isAdmin : false,
      email: identity.email,
    });
  });

  app.use("/api/v1/admin/*", adminAuth);

  app.use("/api/v1/me/*", userAuth);
  app.use("/api/v1/attempts", userAuth);
  app.use("/api/v1/attempts/*", userAuth);
  app.use("/api/v1/minigames/*", userAuth);
  app.use("/api/v1/practice/*", userAuth);
  app.use("/api/v1/sessions/*", userAuth);

  const ttsConfigReady = Boolean(env.r2Bucket);
  const patientAudioQueue = queues?.patientAudio;

  const handleTtsRequest = async (
    c: Context<ApiHonoEnv, "/api/v1/tts/:cacheKey">,
  ) => {
    const requestId = c.get("requestId");
    const cacheKey = c.req.param("cacheKey");
    const logEvent = (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields = {},
    ) => log(level, event, { requestId, cache_key: cacheKey, ...fields });

    if (!ttsConfigReady) {
      logServerError(
        "tts.config.missing",
        new Error("TTS storage is not configured."),
        {
          requestId,
          cache_key: cacheKey,
        },
      );
      return c.json({ error: "TTS storage is not configured." }, 500);
    }

    const [asset] = await db
      .select()
      .from(ttsAssets)
      .where(eq(ttsAssets.cache_key, cacheKey))
      .limit(1);

    if (!asset || asset.status !== "ready") {
      return c.json({ error: "TTS asset not found." }, 404);
    }

    const [publishedAssociation] = await db
      .select({ id: taskExamples.id })
      .from(taskExamples)
      .innerJoin(tasks, eq(taskExamples.task_id, tasks.id))
      .where(
        and(
          eq(taskExamples.patient_text, asset.text),
          eq(tasks.is_published, true),
        ),
      )
      .limit(1);

    if (!publishedAssociation) {
      return c.json({ error: "TTS asset not found." }, 404);
    }

    try {
      const object = await ttsStorage.getObject(env.r2Bucket, asset.r2_key);
      const headers: Record<string, string> = {
        "Content-Type": asset.content_type ?? object.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      const etag = asset.etag ?? object.etag;
      if (etag) {
        headers.ETag = etag;
      }
      if (c.req.method === "HEAD") {
        return c.body(null, 200, headers);
      }
      const body = object.body.buffer.slice(
        object.body.byteOffset,
        object.body.byteOffset + object.body.byteLength,
      ) as ArrayBuffer;
      return c.body(body, 200, headers);
    } catch (error) {
      logEvent("error", "tts.fetch.error", { error: safeError(error) });
      return c.json({ error: "TTS asset unavailable." }, 404);
    }
  };

  app.get("/api/v1/tts/:cacheKey", handleTtsRequest);
  app.on("HEAD", "/api/v1/tts/:cacheKey", handleTtsRequest);

  app.post("/api/v1/practice/patient-audio/prefetch", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const logEvent = (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields = {},
    ) => log(level, event, { requestId, userId: user?.id ?? null, ...fields });

    const schema = z.object({
      exercise_id: z.string(),
      practice_mode: z.literal("real_time"),
      statement_id: z.string().optional(),
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, MINIGAME_LIMITS.mutationBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "The prefetch payload is too large." }, 413);
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json({ error: "Invalid prefetch payload." }, 400);
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logEvent("warn", "tts.prefetch.invalid_input");
      return c.json({ error: "Invalid prefetch payload." }, 400);
    }

    const { exercise_id: exerciseId, statement_id: statementId } = parsed.data;
    const [publishedTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, exerciseId), eq(tasks.is_published, true)))
      .limit(1);
    if (!publishedTask) {
      return c.json({ error: "Exercise not found." }, 404);
    }
    let patientText: string | null = null;
    let resolvedStatementId: string | null = statementId ?? null;

    if (statementId) {
      const [example] = await db
        .select()
        .from(taskExamples)
        .where(eq(taskExamples.id, statementId))
        .limit(1);
      if (!example || example.task_id !== exerciseId) {
        return c.json({ error: "Statement not found for exercise." }, 404);
      }
      resolvedStatementId = example.id;
      patientText = example.patient_text;
    } else {
      const [example] = await db
        .select()
        .from(taskExamples)
        .where(eq(taskExamples.task_id, exerciseId))
        .orderBy(taskExamples.difficulty)
        .limit(1);
      if (!example) {
        return c.json({ error: "Exercise has no patient prompt." }, 404);
      }
      resolvedStatementId = example.id;
      patientText = example.patient_text;
    }

    if (!ttsConfigReady) {
      logServerError(
        "tts.config.missing",
        new Error("TTS storage is not configured."),
        {
          requestId,
          userId: user?.id ?? null,
        },
      );
      return c.json({ error: "TTS storage is not configured." }, 500);
    }
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "tts.prefetch.settings_missing");
      return c.json({ error: "Settings not found." }, 404);
    }

    let config: EffectiveAiConfig;
    try {
      config = await resolveEffectiveAiConfig({
        env,
        settings,
        decryptOpenAiKey,
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "tts.prefetch.config_error", { code: error.code });
        return c.json(
          { error: error.message, code: error.code },
          toContentfulStatus(error.status),
        );
      }
      logServerError("tts.prefetch.config_error", error as Error, {
        requestId,
        userId: user?.id ?? null,
      });
      return c.json({ error: "TTS configuration failed." }, 500);
    }

    if (patientText.length > MAX_TTS_TEXT_LENGTH) {
      logEvent("warn", "tts.prefetch.text_too_long", {
        text_length: patientText.length,
      });
      return c.json({ error: "Patient text too long for TTS." }, 400);
    }

    let ttsProvider: Awaited<ReturnType<typeof selectPatientTtsProvider>>;
    try {
      ttsProvider = await selectPatientTtsProvider({ env, config, logEvent });
    } catch (error) {
      logEvent("error", "tts.select.error", { error: safeError(error) });
      return c.json(
        { error: (error as Error).message || "TTS unavailable." },
        502,
      );
    }

    try {
      const result = await getOrCreateTtsAsset(
        db,
        env,
        ttsStorage,
        ttsProvider,
        {
          text: patientText,
          voice: ttsProvider.voice,
          model: ttsProvider.model,
          format: ttsProvider.format,
        },
        logEvent,
        { skipGenerate: Boolean(patientAudioQueue), retryAfterMs: 1500 },
      );

      if (result.status === "generating") {
        if (patientAudioQueue && resolvedStatementId) {
          try {
            await patientAudioQueue.send({
              userId: user.id,
              exerciseId,
              statementId: resolvedStatementId,
              text: patientText,
              requestId,
            });
            logEvent("info", "tts.prefetch.queue_enqueued", {
              statement_id: resolvedStatementId,
              cache_key: result.cacheKey,
            });
          } catch (queueError) {
            logEvent("error", "tts.prefetch.queue_error", {
              error: safeError(queueError),
              statement_id: resolvedStatementId,
              cache_key: result.cacheKey,
            });
          }
        }
        return c.json(
          {
            cache_key: result.cacheKey,
            status: "generating",
            retry_after_ms: result.retryAfterMs,
          },
          202,
        );
      }

      return c.json({
        cache_key: result.cacheKey,
        audio_url: result.audioUrl,
        status: "ready",
      });
    } catch (error) {
      const errorRequestId = getErrorRequestId(error);
      const errorLogFields = getErrorLogFields(error);
      logEvent("error", "tts.prefetch.error", {
        error: safeError(error),
        error_request_id: errorRequestId,
        error_log_fields: errorLogFields,
        exercise_id: exerciseId,
        statement_id: resolvedStatementId ?? null,
        text_length: patientText.length,
        provider: {
          kind: ttsProvider.kind,
          model: ttsProvider.model,
          voice: ttsProvider.voice,
          format: ttsProvider.format,
        },
      });
      return c.json({ error: "TTS generation failed." }, 500);
    }
  });

  app.post("/api/v1/practice/patient-audio/prefetch-batch", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const logEvent = (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields = {},
    ) => log(level, event, { requestId, userId: user?.id ?? null, ...fields });

    const schema = z.object({
      exercise_id: z.string(),
      practice_mode: z.literal("real_time"),
      statement_ids: z.array(z.string()).min(1),
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, MINIGAME_LIMITS.mutationBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "The prefetch payload is too large." }, 413);
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json({ error: "Invalid prefetch payload." }, 400);
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logEvent("warn", "tts.prefetch_batch.invalid_input");
      return c.json({ error: "Invalid prefetch payload." }, 400);
    }

    const { exercise_id: exerciseId, statement_ids: statementIds } =
      parsed.data;
    const [publishedTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, exerciseId), eq(tasks.is_published, true)))
      .limit(1);
    if (!publishedTask) {
      return c.json({ error: "Exercise not found." }, 404);
    }
    const examples = await db
      .select()
      .from(taskExamples)
      .where(
        and(
          eq(taskExamples.task_id, exerciseId),
          inArray(taskExamples.id, statementIds),
        ),
      );
    const exampleMap = new Map(
      examples.map((example) => [example.id, example]),
    );
    if (exampleMap.size !== statementIds.length) {
      return c.json({ error: "Statement not found for exercise." }, 404);
    }

    const tooLong = statementIds.find((statementId) => {
      const text = exampleMap.get(statementId)?.patient_text ?? "";
      return text.length > MAX_TTS_TEXT_LENGTH;
    });
    if (tooLong) {
      logEvent("warn", "tts.prefetch_batch.text_too_long");
      return c.json({ error: "Patient text too long for TTS." }, 400);
    }

    if (!ttsConfigReady) {
      logServerError(
        "tts.config.missing",
        new Error("TTS storage is not configured."),
        {
          requestId,
          userId: user?.id ?? null,
        },
      );
      return c.json({ error: "TTS storage is not configured." }, 500);
    }
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "tts.prefetch.settings_missing");
      return c.json({ error: "Settings not found." }, 404);
    }

    let config: EffectiveAiConfig;
    try {
      config = await resolveEffectiveAiConfig({
        env,
        settings,
        decryptOpenAiKey,
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "tts.prefetch_batch.config_error", {
          code: error.code,
        });
        return c.json(
          { error: error.message, code: error.code },
          toContentfulStatus(error.status),
        );
      }
      logServerError("tts.prefetch_batch.config_error", error as Error, {
        requestId,
        userId: user?.id ?? null,
      });
      return c.json({ error: "TTS configuration failed." }, 500);
    }

    let ttsProvider: Awaited<ReturnType<typeof selectPatientTtsProvider>>;
    try {
      ttsProvider = await selectPatientTtsProvider({ env, config, logEvent });
    } catch (error) {
      logEvent("error", "tts.select.error", { error: safeError(error) });
      return c.json(
        { error: (error as Error).message || "TTS unavailable." },
        502,
      );
    }

    try {
      const results = await Promise.all(
        statementIds.map(async (statementId) => {
          const example = exampleMap.get(statementId);
          if (!example) {
            return {
              statement_id: statementId,
              cache_key: "",
              status: "generating" as const,
              retry_after_ms: 500,
            };
          }
          const result = await getOrCreateTtsAsset(
            db,
            env,
            ttsStorage,
            ttsProvider,
            {
              text: example.patient_text,
              voice: ttsProvider.voice,
              model: ttsProvider.model,
              format: ttsProvider.format,
            },
            logEvent,
            { skipGenerate: Boolean(patientAudioQueue), retryAfterMs: 1500 },
          );

          if (result.status === "ready") {
            return {
              statement_id: statementId,
              cache_key: result.cacheKey,
              status: "ready" as const,
              audio_url: result.audioUrl,
            };
          }

          return {
            statement_id: statementId,
            cache_key: result.cacheKey,
            status: "generating" as const,
            retry_after_ms: result.retryAfterMs,
          };
        }),
      );

      if (patientAudioQueue) {
        await Promise.all(
          results
            .filter((item) => item.status === "generating")
            .map(async (item) => {
              const example = exampleMap.get(item.statement_id);
              if (!example) return;
              try {
                await patientAudioQueue.send({
                  userId: user.id,
                  exerciseId,
                  statementId: item.statement_id,
                  text: example.patient_text,
                  requestId,
                });
                logEvent("info", "tts.prefetch_batch.queue_enqueued", {
                  statement_id: item.statement_id,
                  cache_key: item.cache_key,
                });
              } catch (queueError) {
                logEvent("error", "tts.prefetch_batch.queue_error", {
                  error: safeError(queueError),
                  statement_id: item.statement_id,
                  cache_key: item.cache_key,
                });
              }
            }),
        );
      }

      const readyCount = results.filter(
        (item) => item.status === "ready",
      ).length;
      return c.json({
        items: results,
        ready_count: readyCount,
        total_count: results.length,
      });
    } catch (error) {
      const errorRequestId = getErrorRequestId(error);
      const errorLogFields = getErrorLogFields(error);
      const textLengths = statementIds.map(
        (statementId) => exampleMap.get(statementId)?.patient_text.length ?? 0,
      );
      logEvent("error", "tts.prefetch_batch.error", {
        error: safeError(error),
        error_request_id: errorRequestId,
        error_log_fields: errorLogFields,
        exercise_id: exerciseId,
        statement_ids: statementIds,
        text_lengths: textLengths,
        provider: {
          kind: ttsProvider.kind,
          model: ttsProvider.model,
          voice: ttsProvider.voice,
          format: ttsProvider.format,
        },
      });
      return c.json({ error: "TTS generation failed." }, 500);
    }
  });

  const batchParseSchema = z.object({
    sourceText: z.string().min(1),
    parseMode: z.enum(["original", "exact", "partial_prompt"]).optional(),
  });

  app.post("/api/v1/admin/parse/batch", async (c) => {
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "admin_batch_parse_start",
    });
    const body = batchParseSchema.parse(await c.req.json());
    const sourceText = body.sourceText.trim();
    if (!sourceText) {
      log.warn("Batch parse missing source text");
      return c.json({ error: "Source text is required" }, 400);
    }
    const parseMode = body.parseMode ?? "original";
    const jobId = await createBatchParseJob(db, sourceText, parseMode);
    const jobLogger = toLogFn(
      log.child({ jobId, component: "batch_parse_job" }),
    );
    const runner = async () =>
      runBatchParseJob(
        db,
        env,
        jobId,
        { sourceText, parseMode },
        { logger: jobLogger },
      );
    const execCtx = (
      c as Context & {
        executionCtx?: { waitUntil: (promise: Promise<unknown>) => void };
      }
    ).executionCtx;
    const queueProducer = queues?.adminBatchParse;
    if (queueProducer) {
      await queueProducer.send({ jobId });
    } else if (execCtx?.waitUntil) {
      execCtx.waitUntil(runner());
    } else {
      setTimeout(() => {
        void runner();
      }, 0);
    }
    log.info("Batch parse job queued", {
      jobId,
      transport: queueProducer ? "queue" : "inline",
    });
    return c.json({ jobId });
  });

  app.get("/api/v1/admin/parse/batch/:jobId", async (c) => {
    const jobId = c.req.param("jobId");
    const afterParam = Number(c.req.query("afterEventId") ?? "0");
    const afterEventId = Number.isFinite(afterParam) ? afterParam : 0;
    const result = await getBatchParseStatus(db, jobId, afterEventId);
    if (!result) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(result);
  });

  app.post("/api/v1/admin/parse-task", async (c) => {
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "admin_parse_task",
    });
    const logEvent = toLogFn(log);
    const body = await c.req.json();
    const schema = z.object({
      free_text: z.string().optional().default(""),
      source_url: z.string().nullable().optional(),
      parse_mode: z
        .enum(["original", "exact", "partial_prompt"])
        .default("exact"),
    });
    const data = schema.parse(body);
    log.info("Parse task request received", {
      hasSourceUrl: Boolean(data.source_url),
      hasFreeText: Boolean(data.free_text?.trim()),
      parseMode: data.parse_mode,
    });
    let sourceText = data.free_text?.trim() ?? "";
    if (!sourceText && data.source_url) {
      if (!adminSourceFetch) {
        log.warn("Source URL fetch unavailable", {
          reason: "secure_fetch_not_configured",
        });
        return c.json(
          {
            error:
              "Source URL import is unavailable. Paste the source text instead.",
          },
          400,
        );
      }
      try {
        const html = await fetchAdminSourceText(
          data.source_url,
          adminSourceFetch,
        );
        sourceText = stripHtml(html);
      } catch (error) {
        const code =
          error instanceof AdminSourceFetchError ? error.code : "fetch_failed";
        log.warn("Source URL fetch rejected", { code });
        return c.json(
          {
            error:
              "The source URL could not be imported safely. Paste the source text instead.",
          },
          400,
        );
      }
    }
    if (!sourceText) {
      log.warn("Parse task missing source text");
      return c.json({ error: "Provide free_text or source_url" }, 400);
    }
    const inferredLanguage = inferLanguage(sourceText);
    if (!env.openaiApiKey) {
      logServerError(
        "admin.parse_task.openai_key_missing",
        new Error("OpenAI key missing"),
        {
          requestId: c.get("requestId"),
        },
      );
      return c.json({ error: "OpenAI key missing" }, 500);
    }
    let llmProvider;
    try {
      const selection = await llmProviderSelector(
        buildEnvAiConfig(env, "openai_only"),
        logEvent,
      );
      llmProvider = selection.provider;
    } catch (error) {
      log.error("LLM provider selection failed", { error: safeError(error) });
      return c.json({ error: "OpenAI LLM unavailable" }, 500);
    }

    let parsed;
    try {
      parsed = await llmProvider.parseExercise({
        sourceText,
        parseMode: data.parse_mode,
      });
    } catch (error) {
      log.error("LLM parse failed", { error: safeError(error) });
      return c.json({ error: "OpenAI parse failed" }, 500);
    }

    const { items: criteria, idMap: criteriaIdMap } = remapUniqueUuids(
      parsed.criteria,
      "criteria",
      log,
    );
    const { items: examples, idMap: exampleIdMap } = remapUniqueUuids(
      parsed.examples,
      "examples",
      log,
    );
    const { items: interactionExamples, idMap: interactionIdMap } =
      remapUniqueUuids(
        parsed.interaction_examples ?? [],
        "interaction_examples",
        log,
      );
    const normalizedParsed = remapIdReferences(
      {
        ...parsed,
        task: {
          ...parsed.task,
          language: inferredLanguage,
        },
        criteria,
        examples: examples.map((example) => ({
          ...example,
          language: example.language ?? inferredLanguage,
        })),
        interaction_examples: interactionExamples,
      },
      [criteriaIdMap, exampleIdMap, interactionIdMap],
    );

    const validated =
      deliberatePracticeTaskV2Schema.safeParse(normalizedParsed);
    if (!validated.success) {
      log.warn("Mapped parse response failed validation");
      return c.json(
        {
          error: "Mapped parse response failed validation",
          details: validated.error.flatten(),
        },
        400,
      );
    }
    log.info("Parse task completed");
    return c.json(validated.data);
  });

  app.post("/api/v1/admin/import-task", async (c) => {
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "admin_import_task",
    });
    const body = await c.req.json();
    const schema = z.object({
      task_v2: deliberatePracticeTaskV2Schema,
      task_overrides: z
        .object({
          id: z.string().optional(),
          slug: z.string().optional(),
          is_published: z.boolean().optional(),
        })
        .optional(),
    });
    const data = schema.parse(body);
    const parsedTask = data.task_v2;
    const taskLanguage = parsedTask.task.language ?? "en";
    const interactionExamples = sanitizeInteractionExamples(
      parsedTask.interaction_examples,
      log,
    );
    const slug = data.task_overrides?.slug ?? slugify(parsedTask.task.title);
    const now = Date.now();

    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.slug, slug))
      .limit(1);
    const taskId = existing?.id ?? data.task_overrides?.id ?? nanoid();
    const childIdError = await validateTaskChildIdentifiers({
      taskId,
      criteria: parsedTask.criteria,
      examples: parsedTask.examples,
      interactionExamples,
    });
    if (childIdError) {
      return c.json({ error: childIdError }, 409);
    }
    const taskValues = {
      id: taskId,
      slug,
      title: parsedTask.task.title,
      description: parsedTask.task.description,
      skill_domain: parsedTask.task.skill_domain,
      base_difficulty: parsedTask.task.base_difficulty,
      general_objective: parsedTask.task.general_objective ?? null,
      tags: parsedTask.task.tags,
      authors: existing
        ? normalizeAuthors(existing.authors as Task["authors"])
        : [],
      language: taskLanguage,
      is_published:
        data.task_overrides?.is_published ?? existing?.is_published ?? false,
      parent_task_id: existing?.parent_task_id ?? null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    const criterionValues = parsedTask.criteria.map((criterion, index) => ({
      task_id: taskId,
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      rubric: criterion.rubric ?? null,
      sort_order: index,
    }));
    const exampleValues = parsedTask.examples.map((example) => ({
      id: example.id,
      task_id: taskId,
      difficulty: example.difficulty,
      severity_label: example.severity_label ?? null,
      patient_text: example.patient_text,
      language: example.language ?? taskLanguage,
      meta: example.meta ?? null,
      created_at: now,
      updated_at: now,
    }));
    const interactionValues = interactionExamples.map((example) => ({
      id: example.id,
      task_id: taskId,
      difficulty: example.difficulty,
      title: example.title ?? null,
      patient_text: example.patient_text,
      therapist_text: example.therapist_text,
      language: taskLanguage,
      meta: null,
      created_at: now,
      updated_at: now,
    }));

    try {
      await runAtomicMutation(db, (executor) => {
        const statements: Array<{ run?: () => unknown }> = existing
          ? [
              executor
                .update(tasks)
                .set(taskValues)
                .where(eq(tasks.id, taskId)),
              executor
                .delete(taskCriteria)
                .where(eq(taskCriteria.task_id, taskId)),
              executor
                .delete(taskInteractionExamples)
                .where(eq(taskInteractionExamples.task_id, taskId)),
            ]
          : [executor.insert(tasks).values(taskValues)];
        if (criterionValues.length) {
          statements.push(
            executor.insert(taskCriteria).values(criterionValues),
          );
        }
        if (exampleValues.length) {
          statements.push(exampleUpsert(executor, exampleValues));
        }
        if (existing) {
          statements.push(
            exampleValues.length
              ? executor.delete(taskExamples).where(
                  and(
                    eq(taskExamples.task_id, taskId),
                    notInArray(
                      taskExamples.id,
                      exampleValues.map((example) => example.id),
                    ),
                  ),
                )
              : executor
                  .delete(taskExamples)
                  .where(eq(taskExamples.task_id, taskId)),
          );
        }
        if (interactionValues.length) {
          statements.push(
            executor.insert(taskInteractionExamples).values(interactionValues),
          );
        }
        return statements;
      });
    } catch (error) {
      if (taskHistoryConflictCode(error)) {
        return c.json(
          {
            error:
              "A referenced patient example cannot be changed or removed. Create a new task version instead.",
          },
          409,
        );
      }
      throw error;
    }
    log.info(existing ? "Task imported (updated)" : "Task imported (created)", {
      taskId,
      slug,
    });
    return c.json({ id: taskId, slug });
  });

  app.get("/api/v1/admin/tasks", async (c) => {
    const rows = await db.select().from(tasks);
    return c.json(rows.map((row) => normalizeTask(row)));
  });

  const createTaskSchema = z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    skill_domain: z.string().min(1),
    base_difficulty: z.number().min(1).max(5),
    general_objective: z.string().nullable().optional(),
    tags: z.array(z.string()),
    authors: z.array(z.string()).optional(),
    language: z.string().optional(),
    is_published: z.boolean().optional(),
    criteria: z.array(taskCriterionSchema).optional(),
    examples: z.array(taskExampleSchema).optional(),
    interaction_examples: z.array(taskInteractionExampleSchema).optional(),
  });

  app.post("/api/v1/admin/tasks", async (c) => {
    const body = await c.req.json();
    const parsed = createTaskSchema.parse(body);
    const now = Date.now();
    const taskId = nanoid();
    const slug = await ensureUniqueSlug(slugify(parsed.title));
    const taskLanguage = parsed.language ?? "en";
    const taskValues = {
      id: taskId,
      slug,
      title: parsed.title,
      description: parsed.description,
      skill_domain: parsed.skill_domain,
      base_difficulty: parsed.base_difficulty,
      general_objective: parsed.general_objective ?? null,
      tags: parsed.tags,
      authors: normalizeAuthors(parsed.authors),
      language: taskLanguage,
      is_published: parsed.is_published ?? false,
      parent_task_id: null,
      created_at: now,
      updated_at: now,
    };
    const criterionValues = (parsed.criteria ?? []).map((criterion, index) => ({
      task_id: taskId,
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      rubric: criterion.rubric ?? null,
      sort_order: index,
    }));
    const exampleValues = (parsed.examples ?? []).map((example) => ({
      id: example.id ?? nanoid(),
      task_id: taskId,
      difficulty: example.difficulty,
      severity_label: example.severity_label ?? null,
      patient_text: example.patient_text,
      language: example.language ?? taskLanguage,
      meta: example.meta ?? null,
      created_at: now,
      updated_at: now,
    }));
    const interactionValues = (parsed.interaction_examples ?? []).map(
      (example) => ({
        id: example.id ?? nanoid(),
        task_id: taskId,
        difficulty: example.difficulty,
        title: example.title ?? null,
        patient_text: example.patient_text,
        therapist_text: example.therapist_text,
        language: taskLanguage,
        meta: null,
        created_at: now,
        updated_at: now,
      }),
    );
    const childIdError = await validateTaskChildIdentifiers({
      taskId,
      criteria: criterionValues,
      examples: exampleValues,
      interactionExamples: interactionValues,
    });
    if (childIdError) {
      return c.json({ error: childIdError }, 409);
    }
    await runAtomicMutation(db, (executor) => {
      const statements: Array<{ run?: () => unknown }> = [
        executor.insert(tasks).values(taskValues),
      ];
      if (criterionValues.length) {
        statements.push(executor.insert(taskCriteria).values(criterionValues));
      }
      if (exampleValues.length) {
        statements.push(executor.insert(taskExamples).values(exampleValues));
      }
      if (interactionValues.length) {
        statements.push(
          executor.insert(taskInteractionExamples).values(interactionValues),
        );
      }
      return statements;
    });

    return c.json({ id: taskId, slug });
  });

  app.get("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!taskRow) return c.json({ error: "Not found" }, 404);
    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, id))
      .orderBy(taskCriteria.sort_order);
    const exampleRows = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.task_id, id));
    const interactionRows = await db
      .select()
      .from(taskInteractionExamples)
      .where(eq(taskInteractionExamples.task_id, id))
      .orderBy(taskInteractionExamples.difficulty);
    return c.json({
      ...normalizeTask(taskRow),
      criteria: criteriaRows.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        description: criterion.description,
        rubric: criterion.rubric ?? undefined,
      })),
      examples: exampleRows.map((example) => ({
        ...example,
        meta: example.meta ?? null,
      })),
      interaction_examples: interactionRows.map((example) => ({
        id: example.id,
        difficulty: example.difficulty,
        title: example.title ?? null,
        patient_text: example.patient_text,
        therapist_text: example.therapist_text,
      })),
    });
  });

  app.post("/api/v1/admin/tasks/:id/duplicate", async (c) => {
    const id = c.req.param("id");
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!taskRow) return c.json({ error: "Not found" }, 404);

    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, id))
      .orderBy(taskCriteria.sort_order);
    const exampleRows = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.task_id, id));
    const interactionRows = await db
      .select()
      .from(taskInteractionExamples)
      .where(eq(taskInteractionExamples.task_id, id))
      .orderBy(taskInteractionExamples.difficulty);

    const now = Date.now();
    const newTaskId = nanoid();
    const slug = await ensureUniqueSlug(slugify(`${taskRow.title}-copy`));
    const taskValues = {
      ...taskRow,
      id: newTaskId,
      slug,
      title: `${taskRow.title} (Copy)`,
      created_at: now,
      updated_at: now,
    };
    const criterionValues = criteriaRows.map((criterion) => ({
      task_id: newTaskId,
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      rubric: criterion.rubric ?? null,
      sort_order: criterion.sort_order,
    }));
    const exampleValues = exampleRows.map((example) => ({
      id: nanoid(),
      task_id: newTaskId,
      difficulty: example.difficulty,
      severity_label: example.severity_label ?? null,
      patient_text: example.patient_text,
      language: example.language,
      meta: example.meta ?? null,
      created_at: now,
      updated_at: now,
    }));
    const interactionValues = interactionRows.map((example) => ({
      id: nanoid(),
      task_id: newTaskId,
      difficulty: example.difficulty,
      title: example.title ?? null,
      patient_text: example.patient_text,
      therapist_text: example.therapist_text,
      language: example.language,
      meta: example.meta ?? null,
      created_at: now,
      updated_at: now,
    }));
    const childIdError = await validateTaskChildIdentifiers({
      taskId: newTaskId,
      criteria: criterionValues,
      examples: exampleValues,
      interactionExamples: interactionValues,
    });
    if (childIdError) {
      return c.json({ error: childIdError }, 409);
    }
    await runAtomicMutation(db, (executor) => {
      const statements: Array<{ run?: () => unknown }> = [
        executor.insert(tasks).values(taskValues),
      ];
      if (criterionValues.length) {
        statements.push(executor.insert(taskCriteria).values(criterionValues));
      }
      if (exampleValues.length) {
        statements.push(executor.insert(taskExamples).values(exampleValues));
      }
      if (interactionValues.length) {
        statements.push(
          executor.insert(taskInteractionExamples).values(interactionValues),
        );
      }
      return statements;
    });

    return c.json({ id: newTaskId, slug });
  });

  app.post("/api/v1/admin/tasks/:id/translate", async (c) => {
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "admin_translate_task",
    });
    const logEvent = toLogFn(log);
    const id = c.req.param("id");
    const body = await c.req.json();
    const schema = z.object({
      target_language: z.enum(["en", "fr"]),
    });
    const data = schema.parse(body);
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!taskRow) return c.json({ error: "Not found" }, 404);
    if (data.target_language === taskRow.language) {
      return c.json({ error: "Target language matches task language" }, 400);
    }

    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, id))
      .orderBy(taskCriteria.sort_order);
    const exampleRows = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.task_id, id));
    const interactionRows = await db
      .select()
      .from(taskInteractionExamples)
      .where(eq(taskInteractionExamples.task_id, id))
      .orderBy(taskInteractionExamples.difficulty);

    if (!env.openaiApiKey) {
      logServerError(
        "admin.translate_task.openai_key_missing",
        new Error("OpenAI key missing"),
        {
          requestId: c.get("requestId"),
        },
      );
      return c.json({ error: "OpenAI key missing" }, 500);
    }

    let llmProvider;
    try {
      const selection = await llmProviderSelector(
        buildEnvAiConfig(env, "openai_only"),
        logEvent,
      );
      llmProvider = selection.provider;
    } catch (error) {
      log.error("LLM provider selection failed", { error: safeError(error) });
      return c.json({ error: "OpenAI LLM unavailable" }, 500);
    }

    let translated;
    try {
      translated = await llmProvider.translateTask({
        source: {
          version: "2.1",
          task: {
            title: taskRow.title,
            description: taskRow.description,
            skill_domain: taskRow.skill_domain,
            base_difficulty: taskRow.base_difficulty,
            general_objective: taskRow.general_objective ?? null,
            tags: taskRow.tags as Task["tags"],
            language: taskRow.language,
          },
          criteria: criteriaRows.map(normalizeCriterionRow),
          examples: exampleRows.map(normalizeExampleRow),
          interaction_examples: interactionRows.map((example) => ({
            id: example.id,
            difficulty: example.difficulty,
            title: example.title ?? null,
            patient_text: example.patient_text,
            therapist_text: example.therapist_text,
          })),
        },
        targetLanguage: data.target_language,
      });
    } catch (error) {
      log.error("LLM translation failed", { error: safeError(error) });
      return c.json({ error: "OpenAI translation failed" }, 500);
    }

    const now = Date.now();
    const newTaskId = nanoid();
    const slug = await ensureUniqueSlug(slugify(translated.task.title));
    const taskValues = {
      id: newTaskId,
      slug,
      title: translated.task.title,
      description: translated.task.description,
      skill_domain: translated.task.skill_domain,
      base_difficulty: translated.task.base_difficulty,
      general_objective: translated.task.general_objective ?? null,
      tags: translated.task.tags,
      authors: normalizeAuthors(taskRow.authors as Task["authors"]),
      language: data.target_language,
      is_published: taskRow.is_published,
      parent_task_id: taskRow.id,
      created_at: now,
      updated_at: now,
    };
    const criterionValues = translated.criteria.map((criterion, index) => ({
      task_id: newTaskId,
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      rubric: criterion.rubric ?? null,
      sort_order: index,
    }));
    const exampleValues = translated.examples.map((example) => ({
      id: nanoid(),
      task_id: newTaskId,
      difficulty: example.difficulty,
      severity_label: example.severity_label ?? null,
      patient_text: example.patient_text,
      language: example.language ?? data.target_language,
      meta: example.meta ?? null,
      created_at: now,
      updated_at: now,
    }));

    const translatedInteractionExamples = sanitizeInteractionExamples(
      translated.interaction_examples,
      log,
    );
    const interactionValues = translatedInteractionExamples.map((example) => ({
      id: nanoid(),
      task_id: newTaskId,
      difficulty: example.difficulty,
      title: example.title ?? null,
      patient_text: example.patient_text,
      therapist_text: example.therapist_text,
      language: data.target_language,
      meta: null,
      created_at: now,
      updated_at: now,
    }));
    const childIdError = await validateTaskChildIdentifiers({
      taskId: newTaskId,
      criteria: criterionValues,
      examples: exampleValues,
      interactionExamples: interactionValues,
    });
    if (childIdError) {
      return c.json({ error: childIdError }, 409);
    }
    await runAtomicMutation(db, (executor) => {
      const statements: Array<{ run?: () => unknown }> = [
        executor.insert(tasks).values(taskValues),
      ];
      if (criterionValues.length) {
        statements.push(executor.insert(taskCriteria).values(criterionValues));
      }
      if (exampleValues.length) {
        statements.push(executor.insert(taskExamples).values(exampleValues));
      }
      if (interactionValues.length) {
        statements.push(
          executor.insert(taskInteractionExamples).values(interactionValues),
        );
      }
      return statements;
    });

    return c.json({ id: newTaskId, slug });
  });

  app.put("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "admin_update_task",
      taskId: id,
    });
    const body = await c.req.json();
    const parsed = taskSchema
      .extend({
        criteria: z.array(taskCriterionSchema).optional(),
        examples: z.array(taskExampleSchema).optional(),
        interaction_examples: z.array(taskInteractionExampleSchema).optional(),
      })
      .parse(body);
    const now = Date.now();
    const taskLanguage = parsed.language ?? "en";
    const interactionExamples =
      parsed.interaction_examples === undefined
        ? undefined
        : sanitizeInteractionExamples(parsed.interaction_examples, log);
    const [existingTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!existingTask) {
      return c.json({ error: "Not found" }, 404);
    }
    const childIdError = await validateTaskChildIdentifiers({
      taskId: id,
      criteria: parsed.criteria ?? [],
      examples: parsed.examples ?? [],
      interactionExamples: interactionExamples ?? [],
    });
    if (childIdError) {
      return c.json({ error: childIdError }, 409);
    }

    const replacementExamples = parsed.examples?.map((example) => ({
      id: example.id,
      task_id: id,
      difficulty: example.difficulty,
      severity_label: example.severity_label ?? null,
      patient_text: example.patient_text,
      language: example.language ?? taskLanguage,
      meta: example.meta ?? null,
      created_at: now,
      updated_at: now,
    }));
    try {
      await runAtomicMutation(db, (executor) => {
        const statements: Array<{ run?: () => unknown }> = [
          executor
            .update(tasks)
            .set({
              slug: parsed.slug,
              title: parsed.title,
              description: parsed.description,
              skill_domain: parsed.skill_domain,
              base_difficulty: parsed.base_difficulty,
              general_objective: parsed.general_objective ?? null,
              tags: parsed.tags,
              authors: normalizeAuthors(parsed.authors),
              language: taskLanguage,
              is_published: parsed.is_published,
              parent_task_id: parsed.parent_task_id ?? null,
              updated_at: now,
            })
            .where(eq(tasks.id, id)),
        ];
        if (parsed.criteria) {
          statements.push(
            executor.delete(taskCriteria).where(eq(taskCriteria.task_id, id)),
          );
          if (parsed.criteria.length) {
            statements.push(
              executor.insert(taskCriteria).values(
                parsed.criteria.map((criterion, index) => ({
                  task_id: id,
                  id: criterion.id,
                  label: criterion.label,
                  description: criterion.description,
                  rubric: criterion.rubric ?? null,
                  sort_order: index,
                })),
              ),
            );
          }
        }
        if (replacementExamples) {
          if (replacementExamples.length) {
            statements.push(exampleUpsert(executor, replacementExamples));
            statements.push(
              executor.delete(taskExamples).where(
                and(
                  eq(taskExamples.task_id, id),
                  notInArray(
                    taskExamples.id,
                    replacementExamples.map((example) => example.id),
                  ),
                ),
              ),
            );
          } else {
            statements.push(
              executor.delete(taskExamples).where(eq(taskExamples.task_id, id)),
            );
          }
        }
        if (interactionExamples !== undefined) {
          statements.push(
            executor
              .delete(taskInteractionExamples)
              .where(eq(taskInteractionExamples.task_id, id)),
          );
        }
        if (interactionExamples?.length) {
          statements.push(
            executor.insert(taskInteractionExamples).values(
              interactionExamples.map((example) => ({
                id: example.id,
                task_id: id,
                difficulty: example.difficulty,
                title: example.title ?? null,
                patient_text: example.patient_text,
                therapist_text: example.therapist_text,
                language: taskLanguage,
                meta: null,
                created_at: now,
                updated_at: now,
              })),
            ),
          );
        }
        return statements;
      });
    } catch (error) {
      if (taskHistoryConflictCode(error)) {
        return c.json(
          {
            error:
              "A referenced patient example cannot be changed or removed. Create a new task version instead.",
          },
          409,
        );
      }
      throw error;
    }

    return c.json({ status: "updated" });
  });

  app.delete("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    if (!task) {
      return c.json({ error: "Not found" }, 404);
    }
    const references = await Promise.all([
      db
        .select({ id: attempts.id })
        .from(attempts)
        .where(eq(attempts.task_id, id))
        .limit(1),
      db
        .select({ id: practiceSessionItems.id })
        .from(practiceSessionItems)
        .where(eq(practiceSessionItems.task_id, id))
        .limit(1),
      db
        .select({ id: practiceSessions.id })
        .from(practiceSessions)
        .where(eq(practiceSessions.source_task_id, id))
        .limit(1),
      db
        .select({ id: minigameRounds.id })
        .from(minigameRounds)
        .where(eq(minigameRounds.task_id, id))
        .limit(1),
      db
        .select({ user_id: userTaskProgress.user_id })
        .from(userTaskProgress)
        .where(eq(userTaskProgress.task_id, id))
        .limit(1),
      db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.parent_task_id, id))
        .limit(1),
    ]);
    if (references.some((rows) => rows.length > 0)) {
      return c.json(
        {
          error:
            "This task has learner or translated-task history. Unpublish it instead of deleting it.",
        },
        409,
      );
    }
    try {
      await runAtomicMutation(db, (executor) => [
        executor.delete(tasks).where(eq(tasks.id, id)),
        executor
          .delete(taskInteractionExamples)
          .where(eq(taskInteractionExamples.task_id, id)),
      ]);
    } catch (error) {
      if (taskHistoryConflictCode(error)) {
        return c.json(
          {
            error:
              "This task has learner or translated-task history. Unpublish it instead of deleting it.",
          },
          409,
        );
      }
      throw error;
    }
    return c.json({ status: "deleted" });
  });

  app.get("/api/v1/me", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me" });
    const [record] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    const settings = await getUserSettingsRow(user.id);
    log.info("User profile fetched", { userId: user.id });
    return c.json({
      id: user.id,
      email: user.email,
      display_name: record?.display_name ?? "Player",
      bio: record?.bio ?? null,
      is_profile_public: record?.is_profile_public ?? false,
      created_at: record?.created_at
        ? new Date(record.created_at).toISOString()
        : null,
      hasOpenAiKey: Boolean(
        env.openaiApiKey ||
        (settings?.openai_key_ciphertext && settings?.openai_key_iv),
      ),
      hasPersonalOpenAiKey: Boolean(
        settings?.openai_key_ciphertext && settings?.openai_key_iv,
      ),
      hasServerOpenAiKey: Boolean(env.openaiApiKey),
    });
  });

  app.put("/api/v1/me/profile", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "me_profile_update",
    });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      log.warn("Invalid JSON body for profile", { error: safeError(error) });
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const schema = z.object({
      displayName: z
        .string()
        .trim()
        .min(2, "Display name is too short.")
        .max(40, "Display name is too long."),
      bio: z.string().trim().max(160, "Bio is too long.").optional().nullable(),
      isPublicProfile: z.boolean().optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.warn("Profile payload failed validation", { userId: user.id });
      return c.json(
        { error: "Invalid profile payload", details: parsed.error.flatten() },
        400,
      );
    }
    const data = parsed.data;
    const normalizedBio = data.bio?.trim() || null;
    const isPublicProfile = data.isPublicProfile ?? false;
    await db
      .update(users)
      .set({
        display_name: data.displayName,
        bio: normalizedBio,
        is_profile_public: isPublicProfile,
      })
      .where(eq(users.id, user.id));
    log.info("Profile updated", { userId: user.id });
    return c.json({
      ok: true,
      display_name: data.displayName,
      bio: normalizedBio,
      is_profile_public: isPublicProfile,
    });
  });

  app.get("/api/v1/me/settings", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "me_settings_get",
    });
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      log.warn("Settings not found", { userId: user.id });
      return c.json({ error: "Settings not found" }, 404);
    }
    log.info("Settings fetched", { userId: user.id });
    return c.json(normalizeSettings(settings));
  });

  app.put("/api/v1/me/settings", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "me_settings_update",
    });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      log.warn("Invalid JSON body for settings", { error: safeError(error) });
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const nullableUrl = z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().url().nullable().optional(),
    );
    const schema = z.object({
      aiMode: z.enum(["local_prefer", "openai_only", "local_only"]),
      localAiBaseUrl: nullableUrl,
      localSttUrl: nullableUrl,
      localLlmUrl: nullableUrl,
      storeAudio: z.boolean().optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.warn("Settings payload failed validation", { userId: user.id });
      return c.json(
        { error: "Invalid settings payload", details: parsed.error.flatten() },
        400,
      );
    }
    const data = parsed.data;
    const submittedUrls = [
      normalizeUrl(data.localAiBaseUrl),
      normalizeUrl(data.localSttUrl),
      normalizeUrl(data.localLlmUrl),
    ].filter((value): value is string => Boolean(value));
    let localOrigins: string[];
    try {
      localOrigins = [...new Set(submittedUrls.map(normalizeLoopbackOrigin))];
    } catch {
      return c.json(
        {
          error:
            "The local runtime URL must be a plain http://localhost, http://127.0.0.1, or http://[::1] origin.",
        },
        400,
      );
    }
    if (localOrigins.length > 1) {
      return c.json(
        {
          error:
            "Speech recognition and evaluation must use the same local gateway origin.",
        },
        400,
      );
    }
    const resolvedBase = localOrigins[0] ?? DEFAULT_LOCAL_BASE_URL;
    await db
      .update(userSettings)
      .set({
        ai_mode: data.aiMode,
        local_base_url: resolvedBase,
        local_stt_url: null,
        local_llm_url: null,
        store_audio: false,
        updated_at: Date.now(),
      })
      .where(eq(userSettings.user_id, user.id));
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      log.warn("Settings not found after update", { userId: user.id });
      return c.json({ error: "Settings not found" }, 404);
    }
    log.info("Settings updated", { userId: user.id });
    return c.json(normalizeSettings(settings));
  });

  app.put("/api/v1/me/openai-key", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "me_openai_key_update",
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, REQUEST_BODY_LIMITS.openAiKey);
    } catch (error) {
      log.warn("Invalid JSON body for OpenAI key", { error: safeError(error) });
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "OpenAI key payload is too large" }, 413);
      }
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const schema = z.object({
      openaiApiKey: z
        .string()
        .trim()
        .min(20)
        .max(512)
        .refine((value) => value.startsWith("sk-"), {
          message: "Invalid OpenAI key",
        }),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.warn("OpenAI key payload failed validation", { userId: user.id });
      return c.json({ error: "Invalid OpenAI key" }, 400);
    }
    const data = parsed.data;
    if (!env.openaiKeyEncryptionSecret) {
      logServerError(
        "me.openai_key.update.missing_secret",
        new Error("OPENAI_KEY_ENCRYPTION_SECRET is not configured"),
        { requestId: c.get("requestId"), userId: user.id },
      );
      return c.json(
        { error: "OPENAI_KEY_ENCRYPTION_SECRET is not configured" },
        500,
      );
    }
    const encrypted = await encryptOpenAiKey(
      env.openaiKeyEncryptionSecret,
      data.openaiApiKey,
    );
    await db
      .update(userSettings)
      .set({
        openai_key_ciphertext: encrypted.ciphertextB64,
        openai_key_iv: encrypted.ivB64,
        openai_key_kid: encrypted.kid,
        updated_at: Date.now(),
      })
      .where(eq(userSettings.user_id, user.id));
    log.info("OpenAI key updated", { userId: user.id });
    return c.json({ ok: true, hasOpenAiKey: true });
  });

  app.delete("/api/v1/me/openai-key", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "me_openai_key_delete",
    });
    await db
      .update(userSettings)
      .set({
        openai_key_ciphertext: null,
        openai_key_iv: null,
        openai_key_kid: null,
        updated_at: Date.now(),
      })
      .where(eq(userSettings.user_id, user.id));
    log.info("OpenAI key deleted", { userId: user.id });
    return c.json({ ok: true, hasOpenAiKey: Boolean(env.openaiApiKey) });
  });

  app.post("/api/v1/me/openai-key/validate", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "me_openai_key_validate",
    });
    if (!checkRateLimit(`openai-validate:${user.id}`)) {
      log.warn("OpenAI key validation rate limited", { userId: user.id });
      return c.json(
        {
          ok: false,
          error: "Too many validation attempts. Try again shortly.",
        },
        429,
      );
    }
    let body: unknown;
    try {
      body = (await readBoundedJson(c, REQUEST_BODY_LIMITS.openAiKey)) ?? {};
    } catch (error) {
      log.warn("Invalid JSON body for OpenAI key validation", {
        error: safeError(error),
      });
      if (error instanceof RequestBodyTooLargeError) {
        return c.json(
          { ok: false, error: "OpenAI key payload is too large" },
          413,
        );
      }
      return c.json({ ok: false, error: "Invalid JSON body" }, 400);
    }
    const parsed = z
      .object({
        openaiApiKey: z.string().trim().max(512).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ ok: false, error: "Invalid OpenAI key payload" }, 400);
    }
    const provided = parsed.data.openaiApiKey ?? "";

    let keyToValidate = provided;

    if (!keyToValidate) {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.user_id, user.id))
        .limit(1);

      const record = rows[0];
      if (
        (!record?.openai_key_ciphertext || !record?.openai_key_iv) &&
        env.openaiApiKey
      ) {
        keyToValidate = env.openaiApiKey;
      } else {
        if (!record?.openai_key_ciphertext || !record?.openai_key_iv) {
          return c.json(
            { ok: false, error: "No key provided and no key stored." },
            400,
          );
        }

        if (!env.openaiKeyEncryptionSecret) {
          logServerError(
            "me.openai_key.validate.missing_secret",
            new Error("OPENAI_KEY_ENCRYPTION_SECRET is not set."),
            { requestId: c.get("requestId"), userId: user.id },
          );
          return c.json(
            {
              ok: false,
              error:
                "Server misconfigured: OPENAI_KEY_ENCRYPTION_SECRET is not set.",
            },
            500,
          );
        }

        keyToValidate = await decryptOpenAiKey(env.openaiKeyEncryptionSecret, {
          ciphertextB64: record.openai_key_ciphertext,
          ivB64: record.openai_key_iv,
        });
      }
    }

    const result = await validateOpenAiApiKey(keyToValidate);
    if (result.ok) {
      log.info("OpenAI key validated", { userId: user.id });
    } else {
      log.warn("OpenAI key validation failed", {
        userId: user.id,
        error: result.error,
      });
    }
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/api/v1/attempts", async (c) => {
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "attempts_list",
      userId: user.id,
    });
    const { task_id } = c.req.query();
    const filters = [
      eq(attempts.user_id, user.id),
      isNotNull(attempts.completed_at),
    ];
    if (task_id) {
      filters.push(eq(attempts.task_id, task_id));
    }
    const results = await db
      .select({
        id: attempts.id,
        completed_at: attempts.completed_at,
        overall_score: attempts.overall_score,
        overall_pass: attempts.overall_pass,
        score_trust: attempts.score_trust,
        session_id: attempts.session_id,
        task_id: attempts.task_id,
        task_title: tasks.title,
        example_id: attempts.example_id,
        example_difficulty: taskExamples.difficulty,
      })
      .from(attempts)
      .innerJoin(tasks, eq(attempts.task_id, tasks.id))
      .innerJoin(taskExamples, eq(attempts.example_id, taskExamples.id))
      .where(filters.length > 1 ? and(...filters) : filters[0]);
    log.info("Attempts fetched", {
      count: results.length,
      taskId: task_id ?? null,
    });
    return c.json(
      results.map((attempt) => ({
        id: attempt.id,
        task_id: attempt.task_id,
        task_title: attempt.task_title,
        example_id: attempt.example_id,
        example_difficulty: attempt.example_difficulty,
        session_id: attempt.session_id,
        overall_score: attempt.overall_score,
        overall_pass: attempt.overall_pass,
        score_trust: attempt.score_trust,
        completed_at: new Date(
          attempt.completed_at ?? Date.now(),
        ).toISOString(),
      })),
    );
  });

  const runPracticeAttempt = async ({
    body,
    debugEnabled,
    logEvent,
    requestId,
    user,
    minigameScope,
    claimedMinigameAttemptId,
  }: {
    body: unknown;
    debugEnabled: boolean;
    logEvent: (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields?: Record<string, unknown>,
    ) => void;
    requestId: string;
    user: { id: string };
    minigameScope?: MinigameAttemptScope;
    claimedMinigameAttemptId?: string;
  }): Promise<{
    status: number;
    payload: Record<string, unknown>;
    attemptId?: string;
    overallScore?: number;
    overallPass?: boolean;
  }> => {
    const timings: Record<string, number> = {};
    const errors: PracticeRunError[] = [];

    logEvent("info", "practice.run.start");

    const inputParseStart = Date.now();
    const parsedInput = practiceRunInputSchema.safeParse(body);
    if (!parsedInput.success) {
      logEvent("warn", "input.parse.error", {
        issues: parsedInput.error.flatten().fieldErrors,
      });
      return {
        status: 400,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Invalid practice payload." }],
        },
      };
    }
    const input = parsedInput.data;
    if (!input.session_item_id && !(input.task_id && input.example_id)) {
      return {
        status: 400,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message: "Provide session_item_id or task_id + example_id.",
            },
          ],
        },
      };
    }
    const transcriptOverride = input.transcript_text?.trim() ?? "";
    const usesProvidedTranscript = transcriptOverride.length > 0;
    const usesAudioInput = Boolean(input.audio);
    const audioLength = input.audio?.length ?? 0;
    const minAudioLength = 128;
    timings.input_parse = Date.now() - inputParseStart;

    if (!checkRateLimit(`practice:${user.id}`)) {
      logEvent("warn", "practice.run.rate_limited");
      return {
        status: 429,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Too many practice requests." }],
        },
      };
    }

    logEvent("info", "auth.context.start");
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "auth.context.error");
      return {
        status: 404,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Settings not found." }],
        },
      };
    }

    let taskId = input.task_id ?? null;
    let exampleId = input.example_id ?? null;
    let sessionId: string | null = null;
    let sessionItemId: string | null = null;

    if (input.session_item_id) {
      const [itemRow] = await db
        .select({
          id: practiceSessionItems.id,
          session_id: practiceSessionItems.session_id,
          task_id: practiceSessionItems.task_id,
          example_id: practiceSessionItems.example_id,
          owner_id: practiceSessions.user_id,
        })
        .from(practiceSessionItems)
        .innerJoin(
          practiceSessions,
          eq(practiceSessionItems.session_id, practiceSessions.id),
        )
        .where(eq(practiceSessionItems.id, input.session_item_id))
        .limit(1);
      if (!itemRow || itemRow.owner_id !== user.id) {
        return {
          status: 404,
          payload: {
            requestId,
            errors: [{ stage: "input", message: "Session item not found." }],
          },
        };
      }
      sessionItemId = itemRow.id;
      sessionId = itemRow.session_id;
      taskId = itemRow.task_id;
      exampleId = itemRow.example_id;
    }

    if (!taskId || !exampleId) {
      return {
        status: 400,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Task or example missing." }],
        },
      };
    }
    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(publishedTaskCondition(taskId))
      .limit(1);
    if (!taskRow) {
      return {
        status: 404,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Task not found." }],
        },
      };
    }

    const [attemptById] = input.attempt_id
      ? await db
          .select()
          .from(attempts)
          .where(eq(attempts.id, input.attempt_id))
          .limit(1)
      : [];
    const mayCreateClaimedMinigameAttempt =
      Boolean(minigameScope) &&
      Boolean(claimedMinigameAttemptId) &&
      input.attempt_id === claimedMinigameAttemptId;
    if (
      input.attempt_id &&
      ((!attemptById && !mayCreateClaimedMinigameAttempt) ||
        (attemptById && attemptById.user_id !== user.id))
    ) {
      return {
        status: 404,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Attempt not found." }],
        },
      };
    }
    const existingAttempt = attemptById;
    if (
      existingAttempt &&
      (existingAttempt.task_id !== taskId ||
        existingAttempt.example_id !== exampleId ||
        existingAttempt.session_item_id !== sessionItemId)
    ) {
      return {
        status: 409,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message: "Attempt context does not match this practice item.",
            },
          ],
        },
      };
    }
    const existingModelInfo = readAttemptModelInfo(existingAttempt?.model_info);
    const inputMode = existingAttempt
      ? (existingModelInfo.input_mode ?? "audio")
      : (input.input_mode ?? (usesAudioInput ? "audio" : "typed"));
    if (existingAttempt && input.input_mode && input.input_mode !== inputMode) {
      return {
        status: 409,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message:
                "Attempt input mode does not match the prepared attempt.",
            },
          ],
        },
      };
    }
    if (
      minigameScope &&
      existingAttempt &&
      !sameMinigameScope(existingModelInfo.practice?.scope, minigameScope)
    ) {
      return {
        status: 409,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message:
                "Attempt is not bound to this minigame round and player.",
            },
          ],
        },
      };
    }
    if (existingAttempt?.completed_at) {
      const storedPayload = buildStoredAttemptPayload(
        existingAttempt,
        requestId,
      );
      if (!storedPayload) {
        return {
          status: 409,
          payload: {
            requestId,
            errors: [
              { stage: "db", message: "Completed attempt data is invalid." },
            ],
          },
        };
      }
      return {
        status: 200,
        payload: storedPayload,
        attemptId: existingAttempt.id,
        overallScore: existingAttempt.overall_score,
        overallPass: existingAttempt.overall_pass,
      };
    }
    if (inputMode === "typed" && (!usesProvidedTranscript || usesAudioInput)) {
      return {
        status: 400,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message: "Typed practice requires text and cannot include audio.",
            },
          ],
        },
      };
    }
    if (
      inputMode === "audio" &&
      usesProvidedTranscript &&
      (!existingAttempt ||
        !existingModelInfo.provider?.stt ||
        !existingAttempt.transcript ||
        existingAttempt.transcript !== transcriptOverride)
    ) {
      return {
        status: 409,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message:
                "The transcript does not match a prepared audio attempt.",
            },
          ],
        },
      };
    }
    if (
      inputMode === "audio" &&
      !usesProvidedTranscript &&
      audioLength < minAudioLength
    ) {
      logEvent("warn", "input.parse.error", {
        reason: "audio_too_small",
        audio_length: audioLength,
      });
      return {
        status: 400,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message: "Audio is missing or too short to evaluate.",
            },
          ],
        },
      };
    }

    let config: EffectiveAiConfig;
    try {
      config = await resolveEffectiveAiConfig({
        env,
        settings: {
          ...settings,
          ai_mode: input.mode ?? settings.ai_mode,
        },
        decryptOpenAiKey,
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "auth.context.error", {
          reason: error.code,
          mode: settings.ai_mode,
        });
        return {
          status: error.status,
          payload: {
            requestId,
            errors: [{ stage: "input", message: error.message }],
          },
        };
      }
      logServerError("practice.config.error", error as Error, {
        requestId,
        userId: user.id,
      });
      return {
        status: 500,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "AI configuration failed." }],
        },
      };
    }
    if (config.mode !== "openai_only") {
      return {
        status: 409,
        payload: {
          requestId,
          errors: [
            {
              stage: "input",
              message:
                "Local practice runs directly between your browser and the desktop runtime. Reconnect it in Settings and try again.",
            },
          ],
        },
      };
    }
    try {
      assertOpenAiKey(config);
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "auth.context.error", {
          reason: error.code,
          mode: settings.ai_mode,
        });
        return {
          status: error.status,
          payload: {
            requestId,
            errors: [
              { stage: "input", message: error.message, code: getOpenAiAccessIssue(error) },
            ],
          },
        };
      }
      throw error;
    }
    logEvent("info", "auth.context.ok", {
      mode: config.mode,
      store_audio: false,
      has_openai_key: Boolean(config.openai.apiKey),
      resolved_from: config.resolvedFrom,
    });

    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, taskId))
      .orderBy(taskCriteria.sort_order);
    if (criteriaRows.length === 0) {
      return {
        status: 404,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Task criteria are missing." }],
        },
      };
    }
    const [exampleRow] = await db
      .select()
      .from(taskExamples)
      .where(
        and(eq(taskExamples.id, exampleId), eq(taskExamples.task_id, taskId)),
      )
      .limit(1);
    if (!exampleRow) {
      return {
        status: 404,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Example not found." }],
        },
      };
    }
    const task = normalizeTask(taskRow);
    const criteria: TaskCriterion[] = criteriaRows.map(normalizeCriterionRow);
    const example = normalizeExampleRow(exampleRow);

    let sttProvider: SttProvider | null = null;
    let transcript: { text: string };
    let sttDuration: number | undefined;
    let sttMeta: { kind: "local" | "openai"; model: string } | null;
    if (usesProvidedTranscript) {
      transcript = { text: transcriptOverride };
      const existingStt = existingModelInfo.provider?.stt;
      sttMeta =
        inputMode === "audio" && existingStt?.kind
          ? {
              kind: existingStt.kind,
              model: existingStt.model ?? "unknown",
            }
          : null;
      logEvent("info", "stt.transcribe.skipped", {
        reason: inputMode === "typed" ? "typed_input" : "provided_transcript",
        transcript_length: transcript.text?.length ?? 0,
      });
    } else {
      logEvent("info", "stt.select.start", { mode: config.mode });
      try {
        const sttSelection = await sttProviderSelector(config, logEvent);
        sttProvider = sttSelection.provider;
        sttMeta = {
          kind: sttProvider.kind,
          model: sttProvider.model ?? "unknown",
        };
        logEvent("info", "stt.select.ok", {
          selected: { kind: sttProvider.kind, model: sttProvider.model },
          health: sttSelection.health,
        });
      } catch (error) {
        logEvent("error", "stt.select.error", { error: safeError(error) });
        return {
          status: 502,
          payload: {
            requestId,
            errors: [
              {
                stage: "stt",
                message: (error as Error).message || "STT unavailable.",
              },
            ],
          },
        };
      }

      const sttStart = Date.now();
      logEvent("info", "stt.transcribe.start", {
        audio_length: audioLength,
        provider: sttMeta,
      });
      try {
        transcript = await sttProvider.transcribe(input.audio ?? "", {
          mimeType: input.audio_mime,
        });
      } catch (error) {
        const duration = Date.now() - sttStart;
        logEvent("error", "stt.transcribe.error", {
          duration_ms: duration,
          error: safeError(error),
        });
        return {
          status: 502,
          payload: {
            requestId,
            errors: [
              {
                stage: "stt",
                message: "Transcription failed. Please try again.",
                code: getOpenAiAccessIssue(error),
              },
            ],
          },
        };
      }
      sttDuration = Date.now() - sttStart;
      timings.stt = sttDuration;
      logEvent("info", "stt.transcribe.ok", {
        duration_ms: sttDuration,
        transcript_length: transcript.text?.length ?? 0,
        transcript_preview: debugEnabled
          ? safeTruncate(transcript.text ?? "", 60)
          : undefined,
      });
    }

    const attemptId = input.attempt_id ?? nanoid();
    const skipScoring = Boolean(input.skip_scoring);
    let llmProvider:
      Awaited<ReturnType<typeof llmProviderSelector>>["provider"] | undefined;
    if (!skipScoring) {
      logEvent("info", "llm.select.start", { mode: config.mode });
      try {
        const llmSelection = await llmProviderSelector(config, logEvent);
        llmProvider = llmSelection.provider;
        logEvent("info", "llm.select.ok", {
          selected: { kind: llmProvider.kind, model: llmProvider.model },
          health: llmSelection.health,
        });
      } catch (error) {
        logEvent("error", "llm.select.error", { error: safeError(error) });
        errors.push({
          stage: "scoring",
          message: (error as Error).message || "LLM unavailable.",
        });
      }
    } else {
      logEvent("info", "llm.evaluate.skipped", { reason: "skip_scoring" });
    }

    let evaluation: unknown;
    let llmDuration: number | undefined;
    if (llmProvider) {
      const llmStart = Date.now();
      logEvent("info", "llm.evaluate.start", {
        attemptId,
        provider: { kind: llmProvider.kind, model: llmProvider.model },
      });
      try {
        evaluation = await llmProvider.evaluateDeliberatePractice({
          task: { ...task, criteria },
          example,
          attempt_id: attemptId,
          transcript,
        });
      } catch (error) {
        logEvent("error", "llm.evaluate.error", { error: safeError(error) });
        errors.push({
          stage: "scoring",
          message:
            "Scoring failed. Check your AI provider settings and try again.",
          code: getOpenAiAccessIssue(error),
        });
      }
      llmDuration = Date.now() - llmStart;
      timings.llm = llmDuration;
      if (!errors.find((entry) => entry.stage === "scoring")) {
        logEvent("info", "llm.evaluate.ok", { duration_ms: llmDuration });
      }
    }

    let scoringResult;
    if (evaluation) {
      const normalizedEvaluation =
        typeof evaluation === "object" && evaluation !== null
          ? {
              ...evaluation,
              task_id: taskId,
              example_id: exampleId,
              attempt_id: attemptId,
            }
          : evaluation;
      let parsed = evaluationResultSchema.safeParse(normalizedEvaluation);
      if (!parsed.success) {
        const repaired = attemptJsonRepair(
          JSON.stringify(normalizedEvaluation),
        );
        if (repaired) {
          parsed = evaluationResultSchema.safeParse(JSON.parse(repaired));
        }
      }
      if (!parsed.success) {
        logEvent("warn", "llm.evaluate.invalid", {
          attemptId,
          issues: parsed.error.issues.map((issue) => issue.message),
        });
        errors.push({
          stage: "scoring",
          message:
            "We could not score this response due to invalid evaluation output.",
        });
      } else {
        try {
          const authoritativeEvaluation = validateAndDeriveLocalEvaluation(
            parsed.data,
            {
              taskId,
              exampleId,
              attemptId,
              transcript: transcript.text,
              criterionIds: criteria.map((criterion) => criterion.id),
            },
          );
          scoringResult =
            inputMode === "typed" && authoritativeEvaluation.diagnostics
              ? { ...authoritativeEvaluation, diagnostics: undefined }
              : authoritativeEvaluation;
        } catch (error) {
          logEvent("warn", "llm.evaluate.invalid", {
            attemptId,
            reason:
              error instanceof LocalEvaluationValidationError
                ? error.message
                : "Evaluation validation failed.",
          });
          errors.push({
            stage: "scoring",
            message:
              "We could not score this response due to invalid evaluation output.",
          });
        }
      }
    }

    let nextDifficulty: number | undefined;
    let overallScore = scoringResult?.overall.score ?? 0;
    let overallPass = scoringResult?.overall.pass ?? false;
    const scoreTrust =
      scoringResult && llmProvider
        ? llmProvider.kind === "openai"
          ? "cloud_trusted"
          : "local_unverified"
        : (existingAttempt?.score_trust ?? "cloud_trusted");
    if (transcript) {
      logEvent("info", "db.attempt.insert.start", { attemptId });
      try {
        const sttTiming =
          inputMode === "typed"
            ? undefined
            : usesProvidedTranscript
              ? existingModelInfo.timing_ms?.stt
              : sttDuration;
        const llmTiming = llmDuration ?? existingModelInfo.timing_ms?.llm;
        const modelInfo = {
          provider: {
            stt: sttMeta,
            llm: llmProvider
              ? {
                  kind: llmProvider.kind,
                  model: llmProvider.model ?? "unknown",
                }
              : (existingModelInfo.provider?.llm ?? null),
          },
          timing_ms: {
            stt: sttTiming,
            llm: llmTiming,
            total: (sttTiming ?? 0) + (llmTiming ?? 0),
          },
          input_mode: inputMode,
          score_trust: scoreTrust,
          practice:
            input.practice_mode || minigameScope || existingModelInfo.practice
              ? {
                  mode: input.practice_mode ?? existingModelInfo.practice?.mode,
                  turn_context:
                    input.turn_context ??
                    existingModelInfo.practice?.turn_context ??
                    null,
                  scope: minigameScope ?? existingModelInfo.practice?.scope,
                }
              : undefined,
        };
        const transcriptText = transcript.text ?? "";

        const attemptValues = {
          id: attemptId,
          user_id: user.id,
          session_id: sessionId,
          session_item_id: sessionItemId,
          task_id: taskId,
          example_id: exampleId,
          started_at: Date.now(),
          completed_at: null,
          audio_ref: null,
          transcript: transcriptText,
          evaluation: existingAttempt?.evaluation ?? {},
          overall_pass: existingAttempt?.overall_pass ?? false,
          overall_score: existingAttempt?.overall_score ?? 0,
          score_trust: scoreTrust,
          model_info: modelInfo,
        };
        if (existingAttempt) {
          await db
            .update(attempts)
            .set({
              audio_ref: null,
              transcript: transcriptText,
              model_info: modelInfo,
              score_trust: scoreTrust,
            })
            .where(
              and(
                eq(attempts.id, attemptId),
                eq(attempts.user_id, user.id),
                isNull(attempts.completed_at),
              ),
            );
        } else {
          await db.insert(attempts).values(attemptValues).onConflictDoNothing();
          const [insertedAttempt] = await db
            .select({
              user_id: attempts.user_id,
              task_id: attempts.task_id,
              example_id: attempts.example_id,
              session_item_id: attempts.session_item_id,
              transcript: attempts.transcript,
            })
            .from(attempts)
            .where(eq(attempts.id, attemptId))
            .limit(1);
          if (
            !insertedAttempt ||
            insertedAttempt.user_id !== user.id ||
            insertedAttempt.task_id !== taskId ||
            insertedAttempt.example_id !== exampleId ||
            insertedAttempt.session_item_id !== sessionItemId
          ) {
            throw new Error("Attempt identifier collision.");
          }
        }

        const shouldPersistScoring = Boolean(scoringResult);
        let completedNow = false;
        if (shouldPersistScoring) {
          const completionUpdate = await db
            .update(attempts)
            .set({
              completed_at: Date.now(),
              audio_ref: null,
              transcript: transcriptText,
              evaluation: scoringResult,
              overall_pass: overallPass,
              overall_score: overallScore,
              model_info: modelInfo,
              score_trust: scoreTrust,
            })
            .where(
              and(
                eq(attempts.id, attemptId),
                eq(attempts.user_id, user.id),
                isNull(attempts.completed_at),
              ),
            );
          const completionChanges =
            completionUpdate && typeof completionUpdate === "object"
              ? typeof (completionUpdate as { changes?: number }).changes ===
                "number"
                ? (completionUpdate as unknown as { changes: number }).changes
                : typeof (completionUpdate as { meta?: { changes?: number } })
                      .meta?.changes === "number"
                  ? (completionUpdate as { meta: { changes: number } }).meta
                      .changes
                  : 0
              : 0;
          completedNow = completionChanges > 0;
          if (!completedNow) {
            const [committedAttempt] = await db
              .select()
              .from(attempts)
              .where(
                and(eq(attempts.id, attemptId), eq(attempts.user_id, user.id)),
              )
              .limit(1);
            const storedPayload = committedAttempt
              ? buildStoredAttemptPayload(committedAttempt, requestId)
              : null;
            if (!committedAttempt?.completed_at || !storedPayload) {
              throw new Error("Attempt completion did not persist.");
            }
            return {
              status: 200,
              payload: storedPayload,
              attemptId: committedAttempt.id,
              overallScore: committedAttempt.overall_score,
              overallPass: committedAttempt.overall_pass,
            };
          }
        }

        if (completedNow) {
          const [progress] = await db
            .select({ current_difficulty: userTaskProgress.current_difficulty })
            .from(userTaskProgress)
            .where(
              and(
                eq(userTaskProgress.user_id, user.id),
                eq(userTaskProgress.task_id, taskId),
              ),
            )
            .limit(1);
          nextDifficulty = progress?.current_difficulty;
        }

        logEvent("info", "db.attempt.insert.ok", { attemptId });
      } catch (error) {
        logEvent("error", "db.attempt.insert.error", {
          error: safeError(error),
        });
        errors.push({
          stage: "db",
          message: "We couldn't save this attempt. Please try again.",
        });
      }
    }

    const responseSttDuration =
      inputMode === "typed"
        ? null
        : (sttDuration ?? existingModelInfo?.timing_ms?.stt ?? null);
    const response = {
      requestId,
      attemptId,
      score_trust: scoreTrust,
      next_recommended_difficulty: nextDifficulty,
      transcript: transcript
        ? {
            text: transcript.text,
            input_mode: inputMode,
            provider: sttMeta,
            duration_ms: responseSttDuration,
          }
        : undefined,
      scoring: scoringResult
        ? {
            evaluation: scoringResult,
            provider: llmProvider
              ? {
                  kind: llmProvider.kind,
                  model: llmProvider.model ?? "unknown",
                }
              : { kind: "openai", model: "unknown" },
            duration_ms: llmDuration ?? 0,
          }
        : undefined,
      errors: errors.length ? errors : undefined,
      debug: debugEnabled
        ? {
            timings,
            selectedProviders: {
              stt: sttMeta,
              llm: llmProvider
                ? {
                    kind: llmProvider.kind,
                    model: llmProvider.model ?? "unknown",
                  }
                : null,
            },
          }
        : undefined,
    };

    if (errors.length) {
      logEvent("warn", "practice.run.error", {
        attemptId,
        error_count: errors.length,
      });
    } else {
      logEvent("info", "practice.run.ok", {
        attemptId,
        total_duration_ms: (responseSttDuration ?? 0) + (llmDuration ?? 0),
      });
    }

    return {
      status: 200,
      payload: response,
      attemptId,
      overallScore,
      overallPass,
    };
  };

  const calculateTimingPenalty = (timing?: {
    response_delay_ms?: number | null;
    response_duration_ms?: number | null;
    response_timer_seconds?: number;
    max_response_duration_seconds?: number;
  }) => {
    if (!timing) return 0;
    let delaySeverity = 0;
    let durationSeverity = 0;
    if (timing.response_timer_seconds && timing.response_delay_ms != null) {
      const minDelayMs = timing.response_timer_seconds * 1000;
      if (timing.response_delay_ms < minDelayMs) {
        delaySeverity = Math.min(
          1,
          Math.max(0, 1 - timing.response_delay_ms / minDelayMs),
        );
      }
    }
    if (
      timing.max_response_duration_seconds &&
      timing.response_duration_ms != null
    ) {
      const maxDurationMs = timing.max_response_duration_seconds * 1000;
      if (timing.response_duration_ms > maxDurationMs) {
        durationSeverity = Math.min(
          1,
          Math.max(
            0,
            (timing.response_duration_ms - maxDurationMs) / maxDurationMs,
          ),
        );
      }
    }
    const severity = Math.max(delaySeverity, durationSeverity);
    return severity > 0 ? 0.5 + 0.5 * severity : 0;
  };

  app.post("/api/v1/minigames/sessions", async (c) => {
    const user = c.get("user");
    const schema = z.object({
      game_type: z.enum(["ffa", "tdm"]),
      visibility_mode: z.enum(["normal", "hard", "extreme"]),
      task_selection: z.object({
        strategy: z.enum(["manual", "random", "filtered_random"]),
        task_ids: z
          .array(z.string().min(1).max(MINIGAME_LIMITS.selectionValueLength))
          .max(100)
          .optional(),
        tags: z
          .array(z.string().min(1).max(MINIGAME_LIMITS.selectionValueLength))
          .max(50)
          .optional(),
        skill_domains: z
          .array(z.string().min(1).max(MINIGAME_LIMITS.selectionValueLength))
          .max(50)
          .optional(),
        shuffle: z.boolean().optional(),
        seed: z.string().max(200).optional(),
      }),
      settings: z
        .object({
          rounds_per_player: z
            .number()
            .int()
            .min(1)
            .max(MINIGAME_LIMITS.roundsPerPlayer)
            .optional(),
          response_timer_enabled: z.boolean().optional(),
          response_timer_seconds: z.number().positive().max(3_600).optional(),
          max_response_duration_enabled: z.boolean().optional(),
          max_response_duration_seconds: z
            .number()
            .positive()
            .max(3_600)
            .optional(),
        })
        .strict(),
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, MINIGAME_LIMITS.mutationBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "The session payload is too large." }, 413);
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json({ error: "Invalid session payload." }, 400);
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid session payload." }, 400);
    }
    if (parsed.data.task_selection.strategy === "manual") {
      const requestedTaskIds = [
        ...new Set(parsed.data.task_selection.task_ids ?? []),
      ];
      if (!requestedTaskIds.length) {
        return c.json({ error: "Select at least one published task." }, 400);
      }
      const publishedRows = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(inArray(tasks.id, requestedTaskIds), publishedTasksCondition()),
        );
      if (publishedRows.length !== requestedTaskIds.length) {
        return c.json({ error: "A selected task is not available." }, 404);
      }
    }
    const sessionId = generateUuid();
    const now = Date.now();
    try {
      await db.insert(minigameSessions).values({
        id: sessionId,
        user_id: user.id,
        game_type: parsed.data.game_type,
        visibility_mode: parsed.data.visibility_mode,
        task_selection: parsed.data.task_selection,
        settings: parsed.data.settings,
        created_at: now,
        ended_at: null,
        last_active_at: now,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("MINIGAME_TASK_SELECTION_INVALID")
      ) {
        return c.json({ error: "A selected task is not available." }, 404);
      }
      throw error;
    }
    return c.json({ session_id: sessionId });
  });

  app.get("/api/v1/minigames/sessions", async (c) => {
    const user = c.get("user");
    const status = c.req.query("status") as
      "active" | "ended" | "all" | undefined;
    const sort = c.req.query("sort") as
      "newest" | "oldest" | "recently_active" | undefined;
    const sessions = await listMinigameSessions(db, {
      userId: user.id,
      status,
      sort,
    });
    return c.json({ sessions });
  });

  const fetchMinigameSessionState = async (
    sessionId: string,
    userId: string,
  ) => {
    const [session] = await db
      .select()
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, userId),
          isNull(minigameSessions.deleted_at),
        ),
      )
      .limit(1);
    if (!session) {
      return null;
    }
    const teams = await db
      .select()
      .from(minigameTeams)
      .where(eq(minigameTeams.session_id, sessionId));
    const players = await db
      .select()
      .from(minigamePlayers)
      .where(eq(minigamePlayers.session_id, sessionId));
    const rounds = await db
      .select({
        id: minigameRounds.id,
        session_id: minigameRounds.session_id,
        position: minigameRounds.position,
        task_id: minigameRounds.task_id,
        example_id: minigameRounds.example_id,
        player_a_id: minigameRounds.player_a_id,
        player_b_id: minigameRounds.player_b_id,
        team_a_id: minigameRounds.team_a_id,
        team_b_id: minigameRounds.team_b_id,
        status: minigameRounds.status,
        started_at: minigameRounds.started_at,
        completed_at: minigameRounds.completed_at,
        patient_text: taskExamples.patient_text,
      })
      .from(minigameRounds)
      .innerJoin(
        tasks,
        and(eq(minigameRounds.task_id, tasks.id), publishedTasksCondition()),
      )
      .leftJoin(taskExamples, eq(minigameRounds.example_id, taskExamples.id))
      .where(eq(minigameRounds.session_id, sessionId))
      .orderBy(minigameRounds.position);
    const results = await db
      .select({
        id: minigameRoundResults.id,
        round_id: minigameRoundResults.round_id,
        player_id: minigameRoundResults.player_id,
        attempt_id: minigameRoundResults.attempt_id,
        overall_score: minigameRoundResults.overall_score,
        overall_pass: minigameRoundResults.overall_pass,
        created_at: minigameRoundResults.created_at,
        transcript: attempts.transcript,
        evaluation: attempts.evaluation,
        score_trust: attempts.score_trust,
      })
      .from(minigameRoundResults)
      .leftJoin(attempts, eq(minigameRoundResults.attempt_id, attempts.id))
      .leftJoin(
        minigameRounds,
        eq(minigameRoundResults.round_id, minigameRounds.id),
      )
      .innerJoin(
        tasks,
        and(eq(minigameRounds.task_id, tasks.id), publishedTasksCondition()),
      )
      .where(eq(minigameRounds.session_id, sessionId));

    return {
      session: {
        ...session,
        current_round_id:
          !session.current_round_id ||
          rounds.some((round) => round.id === session.current_round_id)
            ? session.current_round_id
            : null,
        current_player_id:
          !session.current_round_id ||
          rounds.some((round) => round.id === session.current_round_id)
            ? session.current_player_id
            : null,
      },
      teams,
      players,
      rounds,
      results,
    };
  };

  app.get("/api/v1/minigames/sessions/:id", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const state = await fetchMinigameSessionState(sessionId, user.id);
    if (!state) {
      return c.json({ error: "Session not found." }, 404);
    }
    return c.json(state);
  });

  app.patch("/api/v1/minigames/sessions/:id/resume", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const schema = z.object({
      current_round_id: z.string().nullable().optional(),
      current_player_id: z.string().nullable().optional(),
      last_active_at: z.number().nullable().optional(),
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid resume payload." }, 400);
    }
    const hasRoundPointer = parsed.data.current_round_id !== undefined;
    const hasPlayerPointer = parsed.data.current_player_id !== undefined;
    if (
      hasRoundPointer !== hasPlayerPointer ||
      (hasRoundPointer &&
        (parsed.data.current_round_id === null) !==
          (parsed.data.current_player_id === null))
    ) {
      return c.json(
        { error: "Resume round and player must be provided as one pair." },
        400,
      );
    }
    if (parsed.data.current_round_id && parsed.data.current_player_id) {
      const [assignedPair] = await db
        .select({ id: minigameRounds.id })
        .from(minigameRounds)
        .innerJoin(
          tasks,
          and(eq(minigameRounds.task_id, tasks.id), publishedTasksCondition()),
        )
        .innerJoin(
          minigamePlayers,
          and(
            eq(minigamePlayers.id, parsed.data.current_player_id),
            eq(minigamePlayers.session_id, sessionId),
          ),
        )
        .where(
          and(
            eq(minigameRounds.id, parsed.data.current_round_id),
            eq(minigameRounds.session_id, sessionId),
            or(
              eq(minigameRounds.player_a_id, parsed.data.current_player_id),
              eq(minigameRounds.player_b_id, parsed.data.current_player_id),
            ),
          ),
        )
        .limit(1);
      if (!assignedPair) {
        return c.json(
          { error: "Resume player is not assigned to this round." },
          409,
        );
      }
    }
    const updated = await updateMinigameResume(db, {
      userId: user.id,
      sessionId,
      currentRoundId: parsed.data.current_round_id,
      currentPlayerId: parsed.data.current_player_id,
      lastActiveAt: parsed.data.last_active_at,
    });
    if (!updated) {
      return c.json({ error: "Session not found." }, 404);
    }
    return c.json({ ok: true });
  });

  app.delete("/api/v1/minigames/sessions/:id", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const deleted = await softDeleteMinigameSession(db, {
      userId: user.id,
      sessionId,
    });
    if (!deleted) {
      return c.json({ error: "Session not found." }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/v1/minigames/sessions/:id/end", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select({ id: minigameSessions.id })
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at),
          isNull(minigameSessions.ended_at),
        ),
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Active session not found." }, 404);
    }
    const now = Date.now();
    await db
      .update(minigameSessions)
      .set({ ended_at: now, last_active_at: now })
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at),
          isNull(minigameSessions.ended_at),
        ),
      );
    return c.json({ ok: true });
  });

  app.post("/api/v1/minigames/sessions/:id/teams", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select({ id: minigameSessions.id })
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at),
          isNull(minigameSessions.ended_at),
        ),
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    const schema = z.object({
      teams: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(MINIGAME_LIMITS.teamNameLength),
            color: z
              .string()
              .trim()
              .min(1)
              .max(MINIGAME_LIMITS.teamColorLength),
          }),
        )
        .min(1)
        .max(MINIGAME_LIMITS.teams),
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, MINIGAME_LIMITS.mutationBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "The team payload is too large." }, 413);
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json({ error: "Invalid teams payload." }, 400);
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid teams payload." }, 400);
    }
    const [existingTeams] = await db
      .select({ count: count(minigameTeams.id) })
      .from(minigameTeams)
      .where(eq(minigameTeams.session_id, sessionId));
    if (
      (existingTeams?.count ?? 0) + parsed.data.teams.length >
      MINIGAME_LIMITS.teams
    ) {
      return c.json({ error: "This game has reached the team limit." }, 409);
    }
    const rows = parsed.data.teams.map((team) => ({
      id: generateUuid(),
      session_id: sessionId,
      name: team.name,
      color: team.color,
      created_at: Date.now(),
    }));
    try {
      await db.insert(minigameTeams).values(rows);
    } catch (error) {
      if (getMinigameLimitCode(error) === MINIGAME_LIMIT_CODES.teams) {
        return c.json({ error: "This game has reached the team limit." }, 409);
      }
      throw error;
    }
    return c.json({ teams: rows });
  });

  app.post("/api/v1/minigames/sessions/:id/players", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select({ id: minigameSessions.id })
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at),
          isNull(minigameSessions.ended_at),
        ),
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    const schema = z.object({
      players: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(MINIGAME_LIMITS.playerNameLength),
            avatar: z
              .string()
              .trim()
              .min(1)
              .max(MINIGAME_LIMITS.playerAvatarLength),
            team_id: z
              .string()
              .max(MINIGAME_LIMITS.selectionValueLength)
              .nullable()
              .optional(),
          }),
        )
        .min(1)
        .max(MINIGAME_LIMITS.players),
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, MINIGAME_LIMITS.mutationBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "The player payload is too large." }, 413);
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json({ error: "Invalid players payload." }, 400);
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid players payload." }, 400);
    }
    const teamIds = parsed.data.players
      .map((player) => player.team_id)
      .filter((teamId): teamId is string => Boolean(teamId));
    if (teamIds.length) {
      const ownedTeams = await db
        .select({ id: minigameTeams.id })
        .from(minigameTeams)
        .where(
          and(
            eq(minigameTeams.session_id, sessionId),
            inArray(minigameTeams.id, [...new Set(teamIds)]),
          ),
        );
      if (ownedTeams.length !== new Set(teamIds).size) {
        return c.json(
          { error: "A player team does not belong to this game." },
          409,
        );
      }
    }
    const [existingPlayers] = await db
      .select({ count: count(minigamePlayers.id) })
      .from(minigamePlayers)
      .where(eq(minigamePlayers.session_id, sessionId));
    if (
      (existingPlayers?.count ?? 0) + parsed.data.players.length >
      MINIGAME_LIMITS.players
    ) {
      return c.json({ error: "This game has reached the player limit." }, 409);
    }
    const rows = parsed.data.players.map((player) => ({
      id: generateUuid(),
      session_id: sessionId,
      name: player.name,
      avatar: player.avatar,
      team_id: player.team_id ?? null,
      created_at: Date.now(),
    }));
    try {
      await db.insert(minigamePlayers).values(rows);
    } catch (error) {
      if (getMinigameLimitCode(error) === MINIGAME_LIMIT_CODES.players) {
        return c.json(
          { error: "This game has reached the player limit." },
          409,
        );
      }
      throw error;
    }
    return c.json({ players: rows });
  });

  app.post("/api/v1/minigames/sessions/:id/rounds/generate", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    let body: unknown;
    try {
      body = await readBoundedJson(c, MINIGAME_LIMITS.mutationBodyBytes);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json({ error: "The generate payload is too large." }, 413);
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json({ error: "Invalid generate payload." }, 400);
      }
      throw error;
    }
    const schema = z.object({
      count: z
        .number()
        .int()
        .min(1)
        .max(MINIGAME_LIMITS.ffaRoundBatch)
        .optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid generate payload." }, 400);
    }

    const [session] = await db
      .select()
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at),
          isNull(minigameSessions.ended_at),
        ),
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    const [existingRounds] = await db
      .select({ count: count(minigameRounds.id) })
      .from(minigameRounds)
      .where(eq(minigameRounds.session_id, sessionId));
    const playerCount = await db
      .select({ count: count(minigamePlayers.id) })
      .from(minigamePlayers)
      .where(eq(minigamePlayers.session_id, sessionId))
      .then((rows) => rows[0]?.count ?? 0);
    const projectedRounds =
      session.game_type === "tdm"
        ? Math.ceil(
            (playerCount *
              Number(
                (session.settings as { rounds_per_player?: number })
                  .rounds_per_player ?? 1,
              )) /
              2,
          )
        : (parsed.data.count ?? 1);
    if (
      (existingRounds?.count ?? 0) + projectedRounds >
      MINIGAME_LIMITS.totalRounds
    ) {
      return c.json({ error: "This game has reached the round limit." }, 409);
    }

    const logEvent = (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields = {},
    ) => log(level, event, { sessionId, ...fields });
    try {
      const result = await generateMinigameRounds({
        db,
        session,
        count: parsed.data.count,
        logEvent,
      });
      return c.json({ round_count: result.roundCount });
    } catch (error) {
      if (error instanceof NoAvailableMinigameTasksError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof InvalidTdmConfigurationError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof NoUniquePatientStatementsLeftError) {
        return c.json(
          {
            error: error.message,
            code: NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
            metadata: error.metadata,
          },
          409,
        );
      }
      if (getMinigameLimitCode(error)) {
        return c.json({ error: "This game cannot generate more rounds." }, 409);
      }
      throw error;
    }
  });

  app.post("/api/v1/minigames/sessions/:id/redraw", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select()
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at),
          isNull(minigameSessions.ended_at),
        ),
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    if (session.game_type !== "tdm") {
      return c.json({ error: "Redraw is only available in TDM." }, 400);
    }

    const [pendingRound] = await db
      .select()
      .from(minigameRounds)
      .where(
        and(
          eq(minigameRounds.session_id, sessionId),
          eq(minigameRounds.status, "pending"),
        ),
      )
      .orderBy(minigameRounds.position)
      .limit(1);
    if (!pendingRound) {
      return c.json({ error: "No active round is available to redraw." }, 409);
    }

    const logEvent = (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields = {},
    ) => log(level, event, { sessionId, ...fields });
    try {
      const result = await redrawMinigameRound({
        db,
        session,
        replacedRoundId: pendingRound.id,
        logEvent,
      });
      return c.json({ round_count: result.roundCount });
    } catch (error) {
      if (error instanceof NoAvailableMinigameTasksError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof InvalidTdmConfigurationError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof NoUniquePatientStatementsLeftError) {
        return c.json(
          {
            error: error.message,
            code: NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
            metadata: error.metadata,
          },
          409,
        );
      }
      if (
        error instanceof MinigameRedrawConflictError ||
        getMinigameLimitCode(error)
      ) {
        return c.json({ error: "This round can no longer be redrawn." }, 409);
      }
      throw error;
    }
  });

  app.get("/api/v1/minigames/sessions/:id/state", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const state = await fetchMinigameSessionState(sessionId, user.id);
    if (!state) {
      return c.json({ error: "Session not found." }, 404);
    }
    return c.json(state);
  });

  app.post(
    "/api/v1/minigames/sessions/:id/rounds/:roundId/start",
    async (c) => {
      const user = c.get("user");
      const sessionId = c.req.param("id");
      const roundId = c.req.param("roundId");
      const [session] = await db
        .select({ id: minigameSessions.id })
        .from(minigameSessions)
        .where(
          and(
            eq(minigameSessions.id, sessionId),
            eq(minigameSessions.user_id, user.id),
            isNull(minigameSessions.deleted_at),
            isNull(minigameSessions.ended_at),
          ),
        )
        .limit(1);
      if (!session) {
        return c.json({ error: "Session not found." }, 404);
      }
      const [round] = await db
        .select({ status: minigameRounds.status })
        .from(minigameRounds)
        .innerJoin(
          tasks,
          and(eq(minigameRounds.task_id, tasks.id), publishedTasksCondition()),
        )
        .where(
          and(
            eq(minigameRounds.id, roundId),
            eq(minigameRounds.session_id, sessionId),
          ),
        )
        .limit(1);
      if (!round) {
        return c.json({ error: "Round not found." }, 404);
      }
      if (round.status === "active") {
        return c.json({ ok: true });
      }
      if (round.status !== "pending") {
        return c.json({ error: "Only a pending round can be started." }, 409);
      }
      const startedAt = Date.now();
      try {
        await runAtomicMutation(db, (executor) => [
          executor
            .insert(minigameRoundStartClaims)
            .values({
              round_id: roundId,
              session_id: sessionId,
              created_at: startedAt,
            })
            .onConflictDoUpdate({
              target: minigameRoundStartClaims.round_id,
              set: { session_id: sessionId, created_at: startedAt },
            }),
          executor
            .update(minigameRounds)
            .set({ status: "pending", started_at: null })
            .where(
              and(
                eq(minigameRounds.session_id, sessionId),
                eq(minigameRounds.status, "active"),
              ),
            ),
          executor
            .update(minigameRounds)
            .set({ status: "active", started_at: startedAt })
            .where(
              and(
                eq(minigameRounds.id, roundId),
                eq(minigameRounds.session_id, sessionId),
                eq(minigameRounds.status, "pending"),
              ),
            ),
        ]);
      } catch (error) {
        if (getMinigameLimitCode(error) === MINIGAME_LIMIT_CODES.startRound) {
          return c.json({ error: "This round can no longer be started." }, 409);
        }
        throw error;
      }
      return c.json({ ok: true });
    },
  );

  app.post(
    "/api/v1/minigames/sessions/:id/rounds/:roundId/submit",
    async (c) => {
      const user = c.get("user");
      const requestId = c.get("requestId");
      const sessionId = c.req.param("id");
      const roundId = c.req.param("roundId");
      const logEvent = (
        level: "debug" | "info" | "warn" | "error",
        event: string,
        fields = {},
      ) =>
        log(level, event, { requestId, userId: user?.id ?? null, ...fields });
      const schema = z
        .object({
          player_id: z.string(),
          audio_base64: z.string().optional(),
          audio_mime: z.string().optional(),
          transcript_text: z.string().optional(),
          attempt_id: z.string().optional(),
          skip_scoring: z.boolean().optional(),
          mode: z
            .enum(["local_prefer", "openai_only", "local_only"])
            .optional(),
          practice_mode: z.enum(["standard", "real_time"]).optional(),
          turn_context: z
            .object({
              patient_cache_key: z.string().optional(),
              patient_statement_id: z.string().optional(),
              timing: z
                .object({
                  response_delay_ms: z.number().nullable().optional(),
                  response_duration_ms: z.number().nullable().optional(),
                  response_timer_seconds: z.number().optional(),
                  max_response_duration_seconds: z.number().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .superRefine((data, ctx) => {
          if (!data.audio_base64 && !data.transcript_text) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Provide audio_base64 or transcript_text.",
            });
          }
        });
      let body: unknown;
      try {
        body = await readBoundedJson(c, REQUEST_BODY_LIMITS.audioPractice);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          return c.json({ error: "The submit payload is too large." }, 413);
        }
        if (error instanceof RequestBodyInvalidJsonError) {
          return c.json({ error: "Invalid submit payload." }, 400);
        }
        throw error;
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: "Invalid submit payload." }, 400);
      }
      const [session] = await db
        .select({ id: minigameSessions.id })
        .from(minigameSessions)
        .where(
          and(
            eq(minigameSessions.id, sessionId),
            eq(minigameSessions.user_id, user.id),
            isNull(minigameSessions.deleted_at),
            isNull(minigameSessions.ended_at),
          ),
        )
        .limit(1);
      if (!session) {
        return c.json({ error: "Session not found." }, 404);
      }
      const [round] = await db
        .select({
          id: minigameRounds.id,
          task_id: minigameRounds.task_id,
          example_id: minigameRounds.example_id,
          player_a_id: minigameRounds.player_a_id,
          player_b_id: minigameRounds.player_b_id,
          status: minigameRounds.status,
        })
        .from(minigameRounds)
        .innerJoin(
          tasks,
          and(eq(minigameRounds.task_id, tasks.id), publishedTasksCondition()),
        )
        .where(
          and(
            eq(minigameRounds.id, roundId),
            eq(minigameRounds.session_id, sessionId),
          ),
        )
        .limit(1);
      if (!round) {
        return c.json({ error: "Round not found." }, 404);
      }
      if (round.status !== "active" && round.status !== "completed") {
        return c.json(
          { error: "The round must be active before submission." },
          409,
        );
      }
      if (round.status === "completed") {
        const [storedResult] = await db
          .select({ attempt_id: minigameRoundResults.attempt_id })
          .from(minigameRoundResults)
          .where(
            and(
              eq(minigameRoundResults.round_id, roundId),
              eq(minigameRoundResults.player_id, parsed.data.player_id),
            ),
          )
          .limit(1);
        if (
          !storedResult ||
          (parsed.data.attempt_id &&
            storedResult.attempt_id !== parsed.data.attempt_id)
        ) {
          return c.json({ error: "This round is already complete." }, 409);
        }
      }
      const [player] = await db
        .select({ id: minigamePlayers.id })
        .from(minigamePlayers)
        .where(
          and(
            eq(minigamePlayers.id, parsed.data.player_id),
            eq(minigamePlayers.session_id, sessionId),
          ),
        )
        .limit(1);
      if (
        !player ||
        (round.player_a_id !== player.id && round.player_b_id !== player.id)
      ) {
        return c.json({ error: "Player is not assigned to this round." }, 409);
      }

      const minigameScope: MinigameAttemptScope = {
        kind: "minigame",
        session_id: sessionId,
        round_id: roundId,
        player_id: parsed.data.player_id,
      };
      let claimedAttemptId: string;
      try {
        claimedAttemptId = await acquireMinigameSubmissionClaim({
          roundId,
          playerId: parsed.data.player_id,
          requestedAttemptId: parsed.data.attempt_id,
          userId: user.id,
          taskId: round.task_id,
          exampleId: round.example_id,
          scope: minigameScope,
        });
      } catch (error) {
        if (error instanceof MinigameSubmissionClaimError) {
          return c.json({ error: error.message }, 409);
        }
        throw error;
      }

      const runResult = await runPracticeAttempt({
        body: {
          task_id: round.task_id,
          example_id: round.example_id,
          audio: parsed.data.audio_base64,
          audio_mime: parsed.data.audio_mime,
          transcript_text: parsed.data.transcript_text,
          attempt_id: claimedAttemptId,
          skip_scoring: parsed.data.skip_scoring,
          mode: parsed.data.mode,
          practice_mode: parsed.data.practice_mode,
          turn_context: parsed.data.turn_context,
        },
        debugEnabled: env.environment === "development",
        logEvent,
        requestId,
        user,
        minigameScope,
        claimedMinigameAttemptId: claimedAttemptId,
      });

      if (runResult.status !== 200 || !runResult.attemptId) {
        return c.json(runResult.payload, toContentfulStatus(runResult.status));
      }

      if (parsed.data.skip_scoring) {
        return c.json(runResult.payload, toContentfulStatus(runResult.status));
      }

      const [existingRoundResult] = await db
        .select({
          attempt_id: minigameRoundResults.attempt_id,
          overall_score: minigameRoundResults.overall_score,
          round_id: minigameRoundResults.round_id,
          player_id: minigameRoundResults.player_id,
        })
        .from(minigameRoundResults)
        .where(
          or(
            and(
              eq(minigameRoundResults.round_id, roundId),
              eq(minigameRoundResults.player_id, parsed.data.player_id),
            ),
            eq(minigameRoundResults.attempt_id, runResult.attemptId),
          ),
        )
        .limit(1);
      if (existingRoundResult) {
        if (
          existingRoundResult.attempt_id !== runResult.attemptId ||
          existingRoundResult.round_id !== roundId ||
          existingRoundResult.player_id !== parsed.data.player_id
        ) {
          return c.json(
            { error: "This player or attempt was already submitted." },
            409,
          );
        }
        await finalizeMinigameRoundIfReady({
          roundId,
          playerBId: round.player_b_id,
        });
        return c.json({
          ...runResult.payload,
          adjusted_score: existingRoundResult.overall_score,
        });
      }

      const timingPenalty = calculateTimingPenalty(
        parsed.data.turn_context?.timing,
      );
      const requestedAdjustedScore = Math.max(
        0,
        (runResult.overallScore ?? 0) - timingPenalty,
      );

      try {
        await db
          .insert(minigameRoundResults)
          .values({
            id: generateUuid(),
            round_id: roundId,
            player_id: parsed.data.player_id,
            attempt_id: runResult.attemptId,
            overall_score: requestedAdjustedScore,
            overall_pass: runResult.overallPass ?? false,
            created_at: Date.now(),
          })
          .onConflictDoNothing();
      } catch (error) {
        if (isMinigameClaimDatabaseError(error)) {
          return c.json(
            { error: "This minigame submission can no longer be accepted." },
            409,
          );
        }
        throw error;
      }
      const [storedRoundResult] = await db
        .select()
        .from(minigameRoundResults)
        .where(
          or(
            and(
              eq(minigameRoundResults.round_id, roundId),
              eq(minigameRoundResults.player_id, parsed.data.player_id),
            ),
            eq(minigameRoundResults.attempt_id, runResult.attemptId),
          ),
        )
        .limit(1);
      if (
        !storedRoundResult ||
        storedRoundResult.attempt_id !== runResult.attemptId ||
        storedRoundResult.round_id !== roundId ||
        storedRoundResult.player_id !== parsed.data.player_id
      ) {
        return c.json(
          { error: "This player or attempt was already submitted." },
          409,
        );
      }
      const adjustedScore = storedRoundResult.overall_score;
      await finalizeMinigameRoundIfReady({
        roundId,
        playerBId: round.player_b_id,
      });

      return c.json({
        ...runResult.payload,
        timing_penalty: timingPenalty,
        adjusted_score: adjustedScore,
      });
    },
  );

  app.post(
    "/api/v1/minigames/sessions/:id/rounds/:roundId/commit-local",
    async (c) => {
      const user = c.get("user");
      const requestId = c.get("requestId");
      const sessionId = c.req.param("id");
      const roundId = c.req.param("roundId");
      const parsed = z
        .object({
          player_id: z.string().min(1),
          attempt_id: z.string().min(1),
          turn_context: z
            .object({
              patient_cache_key: z.string().optional(),
              patient_statement_id: z.string().optional(),
              timing: z
                .object({
                  response_delay_ms: z.number().nullable().optional(),
                  response_duration_ms: z.number().nullable().optional(),
                  response_timer_seconds: z.number().optional(),
                  max_response_duration_seconds: z.number().optional(),
                })
                .optional(),
            })
            .optional(),
        })
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        return c.json(
          { error: "Invalid local round payload.", requestId },
          400,
        );
      }

      const [context] = await db
        .select({
          task_id: minigameRounds.task_id,
          example_id: minigameRounds.example_id,
          player_a_id: minigameRounds.player_a_id,
          player_b_id: minigameRounds.player_b_id,
          player_id: minigamePlayers.id,
          round_status: minigameRounds.status,
        })
        .from(minigameSessions)
        .innerJoin(
          minigameRounds,
          and(
            eq(minigameRounds.id, roundId),
            eq(minigameRounds.session_id, minigameSessions.id),
          ),
        )
        .innerJoin(
          tasks,
          and(eq(minigameRounds.task_id, tasks.id), publishedTasksCondition()),
        )
        .innerJoin(
          minigamePlayers,
          and(
            eq(minigamePlayers.id, parsed.data.player_id),
            eq(minigamePlayers.session_id, minigameSessions.id),
          ),
        )
        .where(
          and(
            eq(minigameSessions.id, sessionId),
            eq(minigameSessions.user_id, user.id),
            isNull(minigameSessions.deleted_at),
            isNull(minigameSessions.ended_at),
          ),
        )
        .limit(1);
      if (
        !context ||
        (context.round_status !== "active" &&
          context.round_status !== "completed") ||
        (context.player_a_id !== context.player_id &&
          context.player_b_id !== context.player_id)
      ) {
        return c.json(
          { error: "Round or assigned player not found.", requestId },
          404,
        );
      }

      const [attempt] = await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.id, parsed.data.attempt_id),
            eq(attempts.user_id, user.id),
            eq(attempts.task_id, context.task_id),
            eq(attempts.example_id, context.example_id),
            eq(attempts.score_trust, "local_unverified"),
            isNotNull(attempts.completed_at),
          ),
        )
        .limit(1);
      const evaluation = attempt
        ? evaluationResultSchema.safeParse(attempt.evaluation)
        : null;
      if (!attempt || !evaluation?.success) {
        return c.json(
          { error: "Completed local attempt not found.", requestId },
          404,
        );
      }
      const scope = readAttemptModelInfo(attempt.model_info).practice?.scope;
      if (
        !sameMinigameScope(scope, {
          kind: "minigame",
          session_id: sessionId,
          round_id: roundId,
          player_id: context.player_id,
        })
      ) {
        return c.json(
          {
            error:
              "Local attempt is not bound to this minigame round and player.",
            requestId,
          },
          409,
        );
      }
      const [submissionClaim] = await db
        .select({ attempt_id: minigameSubmissionClaims.attempt_id })
        .from(minigameSubmissionClaims)
        .where(
          and(
            eq(minigameSubmissionClaims.round_id, roundId),
            eq(minigameSubmissionClaims.player_id, context.player_id),
            eq(minigameSubmissionClaims.attempt_id, attempt.id),
          ),
        )
        .limit(1);
      if (!submissionClaim) {
        return c.json(
          {
            error: "Local attempt is not claimed for this round and player.",
            requestId,
          },
          409,
        );
      }

      const [existingResult] = await db
        .select()
        .from(minigameRoundResults)
        .where(
          or(
            and(
              eq(minigameRoundResults.round_id, roundId),
              eq(minigameRoundResults.player_id, context.player_id),
            ),
            eq(minigameRoundResults.attempt_id, attempt.id),
          ),
        )
        .limit(1);
      if (
        existingResult &&
        (existingResult.attempt_id !== attempt.id ||
          existingResult.round_id !== roundId ||
          existingResult.player_id !== context.player_id)
      ) {
        return c.json(
          { error: "This player or attempt was already submitted.", requestId },
          409,
        );
      }
      if (context.round_status === "completed" && !existingResult) {
        return c.json(
          { error: "This round is already complete.", requestId },
          409,
        );
      }

      const timingPenalty = calculateTimingPenalty(
        parsed.data.turn_context?.timing,
      );
      const requestedAdjustedScore =
        existingResult?.overall_score ??
        Math.max(0, attempt.overall_score - timingPenalty);
      if (!existingResult) {
        try {
          await db
            .insert(minigameRoundResults)
            .values({
              id: generateUuid(),
              round_id: roundId,
              player_id: context.player_id,
              attempt_id: attempt.id,
              overall_score: requestedAdjustedScore,
              overall_pass: attempt.overall_pass,
              created_at: Date.now(),
            })
            .onConflictDoNothing();
        } catch (error) {
          if (isMinigameClaimDatabaseError(error)) {
            return c.json(
              {
                error: "This minigame submission can no longer be accepted.",
                requestId,
              },
              409,
            );
          }
          throw error;
        }
      }
      const [storedResult] = await db
        .select()
        .from(minigameRoundResults)
        .where(
          or(
            and(
              eq(minigameRoundResults.round_id, roundId),
              eq(minigameRoundResults.player_id, context.player_id),
            ),
            eq(minigameRoundResults.attempt_id, attempt.id),
          ),
        )
        .limit(1);
      if (
        !storedResult ||
        storedResult.attempt_id !== attempt.id ||
        storedResult.round_id !== roundId ||
        storedResult.player_id !== context.player_id
      ) {
        return c.json(
          { error: "This player or attempt was already submitted.", requestId },
          409,
        );
      }
      const adjustedScore = storedResult.overall_score;

      await finalizeMinigameRoundIfReady({
        roundId,
        playerBId: context.player_b_id,
      });

      const modelInfo =
        attempt.model_info && typeof attempt.model_info === "object"
          ? (attempt.model_info as {
              provider?: {
                stt?: { model?: string } | null;
                llm?: { model?: string };
              };
              timing_ms?: { stt?: number; llm?: number };
              input_mode?: "audio" | "typed";
            })
          : undefined;
      const inputMode = modelInfo?.input_mode ?? "audio";
      return c.json({
        requestId,
        attemptId: attempt.id,
        score_trust: "local_unverified",
        transcript: {
          text: attempt.transcript,
          input_mode: inputMode,
          provider:
            inputMode === "typed"
              ? null
              : {
                  kind: "local",
                  model: modelInfo?.provider?.stt?.model ?? "unknown",
                },
          duration_ms:
            inputMode === "typed" ? null : (modelInfo?.timing_ms?.stt ?? null),
        },
        scoring: {
          evaluation: evaluation.data,
          provider: {
            kind: "local",
            model: modelInfo?.provider?.llm?.model ?? "local-llm",
          },
          duration_ms: modelInfo?.timing_ms?.llm ?? 0,
        },
        timing_penalty: timingPenalty,
        adjusted_score: adjustedScore,
      });
    },
  );

  app.post("/api/v1/practice/local/prepare", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const schema = z
      .object({
        session_item_id: z.string().min(1).optional(),
        task_id: z.string().min(1).optional(),
        example_id: z.string().min(1).optional(),
        input_mode: z.enum(["audio", "typed"]).default("audio"),
        transcript: z
          .object({
            text: z.string().trim().min(1).max(20_000),
            model: z.string().trim().min(1).max(200).optional(),
            duration_ms: z.number().int().min(0).max(3_600_000).optional(),
          })
          .optional(),
        minigame: z
          .object({
            session_id: z.string().min(1),
            round_id: z.string().min(1),
            player_id: z.string().min(1),
          })
          .optional(),
      })
      .superRefine((value, ctx) => {
        if (!value.session_item_id && !(value.task_id && value.example_id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide session_item_id or task_id and example_id.",
          });
        }
        if (value.input_mode === "typed" && !value.transcript) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Typed preparation requires a transcript.",
          });
        }
        if (
          value.input_mode === "typed" &&
          (value.transcript?.model !== undefined ||
            value.transcript?.duration_ms !== undefined)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Typed preparation cannot include speech provenance.",
          });
        }
        if (
          value.input_mode === "audio" &&
          value.transcript &&
          (!value.transcript.model ||
            value.transcript.duration_ms === undefined)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Audio transcript provenance is incomplete.",
          });
        }
      });
    let body: unknown;
    try {
      body = await readBoundedJson(c, REQUEST_BODY_LIMITS.localPrepare);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json(
          { error: "The local preparation payload is too large.", requestId },
          413,
        );
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json(
          { error: "Invalid local preparation payload.", requestId },
          400,
        );
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "Invalid local preparation payload.", requestId },
        400,
      );
    }
    if (!checkRateLimit(`practice-local:${user.id}`)) {
      return c.json({ error: "Too many practice requests.", requestId }, 429);
    }

    let taskId = parsed.data.task_id ?? null;
    let exampleId = parsed.data.example_id ?? null;
    let sessionId: string | null = null;
    let sessionItemId: string | null = null;
    if (parsed.data.session_item_id) {
      const [item] = await db
        .select({
          id: practiceSessionItems.id,
          session_id: practiceSessionItems.session_id,
          task_id: practiceSessionItems.task_id,
          example_id: practiceSessionItems.example_id,
          owner_id: practiceSessions.user_id,
        })
        .from(practiceSessionItems)
        .innerJoin(
          practiceSessions,
          eq(practiceSessionItems.session_id, practiceSessions.id),
        )
        .where(eq(practiceSessionItems.id, parsed.data.session_item_id))
        .limit(1);
      if (!item || item.owner_id !== user.id) {
        return c.json({ error: "Session item not found.", requestId }, 404);
      }
      sessionItemId = item.id;
      sessionId = item.session_id;
      taskId = item.task_id;
      exampleId = item.example_id;
    }
    if (!taskId || !exampleId) {
      return c.json({ error: "Task or example missing.", requestId }, 400);
    }

    let minigameScope: MinigameAttemptScope | undefined;
    if (parsed.data.minigame) {
      const requested = parsed.data.minigame;
      const [context] = await db
        .select({
          task_id: minigameRounds.task_id,
          example_id: minigameRounds.example_id,
          player_a_id: minigameRounds.player_a_id,
          player_b_id: minigameRounds.player_b_id,
          player_id: minigamePlayers.id,
          round_status: minigameRounds.status,
        })
        .from(minigameSessions)
        .innerJoin(
          minigameRounds,
          and(
            eq(minigameRounds.id, requested.round_id),
            eq(minigameRounds.session_id, minigameSessions.id),
          ),
        )
        .innerJoin(
          minigamePlayers,
          and(
            eq(minigamePlayers.id, requested.player_id),
            eq(minigamePlayers.session_id, minigameSessions.id),
          ),
        )
        .where(
          and(
            eq(minigameSessions.id, requested.session_id),
            eq(minigameSessions.user_id, user.id),
            isNull(minigameSessions.deleted_at),
            isNull(minigameSessions.ended_at),
          ),
        )
        .limit(1);
      if (
        !context ||
        context.round_status !== "active" ||
        (context.player_a_id !== context.player_id &&
          context.player_b_id !== context.player_id) ||
        context.task_id !== taskId ||
        context.example_id !== exampleId
      ) {
        return c.json(
          {
            error: "Minigame round, player, or practice context was not found.",
            requestId,
          },
          404,
        );
      }
      minigameScope = {
        kind: "minigame",
        session_id: requested.session_id,
        round_id: requested.round_id,
        player_id: requested.player_id,
      };
    }

    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, taskId))
      .orderBy(taskCriteria.sort_order);
    const [exampleRow] = await db
      .select()
      .from(taskExamples)
      .where(
        and(eq(taskExamples.id, exampleId), eq(taskExamples.task_id, taskId)),
      )
      .limit(1);
    if (
      !taskRow ||
      !taskRow.is_published ||
      !exampleRow ||
      criteriaRows.length === 0
    ) {
      return c.json(
        { error: "Practice task context is incomplete.", requestId },
        404,
      );
    }

    let attemptId = nanoid();
    if (minigameScope) {
      try {
        attemptId = await acquireMinigameSubmissionClaim({
          roundId: minigameScope.round_id,
          playerId: minigameScope.player_id,
          userId: user.id,
          taskId,
          exampleId,
          scope: minigameScope,
        });
      } catch (error) {
        if (error instanceof MinigameSubmissionClaimError) {
          return c.json({ error: error.message, requestId }, 409);
        }
        throw error;
      }
    }
    const preparedModelInfo = {
      provider: {
        stt:
          parsed.data.input_mode === "audio" && parsed.data.transcript
            ? {
                kind: "local" as const,
                model: parsed.data.transcript.model!,
              }
            : null,
        llm: null,
      },
      timing_ms:
        parsed.data.input_mode === "audio" && parsed.data.transcript
          ? {
              stt: parsed.data.transcript.duration_ms!,
              total: parsed.data.transcript.duration_ms!,
            }
          : undefined,
      input_mode: parsed.data.input_mode,
      score_trust: "local_unverified" as const,
      state: "prepared",
      practice: minigameScope ? { scope: minigameScope } : undefined,
    };
    const preparedAttempt = {
      id: attemptId,
      user_id: user.id,
      session_id: sessionId,
      session_item_id: sessionItemId,
      task_id: taskId,
      example_id: exampleId,
      started_at: Date.now(),
      completed_at: null,
      audio_ref: null,
      transcript: parsed.data.transcript?.text ?? "",
      evaluation: {},
      overall_pass: false,
      overall_score: 0,
      score_trust: "local_unverified",
      model_info: preparedModelInfo,
    };
    if (minigameScope) {
      await db.insert(attempts).values(preparedAttempt).onConflictDoNothing();
      const [storedAttempt] = await db
        .select()
        .from(attempts)
        .where(eq(attempts.id, attemptId))
        .limit(1);
      const storedInfo = readAttemptModelInfo(storedAttempt?.model_info);
      if (
        !storedAttempt ||
        storedAttempt.user_id !== user.id ||
        storedAttempt.task_id !== taskId ||
        storedAttempt.example_id !== exampleId ||
        storedAttempt.session_id !== sessionId ||
        storedAttempt.session_item_id !== sessionItemId ||
        storedAttempt.completed_at !== null ||
        storedAttempt.score_trust !== "local_unverified" ||
        storedAttempt.transcript !== (parsed.data.transcript?.text ?? "") ||
        (storedInfo.input_mode ?? "audio") !== parsed.data.input_mode ||
        !sameMinigameScope(storedInfo.practice?.scope, minigameScope) ||
        JSON.stringify(storedInfo.provider?.stt ?? null) !==
          JSON.stringify(preparedModelInfo.provider.stt) ||
        JSON.stringify(storedInfo.timing_ms ?? null) !==
          JSON.stringify(preparedModelInfo.timing_ms ?? null)
      ) {
        return c.json(
          {
            error:
              "This minigame submission is already bound to a different preparation.",
            requestId,
          },
          409,
        );
      }
    } else {
      await db.insert(attempts).values(preparedAttempt);
    }

    const task = {
      ...normalizeTask(taskRow),
      criteria: criteriaRows.map(normalizeCriterionRow),
    };
    return c.json({
      requestId,
      attemptId,
      input_mode: parsed.data.input_mode,
      score_trust: "local_unverified",
      task,
      example: normalizeExampleRow(exampleRow),
    });
  });

  app.post("/api/v1/practice/local/commit", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const modelResult = z.object({
      model: z.string().trim().min(1).max(200),
      duration_ms: z.number().int().min(0).max(3_600_000),
    });
    const schema = z.object({
      attempt_id: z.string().min(1),
      input_mode: z.enum(["audio", "typed"]).optional(),
      transcript: z.object({
        text: z.string().trim().min(1).max(20_000),
        model: z.string().trim().min(1).max(200).optional(),
        duration_ms: z.number().int().min(0).max(3_600_000).optional(),
      }),
      evaluation: z.unknown(),
      llm: modelResult,
      practice_mode: z.enum(["standard", "real_time"]).optional(),
      turn_context: z
        .object({
          patient_cache_key: z.string().optional(),
          patient_statement_id: z.string().optional(),
          timing: z
            .object({
              response_delay_ms: z.number().nullable().optional(),
              response_duration_ms: z.number().nullable().optional(),
              response_timer_seconds: z.number().optional(),
              max_response_duration_seconds: z.number().optional(),
            })
            .optional(),
        })
        .optional(),
    });
    let body: unknown;
    try {
      body = await readBoundedJson(c, REQUEST_BODY_LIMITS.localCommit);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json(
          { error: "The local result payload is too large.", requestId },
          413,
        );
      }
      if (error instanceof RequestBodyInvalidJsonError) {
        return c.json(
          { error: "Invalid local result payload.", requestId },
          400,
        );
      }
      throw error;
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid local result payload.", requestId }, 400);
    }

    const [attempt] = await db
      .select()
      .from(attempts)
      .where(
        and(
          eq(attempts.id, parsed.data.attempt_id),
          eq(attempts.user_id, user.id),
        ),
      )
      .limit(1);
    if (!attempt || attempt.score_trust !== "local_unverified") {
      return c.json(
        { error: "Prepared local attempt not found.", requestId },
        404,
      );
    }
    const [publishedTask] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(publishedTaskCondition(attempt.task_id))
      .limit(1);
    if (!publishedTask) {
      return c.json({ error: "Practice task not found.", requestId }, 404);
    }
    const preparedModelInfo = readAttemptModelInfo(attempt.model_info);
    const preparedMinigameScope = preparedModelInfo.practice?.scope;
    if (
      preparedMinigameScope?.kind === "minigame" &&
      attempt.completed_at === null
    ) {
      const [claim] = await db
        .select({ attempt_id: minigameSubmissionClaims.attempt_id })
        .from(minigameSubmissionClaims)
        .innerJoin(
          minigameRounds,
          and(
            eq(minigameRounds.id, minigameSubmissionClaims.round_id),
            eq(minigameRounds.status, "active"),
          ),
        )
        .innerJoin(
          minigameSessions,
          and(
            eq(minigameSessions.id, minigameRounds.session_id),
            eq(minigameSessions.user_id, user.id),
            isNull(minigameSessions.deleted_at),
            isNull(minigameSessions.ended_at),
          ),
        )
        .where(
          and(
            eq(minigameSubmissionClaims.attempt_id, attempt.id),
            eq(
              minigameSubmissionClaims.round_id,
              preparedMinigameScope.round_id,
            ),
            eq(
              minigameSubmissionClaims.player_id,
              preparedMinigameScope.player_id,
            ),
            eq(minigameRounds.session_id, preparedMinigameScope.session_id),
            eq(minigameRounds.task_id, attempt.task_id),
            eq(minigameRounds.example_id, attempt.example_id),
            or(
              eq(minigameRounds.player_a_id, preparedMinigameScope.player_id),
              eq(minigameRounds.player_b_id, preparedMinigameScope.player_id),
            ),
          ),
        )
        .limit(1);
      if (!claim) {
        return c.json(
          {
            error: "This minigame submission can no longer be completed.",
            requestId,
          },
          409,
        );
      }
    }
    const inputMode = preparedModelInfo.input_mode ?? "audio";
    if (parsed.data.input_mode && parsed.data.input_mode !== inputMode) {
      return c.json(
        {
          error: "The result input mode does not match the prepared attempt.",
          requestId,
        },
        409,
      );
    }
    if (
      (inputMode === "typed" &&
        (parsed.data.transcript.model !== undefined ||
          parsed.data.transcript.duration_ms !== undefined)) ||
      (inputMode === "audio" &&
        (!parsed.data.transcript.model ||
          parsed.data.transcript.duration_ms === undefined))
    ) {
      return c.json(
        {
          error: "Invalid transcript provenance for this input mode.",
          requestId,
        },
        400,
      );
    }
    if (
      attempt.transcript &&
      attempt.transcript !== parsed.data.transcript.text
    ) {
      return c.json(
        {
          error: "The transcript does not match the prepared attempt.",
          requestId,
        },
        409,
      );
    }
    if (
      inputMode === "audio" &&
      preparedModelInfo.provider?.stt &&
      (preparedModelInfo.provider.stt.model !== parsed.data.transcript.model ||
        preparedModelInfo.timing_ms?.stt !== parsed.data.transcript.duration_ms)
    ) {
      return c.json(
        {
          error: "The speech provenance does not match the prepared attempt.",
          requestId,
        },
        409,
      );
    }
    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, attempt.task_id))
      .orderBy(taskCriteria.sort_order);
    if (criteriaRows.length === 0) {
      return c.json({ error: "Task criteria are missing.", requestId }, 409);
    }

    let evaluation;
    try {
      const validatedEvaluation = validateAndDeriveLocalEvaluation(
        parsed.data.evaluation,
        {
          taskId: attempt.task_id,
          exampleId: attempt.example_id,
          attemptId: attempt.id,
          transcript: parsed.data.transcript.text,
          criterionIds: criteriaRows.map((criterion) => criterion.id),
        },
      );
      evaluation =
        inputMode === "typed" && validatedEvaluation.diagnostics
          ? { ...validatedEvaluation, diagnostics: undefined }
          : validatedEvaluation;
    } catch (error) {
      if (error instanceof LocalEvaluationValidationError) {
        return c.json({ error: error.message, requestId }, 422);
      }
      throw error;
    }

    const isIdenticalCompletedRetry = (
      candidate: typeof attempts.$inferSelect,
    ) => {
      const modelInfo = readAttemptModelInfo(candidate.model_info);
      return (
        Boolean(candidate.completed_at) &&
        candidate.transcript === parsed.data.transcript.text &&
        JSON.stringify(candidate.evaluation) === JSON.stringify(evaluation) &&
        (modelInfo.input_mode ?? "audio") === inputMode &&
        (inputMode === "typed"
          ? modelInfo.provider?.stt == null
          : modelInfo.provider?.stt?.model === parsed.data.transcript.model) &&
        modelInfo.provider?.llm?.model === parsed.data.llm.model &&
        (inputMode === "typed"
          ? modelInfo.timing_ms?.stt === undefined
          : modelInfo.timing_ms?.stt === parsed.data.transcript.duration_ms) &&
        modelInfo.timing_ms?.llm === parsed.data.llm.duration_ms
      );
    };
    if (attempt.completed_at) {
      if (!isIdenticalCompletedRetry(attempt)) {
        return c.json(
          {
            error:
              "This local attempt is already complete with a different result.",
            requestId,
          },
          409,
        );
      }
      const storedPayload = buildStoredAttemptPayload(attempt, requestId);
      return storedPayload
        ? c.json(storedPayload)
        : c.json(
            { error: "Stored local attempt data is invalid.", requestId },
            409,
          );
    }

    const modelInfo = {
      provider: {
        stt:
          inputMode === "typed"
            ? null
            : { kind: "local" as const, model: parsed.data.transcript.model! },
        llm: { kind: "local", model: parsed.data.llm.model },
      },
      timing_ms: {
        ...(inputMode === "audio"
          ? { stt: parsed.data.transcript.duration_ms! }
          : {}),
        llm: parsed.data.llm.duration_ms,
        total:
          (inputMode === "audio" ? parsed.data.transcript.duration_ms! : 0) +
          parsed.data.llm.duration_ms,
      },
      input_mode: inputMode,
      score_trust: "local_unverified",
      practice:
        parsed.data.practice_mode || preparedModelInfo.practice
          ? {
              mode:
                parsed.data.practice_mode ?? preparedModelInfo.practice?.mode,
              turn_context:
                parsed.data.turn_context ??
                preparedModelInfo.practice?.turn_context ??
                null,
              scope: preparedModelInfo.practice?.scope,
            }
          : undefined,
    };
    let completion;
    try {
      completion = await db
        .update(attempts)
        .set({
          completed_at: Date.now(),
          audio_ref: null,
          transcript: parsed.data.transcript.text,
          evaluation,
          overall_pass: evaluation.overall.pass,
          overall_score: evaluation.overall.score,
          model_info: modelInfo,
        })
        .where(
          and(
            eq(attempts.id, attempt.id),
            eq(attempts.user_id, user.id),
            isNull(attempts.completed_at),
          ),
        );
    } catch (error) {
      if (isMinigameClaimDatabaseError(error)) {
        return c.json(
          {
            error: "This minigame submission can no longer be completed.",
            requestId,
          },
          409,
        );
      }
      throw error;
    }
    const completionChanges =
      completion && typeof completion === "object"
        ? typeof (completion as { changes?: number }).changes === "number"
          ? (completion as unknown as { changes: number }).changes
          : typeof (completion as { meta?: { changes?: number } }).meta
                ?.changes === "number"
            ? (completion as { meta: { changes: number } }).meta.changes
            : 0
        : 0;
    if (completionChanges === 0) {
      const [committedAttempt] = await db
        .select()
        .from(attempts)
        .where(and(eq(attempts.id, attempt.id), eq(attempts.user_id, user.id)))
        .limit(1);
      if (!committedAttempt || !isIdenticalCompletedRetry(committedAttempt)) {
        return c.json(
          {
            error: "This local attempt was committed with a different result.",
            requestId,
          },
          409,
        );
      }
      const storedPayload = buildStoredAttemptPayload(
        committedAttempt,
        requestId,
      );
      return storedPayload
        ? c.json(storedPayload)
        : c.json(
            { error: "Stored local attempt data is invalid.", requestId },
            409,
          );
    }

    const [taskRow] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, attempt.task_id))
      .limit(1);
    let nextDifficulty: number | undefined;
    if (taskRow) {
      const [progress] = await db
        .select({ current_difficulty: userTaskProgress.current_difficulty })
        .from(userTaskProgress)
        .where(
          and(
            eq(userTaskProgress.user_id, user.id),
            eq(userTaskProgress.task_id, attempt.task_id),
          ),
        )
        .limit(1);
      nextDifficulty = progress?.current_difficulty;
    }

    return c.json({
      requestId,
      attemptId: attempt.id,
      score_trust: "local_unverified",
      next_recommended_difficulty: nextDifficulty,
      transcript: {
        text: parsed.data.transcript.text,
        input_mode: inputMode,
        provider:
          inputMode === "typed"
            ? null
            : { kind: "local", model: parsed.data.transcript.model! },
        duration_ms:
          inputMode === "typed" ? null : parsed.data.transcript.duration_ms!,
      },
      scoring: {
        evaluation,
        provider: { kind: "local", model: parsed.data.llm.model },
        duration_ms: parsed.data.llm.duration_ms,
      },
    });
  });

  app.post("/api/v1/practice/run", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const logEvent = (
      level: "debug" | "info" | "warn" | "error",
      event: string,
      fields = {},
    ) => log(level, event, { requestId, userId: user?.id ?? null, ...fields });
    const debugEnabled =
      env.environment === "development" || c.req.query("debug") === "true";

    let body: unknown;
    try {
      body = await readBoundedJson(c, REQUEST_BODY_LIMITS.audioPractice);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return c.json(
          {
            requestId,
            errors: [{ stage: "input", message: "Request body is too large." }],
          },
          413,
        );
      }
      logEvent("error", "input.parse.error", { error: safeError(error) });
      return c.json(
        {
          requestId,
          errors: [{ stage: "input", message: "Invalid JSON body." }],
        },
        400,
      );
    }

    const result = await runPracticeAttempt({
      body,
      debugEnabled,
      logEvent,
      requestId,
      user,
    });

    return c.json(result.payload, toContentfulStatus(result.status));
  });

  return app;
};
