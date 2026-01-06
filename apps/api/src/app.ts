import { Hono, type Context } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  attempts,
  minigamePlayers,
  minigameRoundResults,
  minigameRounds,
  minigameSessions,
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
  users
} from "./db/schema";
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, or } from "drizzle-orm";
import {
  deliberatePracticeTaskV2Schema,
  evaluationResultSchema,
  practiceRunInputSchema,
  taskCriterionSchema,
  taskExampleSchema,
  taskInteractionExampleSchema,
  taskSchema,
  type SttProvider,
  type Task,
  type TaskCriterion,
  type TaskExample,
  type TaskInteractionExample
} from "@deliberate/shared";
import { selectLlmProvider, selectSttProvider } from "./providers";
import { attemptJsonRepair } from "./utils/jsonRepair";
import type { RuntimeEnv } from "./env";
import type { ApiDatabase } from "./db/types";
import { createAdminAuth, resolveAdminStatus } from "./middleware/adminAuth";
import { createUserAuth } from "./middleware/userAuth";
import { decryptOpenAiKey, encryptOpenAiKey } from "./utils/crypto";
import { generateUuid } from "./utils/uuid";
import {
  createLogger,
  log,
  logServerError,
  makeRequestId,
  safeError,
  safeTruncate
} from "./utils/logger";
import { selectTtsProvider } from "./providers";
import {
  assertLocalBaseUrl,
  assertOpenAiKey,
  buildEnvAiConfig,
  resolveEffectiveAiConfig,
  type EffectiveAiConfig,
  DEFAULT_LOCAL_BASE_URL
} from "./providers/config";
import { isProviderConfigError } from "./providers/providerErrors";
import { localSuiteHealthCheck } from "./providers/localSuite";
import { getOrCreateTtsAsset, type TtsStorage } from "./services/ttsService";
import { fetchLeaderboardEntries } from "./services/leaderboardService";
import {
  listMinigameSessions,
  softDeleteMinigameSession,
  updateMinigameResume
} from "./services/minigameSessionsService";
import {
  NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
  NoUniquePatientStatementsLeftError,
  generateMinigameRounds,
  redrawMinigameRound
} from "./services/minigameRoundsService";

export type ApiDependencies = {
  env: RuntimeEnv;
  db: ApiDatabase;
  tts?: {
    storage?: TtsStorage;
  };
};

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
    "quoi"
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

const remapUniqueUuids = <T extends { id: string }>(
  items: T[],
  label: string,
  log?: ReturnType<typeof logger.child>
) => {
  const used = new Set<string>();
  const idMap = new Map<string, string[]>();
  const mapped = items.map((item) => {
    let id = generateUuid();
    while (used.has(id)) {
      id = generateUuid();
    }
    used.add(id);
    const existing = idMap.get(item.id);
    if (existing) {
      existing.push(id);
    } else {
      idMap.set(item.id, [id]);
    }
    return { ...item, id };
  });
  for (const [sourceId, mappedIds] of idMap.entries()) {
    if (mappedIds.length > 1) {
      log?.warn("Duplicate ids detected during parse remap", {
        label,
        id: sourceId,
        count: mappedIds.length
      });
    }
  }
  return { items: mapped, idMap };
};

const remapIdReferences = <T>(
  value: T,
  idMaps: Array<Map<string, string[]>>
): T => {
  const replaceId = (id: string) => {
    for (const map of idMaps) {
      const mapped = map.get(id);
      if (mapped?.length) {
        return mapped[0];
      }
    }
    return id;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, val]) => {
          if (key.endsWith("_id") && typeof val === "string") {
            return [key, replaceId(val)];
          }
          if (key.endsWith("_ids") && Array.isArray(val)) {
            return [
              key,
              val.map((item) => (typeof item === "string" ? replaceId(item) : item))
            ];
          }
          return [key, walk(val)];
        })
      );
    }
    return node;
  };

  return walk(value) as T;
};

const sanitizeInteractionExamples = (
  items: TaskInteractionExample[] | undefined,
  log?: ReturnType<typeof createLogger>
) => {
  if (!items?.length) return [];
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      const difficultyOk =
        Number.isInteger(item.difficulty) && item.difficulty >= 1 && item.difficulty <= 5;
      const patientText = item.patient_text?.trim();
      const therapistText = item.therapist_text?.trim();
      if (!difficultyOk || !patientText || !therapistText) {
        log?.warn("Invalid interaction example dropped", {
          id: item.id,
          index,
          difficulty: item.difficulty
        });
        return false;
      }
      return true;
    })
    .map(({ item }) => ({
      ...item,
      patient_text: item.patient_text.trim(),
      therapist_text: item.therapist_text.trim(),
      title: item.title ?? null
    }));
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const MAX_TTS_TEXT_LENGTH = 2000;

const checkRateLimit = (key: string) => {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return false;
  }
  bucket.count += 1;
  return true;
};

const validateOpenAiApiKey = async (
  apiKey: string
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const resp = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (resp.ok) return { ok: true };

    if (resp.status === 401) return { ok: false, error: "OpenAI rejected this key (401)." };
    if (resp.status === 429) return { ok: false, error: "OpenAI rate-limited this key (429)." };

    return { ok: false, error: `OpenAI validation failed (${resp.status}).` };
  } catch (err) {
    console.error("OpenAI validation network error", err);
    return { ok: false, error: "Unable to reach OpenAI for validation." };
  }
};

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const pickExamplesForDifficulty = (examples: TaskExample[], target: number, count: number) => {
  const sorted = shuffle(examples).sort(
    (a, b) => Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target)
  );
  return sorted.slice(0, Math.min(count, sorted.length));
};

const normalizeTask = (row: typeof tasks.$inferSelect): Task => ({
  ...row,
  tags: row.tags as Task["tags"],
  is_published: Boolean(row.is_published),
  general_objective: row.general_objective ?? null,
  parent_task_id: row.parent_task_id ?? null
});

export const createApiApp = ({ env, db, tts }: ApiDependencies) => {
  const app = new Hono();
  const adminAuth = createAdminAuth(env);
  const userAuth = createUserAuth(env, db);
  const logger = createLogger({ service: "api" });
  const ttsStorage = tts?.storage;
  if (!ttsStorage) {
    throw new Error(
      "TTS storage is not configured. Provide tts.storage (Worker R2 binding)."
    );
  }

  const getUserSettingsRow = async (userId: string) => {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, userId))
      .limit(1);
    return settings ?? null;
  };

  const normalizeUrl = (value?: string | null) => {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  };

  const normalizeSettings = (settings: typeof userSettings.$inferSelect) => {
    const localSttUrl = settings.local_stt_url ?? null;
    const localLlmUrl = settings.local_llm_url ?? null;
    const localBaseUrl = normalizeUrl(settings.local_base_url) ?? DEFAULT_LOCAL_BASE_URL;
    return {
      aiMode: settings.ai_mode,
      localAiBaseUrl: localBaseUrl,
      localSttUrl,
      localLlmUrl,
      storeAudio: settings.store_audio ?? false,
      hasOpenAiKey: Boolean(settings.openai_key_ciphertext && settings.openai_key_iv)
    };
  };

  const ensureUniqueSlug = async (baseSlug: string) => {
    const normalizedBase = baseSlug || `task-${nanoid(6)}`;
    let slug = normalizedBase;
    let suffix = 1;
    while (true) {
      const [existing] = await db.select().from(tasks).where(eq(tasks.slug, slug)).limit(1);
      if (!existing) return slug;
      slug = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
  };

  const ensureUserTaskProgress = async (userId: string, task: Task) => {
    const [existing] = await db
      .select()
      .from(userTaskProgress)
      .where(and(eq(userTaskProgress.user_id, userId), eq(userTaskProgress.task_id, task.id)))
      .limit(1);
    if (existing) return existing;

    const now = Date.now();
    const initial = {
      user_id: userId,
      task_id: task.id,
      current_difficulty: task.base_difficulty,
      last_overall_score: null,
      last_pass: null,
      streak: 0,
      attempt_count: 0,
      updated_at: now
    };
    await db.insert(userTaskProgress).values(initial);
    return initial;
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
      path: c.req.path,
      userId: c.get("user")?.id ?? null,
      content_length: contentLength ? Number(contentLength) : null
    });
    try {
      await next();
    } catch (error) {
      const duration = Date.now() - start;
      log("error", "request.error", {
        requestId,
        duration_ms: duration,
        stage: c.get("logStage") ?? null,
        error: safeError(error)
      });
      return c.json({ error: "Internal server error", requestId }, 500);
    } finally {
      const duration = Date.now() - start;
      const status = c.res.status || 500;
      log("info", "request.end", {
        requestId,
        status,
        duration_ms: duration,
        userId: c.get("user")?.id ?? null
      });
    }
  });

  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

  app.get("/api/v1/health/local-ai", userAuth, async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "health_local_ai" });
    const user = c.get("user");
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      return c.json({ error: "Settings not found." }, 404);
    }

    let config: EffectiveAiConfig;
    try {
      config = await resolveEffectiveAiConfig({
        env,
        settings,
        decryptOpenAiKey
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        log.warn("Local AI config error", { code: error.code });
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      logServerError("health.local_ai.config_error", error as Error, {
        requestId: c.get("requestId"),
        userId: user.id
      });
      return c.json({ error: "Local AI configuration failed." }, 500);
    }

    const sttUrl = config.local.sttUrl ?? config.local.baseUrl;
    const llmUrl = config.local.llmUrl ?? config.local.baseUrl;
    if (!sttUrl || !llmUrl || !config.local.baseUrl) {
      return c.json(
        { error: "Local AI mode requires a local base URL.", code: "LOCAL_BASE_URL_MISSING" },
        400
      );
    }

    const [sttHealthy, llmHealthy, ttsHealthy] = await Promise.all([
      localSuiteHealthCheck(sttUrl),
      localSuiteHealthCheck(llmUrl),
      localSuiteHealthCheck(config.local.baseUrl)
    ]);
    log.info("Local AI health check completed", {
      stt: sttHealthy,
      llm: llmHealthy,
      tts: ttsHealthy
    });
    return c.json({ stt: sttHealthy, llm: llmHealthy, tts: ttsHealthy });
  });

  app.get("/api/v1/tasks", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "tasks_list" });
    const url = new URL(c.req.url);
    const normalizeQueryParam = (value: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    const tags = [
      ...url.searchParams.getAll("tag"),
      ...(url.searchParams.get("tags")?.split(",") ?? [])
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
      offset: z.coerce.number().int().min(0).default(0)
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
      offset: url.searchParams.get("offset") ?? undefined
    });

    const filters = [];
    if (query.q) {
      filters.push(
        or(
          like(tasks.title, `%${query.q}%`),
          like(tasks.description, `%${query.q}%`),
          like(tasks.tags, `%${query.q}%`)
        )
      );
    }
    if (query.tags.length > 0) {
      const tagFilters = query.tags.map((tag) => like(tasks.tags, `%"${tag}"%`));
      filters.push(or(...tagFilters));
    }
    if (query.skill_domain) {
      filters.push(eq(tasks.skill_domain, query.skill_domain));
    }
    if (query.language) {
      filters.push(eq(tasks.language, query.language));
    }
    if (query.published === 1) {
      filters.push(eq(tasks.is_published, true));
    }
    if (query.published === 0) {
      filters.push(eq(tasks.is_published, false));
    }
    if (query.difficulty_min) {
      filters.push(gte(tasks.base_difficulty, query.difficulty_min));
    }
    if (query.difficulty_max) {
      filters.push(lte(tasks.base_difficulty, query.difficulty_max));
    }

    let resultsQuery = db.select().from(tasks);
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
      .where(eq(tasks.is_published, true))
      .groupBy(tasks.language)
      .orderBy(asc(tasks.language));
    const languages = rows.map((row) => row.language).filter(Boolean);
    return c.json({ languages });
  });

  app.get("/api/v1/tasks/tags", async (c) => {
    const rows = await db
      .select({ tags: tasks.tags })
      .from(tasks)
      .where(eq(tasks.is_published, true));
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
      .where(eq(tasks.is_published, true))
      .groupBy(tasks.skill_domain)
      .orderBy(asc(tasks.skill_domain));
    const skill_domains = rows.map((row) => row.skill_domain).filter(Boolean);
    return c.json({ skill_domains });
  });

  app.get("/api/v1/leaderboard", userAuth, async (c) => {
    const url = new URL(c.req.url);
    const tags = [
      ...url.searchParams.getAll("tag"),
      ...(url.searchParams.get("tags")?.split(",") ?? [])
    ]
      .map((tag) => tag.trim())
      .filter(Boolean);

    const querySchema = z.object({
      tags: z.array(z.string()).default([]),
      skill_domain: z.string().min(1).nullable().default(null),
      language: z.string().min(1).nullable().default(null),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    });

    const query = querySchema.parse({
      tags,
      skill_domain: url.searchParams.get("skill_domain"),
      language: url.searchParams.get("language"),
      limit: url.searchParams.get("limit") ?? undefined
    });

    const entries = await fetchLeaderboardEntries(db, {
      tags: query.tags,
      skillDomain: query.skill_domain,
      language: query.language,
      limit: query.limit
    });

    return c.json({
      query: {
        tags: query.tags,
        skill_domain: query.skill_domain,
        language: query.language,
        limit: query.limit
      },
      entries,
      generated_at: Date.now()
    });
  });

  app.get("/api/v1/profiles", userAuth, async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "profiles" });
    const rows = await db
      .select({
        id: users.id,
        display_name: users.display_name,
        bio: users.bio,
        created_at: users.created_at
      })
      .from(users)
      .orderBy(desc(users.created_at));
    log.info("Profiles fetched", { count: rows.length });
    return c.json({
      profiles: rows.map((row) => ({
        id: row.id,
        display_name: row.display_name,
        bio: row.bio ?? null,
        created_at: new Date(row.created_at).toISOString()
      }))
    });
  });

  app.get("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const includeInteractions = c.req.query("include_interactions") === "1";
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "tasks_get", taskId: id });
    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
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
    const counts = exampleRows.reduce<Record<number, number>>((acc, example) => {
      acc[example.difficulty] = (acc[example.difficulty] ?? 0) + 1;
      return acc;
    }, {});
    log.info("Task detail fetched", {
      criteria: criteriaRows.length,
      examples: exampleRows.length,
      interactionExamples: interactionRows.length
    });
    return c.json({
      ...normalizeTask(taskRow),
      criteria: criteriaRows.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        description: criterion.description,
        rubric: criterion.rubric ?? undefined
      })),
      example_counts: counts,
      ...(includeInteractions
        ? {
            interaction_examples: interactionRows.map((example) => ({
              id: example.id,
              difficulty: example.difficulty,
              title: example.title ?? null,
              patient_text: example.patient_text,
              therapist_text: example.therapist_text
            }))
          }
        : {})
    });
  });

  app.get("/api/v1/tasks/:id/examples", async (c) => {
    const taskId = c.req.param("id");
    const { difficulty, limit, exclude } = c.req.query();
    const excludeIds = exclude ? exclude.split(",").map((value) => value.trim()) : [];
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
        meta: example.meta ?? null
      }))
    );
  });

  app.post("/api/v1/sessions/start", userAuth, async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "sessions_start" });
    const body = await c.req.json();
    const schema = z.object({
      mode: z.enum(["single_task", "mixed_set"]),
      task_id: z.string().optional(),
      item_count: z.number().min(1).max(25),
      difficulty: z.number().min(1).max(5).optional()
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
        .where(eq(tasks.id, data.task_id))
        .limit(1);
      if (!taskRow) {
        return c.json({ error: "Task not found" }, 404);
      }
      const task = normalizeTask(taskRow);
      const progress = await ensureUserTaskProgress(user.id, task);
      const targetDifficulty = data.difficulty ?? progress.current_difficulty;
      const examples = await db
        .select()
        .from(taskExamples)
        .where(eq(taskExamples.task_id, task.id));
      const normalized = examples.map((example) => ({
        ...example,
        meta: example.meta ?? null
      }));
      const attemptedIds = attemptMap.get(task.id) ?? new Set<string>();
      const fresh = normalized.filter((example) => !attemptedIds.has(example.id));
      const pool = fresh.length >= data.item_count ? fresh : normalized;
      const picked = pickExamplesForDifficulty(pool, targetDifficulty, data.item_count);
      picked.forEach((example, index) => {
        selectedItems.push({
          session_item_id: nanoid(),
          task_id: task.id,
          example_id: example.id,
          target_difficulty: targetDifficulty,
          patient_text: example.patient_text
        });
      });
    } else {
      const taskRows = await db.select().from(tasks).where(eq(tasks.is_published, true));
      if (!taskRows.length) {
        return c.json({ error: "No tasks available" }, 400);
      }
      const taskList = taskRows.map((row) => normalizeTask(row));
      const progressRows = await db
        .select()
        .from(userTaskProgress)
        .where(eq(userTaskProgress.user_id, user.id));
      const progressMap = new Map(progressRows.map((row) => [row.task_id, row]));
      const weighted = [...taskList].sort((a, b) => {
        const aProgress = progressMap.get(a.id)?.attempt_count ?? 0;
        const bProgress = progressMap.get(b.id)?.attempt_count ?? 0;
        return aProgress - bProgress;
      });
      const chosenTasks = shuffle(weighted).slice(0, Math.min(weighted.length, data.item_count));
      for (const task of chosenTasks) {
        const progress = await ensureUserTaskProgress(user.id, task);
        const targetDifficulty = progress.current_difficulty;
        const examples = await db
          .select()
          .from(taskExamples)
          .where(eq(taskExamples.task_id, task.id));
        const normalized = examples.map((example) => ({
          ...example,
          meta: example.meta ?? null
        }));
        const attemptedIds = attemptMap.get(task.id) ?? new Set<string>();
        const fresh = normalized.filter((example) => !attemptedIds.has(example.id));
        const pool = fresh.length ? fresh : normalized;
        const picked = pickExamplesForDifficulty(pool, targetDifficulty, 1);
        const example = picked[0];
        if (!example) continue;
        selectedItems.push({
          session_item_id: nanoid(),
          task_id: task.id,
          example_id: example.id,
          target_difficulty: targetDifficulty,
          patient_text: example.patient_text
        });
      }
    }

    if (!selectedItems.length) {
      return c.json({ error: "No examples available for this session." }, 400);
    }

    await db.insert(practiceSessions).values({
      id: sessionId,
      user_id: user.id,
      mode: data.mode,
      source_task_id: data.mode === "single_task" ? data.task_id ?? null : null,
      random_seed: nanoid(),
      created_at: createdAt,
      ended_at: null
    });

    await db.insert(practiceSessionItems).values(
      selectedItems.map((item, index) => ({
        id: item.session_item_id,
        session_id: sessionId,
        position: index,
        task_id: item.task_id,
        example_id: item.example_id,
        target_difficulty: item.target_difficulty,
        created_at: createdAt
      }))
    );

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
    const sessions = await db
      .select()
      .from(practiceSessions)
      .where(filters.length > 1 ? and(...filters) : filters[0])
      .orderBy(desc(practiceSessions.created_at));

    if (!sessions.length) {
      return c.json([]);
    }

    const sessionIds = sessions.map((session) => session.id);
    const items = await db
      .select({
        session_id: practiceSessionItems.session_id,
        session_item_id: practiceSessionItems.id,
        task_id: practiceSessionItems.task_id,
        example_id: practiceSessionItems.example_id,
        target_difficulty: practiceSessionItems.target_difficulty,
        patient_text: taskExamples.patient_text,
        position: practiceSessionItems.position
      })
      .from(practiceSessionItems)
      .leftJoin(taskExamples, eq(practiceSessionItems.example_id, taskExamples.id))
      .where(inArray(practiceSessionItems.session_id, sessionIds))
      .orderBy(practiceSessionItems.session_id, practiceSessionItems.position);

    const attemptsRows = await db
      .select({ session_id: attempts.session_id, session_item_id: attempts.session_item_id })
      .from(attempts)
      .where(and(eq(attempts.user_id, user.id), inArray(attempts.session_id, sessionIds)));

    const attemptsBySession = attemptsRows.reduce((map, row) => {
      if (!row.session_id || !row.session_item_id) return map;
      const existing = map.get(row.session_id) ?? new Set<string>();
      existing.add(row.session_item_id);
      map.set(row.session_id, existing);
      return map;
    }, new Map<string, Set<string>>());

    const itemsBySession = items.reduce((map, item) => {
      const entry = map.get(item.session_id) ?? [];
      entry.push({
        session_item_id: item.session_item_id,
        task_id: item.task_id,
        example_id: item.example_id,
        target_difficulty: item.target_difficulty,
        patient_text: item.patient_text ?? ""
      });
      map.set(item.session_id, entry);
      return map;
    }, new Map<string, Array<{ session_item_id: string; task_id: string; example_id: string; target_difficulty: number; patient_text: string }>>());

    return c.json(
      sessions.map((session) => {
        const sessionItems = itemsBySession.get(session.id) ?? [];
        const completed = attemptsBySession.get(session.id) ?? new Set<string>();
        return {
          id: session.id,
          mode: session.mode,
          source_task_id: session.source_task_id ?? null,
          created_at: session.created_at,
          ended_at: session.ended_at ?? null,
          item_count: sessionItems.length,
          completed_count: completed.size,
          items: sessionItems
        };
      })
    );
  });

  app.get("/api/v1/sessions/:id", userAuth, async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select()
      .from(practiceSessions)
      .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.user_id, user.id)))
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
        position: practiceSessionItems.position
      })
      .from(practiceSessionItems)
      .leftJoin(taskExamples, eq(practiceSessionItems.example_id, taskExamples.id))
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
        patient_text: item.patient_text ?? ""
      }))
    });
  });

  app.get("/api/v1/sessions/:id/attempts", userAuth, async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const [session] = await db
      .select({ id: practiceSessions.id })
      .from(practiceSessions)
      .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.user_id, user.id)))
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
        overall_pass: attempts.overall_pass
      })
      .from(attempts)
      .where(and(eq(attempts.user_id, user.id), eq(attempts.session_id, sessionId)))
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
      }
    >();

    for (const attempt of attemptRows) {
      if (!attempt.session_item_id) continue;
      if (!latestByItem.has(attempt.session_item_id)) {
        const evaluation =
          attempt.evaluation && evaluationResultSchema.safeParse(attempt.evaluation).success
            ? attempt.evaluation
            : null;
        latestByItem.set(attempt.session_item_id, { ...attempt, evaluation });
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
      .where(and(eq(practiceSessions.id, sessionId), eq(practiceSessions.user_id, user.id)))
      .limit(1);

    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    await db
      .delete(attempts)
      .where(and(eq(attempts.user_id, user.id), eq(attempts.session_id, sessionId)));
    await db.delete(practiceSessionItems).where(eq(practiceSessionItems.session_id, sessionId));
    await db.delete(practiceSessions).where(eq(practiceSessions.id, sessionId));

    return c.json({ ok: true });
  });

  app.get("/api/v1/admin/whoami", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_whoami" });
    const result = await resolveAdminStatus(env, c.req.raw.headers);
    if (!result.ok) {
      if (result.status >= 500) {
        logServerError("admin.whoami.error", new Error(result.message), {
          requestId: c.get("requestId"),
          status: result.status
        });
      } else {
        log.warn("Admin whoami failed", { status: result.status });
      }
      return c.json(
        { isAuthenticated: false, isAdmin: false, email: null },
        result.status >= 500 ? 500 : 200
      );
    }
    const { identity } = result;
    log.info("Admin whoami resolved", {
      isAuthenticated: identity.isAuthenticated,
      isAdmin: result.isAdmin
    });
    return c.json({
      isAuthenticated: identity.isAuthenticated,
      isAdmin: identity.isAuthenticated ? result.isAdmin : false,
      email: identity.email
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
  const selectPatientTtsProvider = async (
    config: EffectiveAiConfig,
    logEvent: (level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => void
  ) => {
    logEvent("info", "tts.select.start", { mode: config.mode });
    const ttsSelection = await selectTtsProvider(
      config,
      {
        openai: {
          model: env.openaiTtsModel,
          voice: env.openaiTtsVoice,
          format: env.openaiTtsFormat,
          instructions: env.openaiTtsInstructions
        },
        local: {
          voice: env.localTtsVoice,
          format: env.localTtsFormat
        }
      },
      logEvent
    );
    logEvent("info", "tts.select.ok", {
      selected: { kind: ttsSelection.provider.kind, model: ttsSelection.provider.model },
      health: ttsSelection.health
    });
    return ttsSelection.provider;
  };

  const handleTtsRequest = async (c: Context) => {
    const requestId = c.get("requestId");
    const cacheKey = c.req.param("cacheKey");
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, cache_key: cacheKey, ...fields });

    if (!ttsConfigReady) {
      logServerError("tts.config.missing", new Error("TTS storage is not configured."), {
        requestId,
        cache_key: cacheKey
      });
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

    try {
      const object = await ttsStorage.getObject(env.r2Bucket, asset.r2_key);
      const headers: Record<string, string> = {
        "Content-Type": asset.content_type ?? object.contentType,
        "Cache-Control": "public, max-age=31536000, immutable"
      };
      const etag = asset.etag ?? object.etag;
      if (etag) {
        headers.ETag = etag;
      }
      if (c.req.method === "HEAD") {
        return c.body(null, 200, headers);
      }
      return c.body(object.body, 200, headers);
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
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, userId: user?.id ?? null, ...fields });

    if (!ttsConfigReady) {
      logServerError("tts.config.missing", new Error("TTS storage is not configured."), {
        requestId,
        userId: user?.id ?? null
      });
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
        decryptOpenAiKey
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "tts.prefetch.config_error", { code: error.code });
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      logServerError("tts.prefetch.config_error", error as Error, {
        requestId,
        userId: user?.id ?? null
      });
      return c.json({ error: "TTS configuration failed." }, 500);
    }

    const schema = z.object({
      exercise_id: z.string(),
      practice_mode: z.literal("real_time"),
      statement_id: z.string().optional()
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logEvent("warn", "tts.prefetch.invalid_input");
      return c.json({ error: "Invalid prefetch payload." }, 400);
    }

    const { exercise_id: exerciseId, statement_id: statementId } = parsed.data;
    let patientText: string | null = null;

    if (statementId) {
      const [example] = await db
        .select()
        .from(taskExamples)
        .where(eq(taskExamples.id, statementId))
        .limit(1);
      if (!example || example.task_id !== exerciseId) {
        return c.json({ error: "Statement not found for exercise." }, 404);
      }
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
      patientText = example.patient_text;
    }

    if (patientText.length > MAX_TTS_TEXT_LENGTH) {
      logEvent("warn", "tts.prefetch.text_too_long", { text_length: patientText.length });
      return c.json({ error: "Patient text too long for TTS." }, 400);
    }

    let ttsProvider: Awaited<ReturnType<typeof selectPatientTtsProvider>>;
    try {
      ttsProvider = await selectPatientTtsProvider(config, logEvent);
    } catch (error) {
      logEvent("error", "tts.select.error", { error: safeError(error) });
      return c.json(
        { error: (error as Error).message || "TTS unavailable." },
        502
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
          format: ttsProvider.format
        },
        logEvent
      );

      if (result.status === "generating") {
        return c.json(
          {
            cache_key: result.cacheKey,
            status: "generating",
            retry_after_ms: result.retryAfterMs
          },
          202
        );
      }

      return c.json({
        cache_key: result.cacheKey,
        audio_url: result.audioUrl,
        status: "ready"
      });
    } catch (error) {
      logEvent("error", "tts.prefetch.error", { error: safeError(error) });
      return c.json({ error: "TTS generation failed." }, 500);
    }
  });

  app.post("/api/v1/practice/patient-audio/prefetch-batch", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, userId: user?.id ?? null, ...fields });

    if (!ttsConfigReady) {
      logServerError("tts.config.missing", new Error("TTS storage is not configured."), {
        requestId,
        userId: user?.id ?? null
      });
      return c.json({ error: "TTS storage is not configured." }, 500);
    }
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "tts.prefetch.settings_missing");
      return c.json({ error: "Settings not found." }, 404);
    }

    const schema = z.object({
      exercise_id: z.string(),
      practice_mode: z.literal("real_time"),
      statement_ids: z.array(z.string()).min(1)
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      logEvent("warn", "tts.prefetch_batch.invalid_input");
      return c.json({ error: "Invalid prefetch payload." }, 400);
    }

    const { exercise_id: exerciseId, statement_ids: statementIds } = parsed.data;
    const examples = await db
      .select()
      .from(taskExamples)
      .where(and(eq(taskExamples.task_id, exerciseId), inArray(taskExamples.id, statementIds)));
    const exampleMap = new Map(examples.map((example) => [example.id, example]));
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

    let config: EffectiveAiConfig;
    try {
      config = await resolveEffectiveAiConfig({
        env,
        settings,
        decryptOpenAiKey
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "tts.prefetch_batch.config_error", { code: error.code });
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      logServerError("tts.prefetch_batch.config_error", error as Error, {
        requestId,
        userId: user?.id ?? null
      });
      return c.json({ error: "TTS configuration failed." }, 500);
    }
    let ttsProvider: Awaited<ReturnType<typeof selectPatientTtsProvider>>;
    try {
      ttsProvider = await selectPatientTtsProvider(config, logEvent);
    } catch (error) {
      logEvent("error", "tts.select.error", { error: safeError(error) });
      return c.json(
        { error: (error as Error).message || "TTS unavailable." },
        502
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
              retry_after_ms: 500
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
              format: ttsProvider.format
            },
            logEvent
          );

          if (result.status === "ready") {
            return {
              statement_id: statementId,
              cache_key: result.cacheKey,
              status: "ready" as const,
              audio_url: result.audioUrl
            };
          }

          return {
            statement_id: statementId,
            cache_key: result.cacheKey,
            status: "generating" as const,
            retry_after_ms: result.retryAfterMs
          };
        })
      );

      const readyCount = results.filter((item) => item.status === "ready").length;
      return c.json({
        items: results,
        ready_count: readyCount,
        total_count: results.length
      });
    } catch (error) {
      logEvent("error", "tts.prefetch_batch.error", { error: safeError(error) });
      return c.json({ error: "TTS generation failed." }, 500);
    }
  });

  app.post("/api/v1/admin/parse-task", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_parse_task" });
    const body = await c.req.json();
    const schema = z.object({
      free_text: z.string().optional().default(""),
      source_url: z.string().nullable().optional(),
      parse_mode: z.enum(["original", "exact", "partial_prompt"]).default("exact")
    });
    const data = schema.parse(body);
    log.info("Parse task request received", {
      hasSourceUrl: Boolean(data.source_url),
      hasFreeText: Boolean(data.free_text?.trim()),
      parseMode: data.parse_mode
    });
    let sourceText = data.free_text?.trim() ?? "";
    if (!sourceText && data.source_url) {
      const response = await fetch(data.source_url);
      if (!response.ok) {
        log.warn("Source URL fetch failed", { status: response.status });
        return c.json({ error: "Failed to fetch source URL" }, 400);
      }
      const html = await response.text();
      sourceText = stripHtml(html);
    }
    if (!sourceText) {
      log.warn("Parse task missing source text");
      return c.json({ error: "Provide free_text or source_url" }, 400);
    }
    const inferredLanguage = inferLanguage(sourceText);
    if (!env.openaiApiKey) {
      logServerError("admin.parse_task.openai_key_missing", new Error("OpenAI key missing"), {
        requestId: c.get("requestId")
      });
      return c.json({ error: "OpenAI key missing" }, 500);
    }
    let llmProvider;
    try {
      const selection = await selectLlmProvider(buildEnvAiConfig(env, "openai_only"), log);
      llmProvider = selection.provider;
    } catch (error) {
      log.error("LLM provider selection failed", { error: safeError(error) });
      return c.json({ error: "OpenAI LLM unavailable" }, 500);
    }

    let parsed;
    try {
      parsed = await llmProvider.parseExercise({
        sourceText,
        parseMode: data.parse_mode
      });
    } catch (error) {
      log.error("LLM parse failed", { error: safeError(error) });
      return c.json({ error: "OpenAI parse failed" }, 500);
    }

    const { items: criteria, idMap: criteriaIdMap } = remapUniqueUuids(parsed.criteria, "criteria", log);
    const { items: examples, idMap: exampleIdMap } = remapUniqueUuids(parsed.examples, "examples", log);
    const { items: interactionExamples, idMap: interactionIdMap } = remapUniqueUuids(
      parsed.interaction_examples ?? [],
      "interaction_examples",
      log
    );
    const normalizedParsed = remapIdReferences(
      {
        ...parsed,
        task: {
          ...parsed.task,
          language: inferredLanguage
        },
        criteria,
        examples: examples.map((example) => ({
          ...example,
          language: example.language ?? inferredLanguage
        })),
        interaction_examples: interactionExamples
      },
      [criteriaIdMap, exampleIdMap, interactionIdMap]
    );

    const validated = deliberatePracticeTaskV2Schema.safeParse(normalizedParsed);
    if (!validated.success) {
      log.warn("Mapped parse response failed validation");
      return c.json(
        { error: "Mapped parse response failed validation", details: validated.error.flatten() },
        400
      );
    }
    log.info("Parse task completed");
    return c.json(validated.data);
  });

  app.post("/api/v1/admin/import-task", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_import_task" });
    const body = await c.req.json();
    const schema = z.object({
      task_v2: deliberatePracticeTaskV2Schema,
      task_overrides: z
        .object({
          id: z.string().optional(),
          slug: z.string().optional(),
          is_published: z.boolean().optional()
        })
        .optional()
    });
    const data = schema.parse(body);
    const parsedTask = data.task_v2;
    const taskLanguage = parsedTask.task.language ?? "en";
    const interactionExamples = sanitizeInteractionExamples(parsedTask.interaction_examples, log);
    const taskId = data.task_overrides?.id ?? nanoid();
    const slug = data.task_overrides?.slug ?? slugify(parsedTask.task.title);
    const now = Date.now();

    const [existing] = await db.select().from(tasks).where(eq(tasks.slug, slug)).limit(1);
    if (existing) {
      await db
        .update(tasks)
        .set({
          title: parsedTask.task.title,
          description: parsedTask.task.description,
          skill_domain: parsedTask.task.skill_domain,
          base_difficulty: parsedTask.task.base_difficulty,
          general_objective: parsedTask.task.general_objective ?? null,
          tags: parsedTask.task.tags,
          language: taskLanguage,
          is_published: data.task_overrides?.is_published ?? existing.is_published,
          updated_at: now
        })
        .where(eq(tasks.id, existing.id));

      await db.delete(taskCriteria).where(eq(taskCriteria.task_id, existing.id));
      await db.delete(taskExamples).where(eq(taskExamples.task_id, existing.id));
      await db.delete(taskInteractionExamples).where(eq(taskInteractionExamples.task_id, existing.id));

      await db.insert(taskCriteria).values(
        parsedTask.criteria.map((criterion, index) => ({
          task_id: existing.id,
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          rubric: criterion.rubric ?? null,
          sort_order: index
        }))
      );
      await db.insert(taskExamples).values(
        parsedTask.examples.map((example) => ({
          id: example.id,
          task_id: existing.id,
          difficulty: example.difficulty,
          severity_label: example.severity_label ?? null,
          patient_text: example.patient_text,
          language: example.language ?? taskLanguage,
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
      if (interactionExamples.length) {
        await db.insert(taskInteractionExamples).values(
          interactionExamples.map((example) => ({
            id: example.id,
            task_id: existing.id,
            difficulty: example.difficulty,
            title: example.title ?? null,
            patient_text: example.patient_text,
            therapist_text: example.therapist_text,
            language: taskLanguage,
            meta: null,
            created_at: now,
            updated_at: now
          }))
        );
      }
      log.info("Task imported (updated)", { taskId: existing.id, slug });
      return c.json({ id: existing.id, slug });
    }

    await db.insert(tasks).values({
      id: taskId,
      slug,
      title: parsedTask.task.title,
      description: parsedTask.task.description,
      skill_domain: parsedTask.task.skill_domain,
      base_difficulty: parsedTask.task.base_difficulty,
      general_objective: parsedTask.task.general_objective ?? null,
      tags: parsedTask.task.tags,
      language: taskLanguage,
      is_published: data.task_overrides?.is_published ?? false,
      parent_task_id: null,
      created_at: now,
      updated_at: now
    });

    await db.insert(taskCriteria).values(
      parsedTask.criteria.map((criterion, index) => ({
        task_id: taskId,
        id: criterion.id,
        label: criterion.label,
        description: criterion.description,
        rubric: criterion.rubric ?? null,
        sort_order: index
      }))
    );

    await db.insert(taskExamples).values(
      parsedTask.examples.map((example) => ({
        id: example.id,
        task_id: taskId,
        difficulty: example.difficulty,
        severity_label: example.severity_label ?? null,
        patient_text: example.patient_text,
        language: example.language ?? taskLanguage,
        meta: example.meta ?? null,
        created_at: now,
        updated_at: now
      }))
    );
    if (interactionExamples.length) {
      await db.insert(taskInteractionExamples).values(
        interactionExamples.map((example) => ({
          id: example.id,
          task_id: taskId,
          difficulty: example.difficulty,
          title: example.title ?? null,
          patient_text: example.patient_text,
          therapist_text: example.therapist_text,
          language: taskLanguage,
          meta: null,
          created_at: now,
          updated_at: now
        }))
      );
    }
    log.info("Task imported (created)", { taskId, slug });
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
    language: z.string().optional(),
    is_published: z.boolean().optional(),
    criteria: z.array(taskCriterionSchema).optional(),
    examples: z.array(taskExampleSchema).optional()
  });

  app.post("/api/v1/admin/tasks", async (c) => {
    const body = await c.req.json();
    const parsed = createTaskSchema.parse(body);
    const now = Date.now();
    const taskId = nanoid();
    const slug = await ensureUniqueSlug(slugify(parsed.title));
    const taskLanguage = parsed.language ?? "en";

    await db.insert(tasks).values({
      id: taskId,
      slug,
      title: parsed.title,
      description: parsed.description,
      skill_domain: parsed.skill_domain,
      base_difficulty: parsed.base_difficulty,
      general_objective: parsed.general_objective ?? null,
      tags: parsed.tags,
      language: taskLanguage,
      is_published: parsed.is_published ?? false,
      parent_task_id: null,
      created_at: now,
      updated_at: now
    });

    if (parsed.criteria?.length) {
      await db.insert(taskCriteria).values(
        parsed.criteria.map((criterion, index) => ({
          task_id: taskId,
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          rubric: criterion.rubric ?? null,
          sort_order: index
        }))
      );
    }

    if (parsed.examples?.length) {
      await db.insert(taskExamples).values(
        parsed.examples.map((example) => ({
          id: example.id ?? nanoid(),
          task_id: taskId,
          difficulty: example.difficulty,
          severity_label: example.severity_label ?? null,
          patient_text: example.patient_text,
          language: example.language ?? taskLanguage,
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
    }

    return c.json({ id: taskId, slug });
  });

  app.get("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
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
        rubric: criterion.rubric ?? undefined
      })),
      examples: exampleRows.map((example) => ({
        ...example,
        meta: example.meta ?? null
      })),
      interaction_examples: interactionRows.map((example) => ({
        id: example.id,
        difficulty: example.difficulty,
        title: example.title ?? null,
        patient_text: example.patient_text,
        therapist_text: example.therapist_text
      }))
    });
  });

  app.post("/api/v1/admin/tasks/:id/duplicate", async (c) => {
    const id = c.req.param("id");
    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
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

    const now = Date.now();
    const newTaskId = nanoid();
    const slug = await ensureUniqueSlug(slugify(`${taskRow.title}-copy`));

    await db.insert(tasks).values({
      ...taskRow,
      id: newTaskId,
      slug,
      title: `${taskRow.title} (Copy)`,
      created_at: now,
      updated_at: now
    });

    if (criteriaRows.length) {
      await db.insert(taskCriteria).values(
        criteriaRows.map((criterion) => ({
          task_id: newTaskId,
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          rubric: criterion.rubric ?? null,
          sort_order: criterion.sort_order
        }))
      );
    }

    if (exampleRows.length) {
      await db.insert(taskExamples).values(
        exampleRows.map((example) => ({
          id: nanoid(),
          task_id: newTaskId,
          difficulty: example.difficulty,
          severity_label: example.severity_label ?? null,
          patient_text: example.patient_text,
          language: example.language,
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
    }

    if (interactionRows.length) {
      await db.insert(taskInteractionExamples).values(
        interactionRows.map((example) => ({
          id: nanoid(),
          task_id: newTaskId,
          difficulty: example.difficulty,
          title: example.title ?? null,
          patient_text: example.patient_text,
          therapist_text: example.therapist_text,
          language: example.language,
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
    }

    return c.json({ id: newTaskId, slug });
  });

  app.post("/api/v1/admin/tasks/:id/translate", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_translate_task" });
    const id = c.req.param("id");
    const body = await c.req.json();
    const schema = z.object({
      target_language: z.enum(["en", "fr"])
    });
    const data = schema.parse(body);
    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
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

    if (!env.openaiApiKey) {
      logServerError("admin.translate_task.openai_key_missing", new Error("OpenAI key missing"), {
        requestId: c.get("requestId")
      });
      return c.json({ error: "OpenAI key missing" }, 500);
    }

    let llmProvider;
    try {
      const selection = await selectLlmProvider(buildEnvAiConfig(env, "openai_only"), log);
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
            language: taskRow.language
          },
          criteria: criteriaRows.map((criterion) => ({
            id: criterion.id,
            label: criterion.label,
            description: criterion.description,
            rubric: criterion.rubric ?? undefined
          })),
          examples: exampleRows.map((example) => ({
            id: example.id,
            difficulty: example.difficulty,
            severity_label: example.severity_label ?? null,
            patient_text: example.patient_text,
            language: example.language ?? taskRow.language,
            meta: example.meta ?? null
          })),
          interaction_examples: interactionRows.map((example) => ({
            id: example.id,
            difficulty: example.difficulty,
            title: example.title ?? null,
            patient_text: example.patient_text,
            therapist_text: example.therapist_text
          }))
        },
        targetLanguage: data.target_language
      });
    } catch (error) {
      log.error("LLM translation failed", { error: safeError(error) });
      return c.json({ error: "OpenAI translation failed" }, 500);
    }

    const now = Date.now();
    const newTaskId = nanoid();
    const slug = await ensureUniqueSlug(slugify(translated.task.title));

    await db.insert(tasks).values({
      id: newTaskId,
      slug,
      title: translated.task.title,
      description: translated.task.description,
      skill_domain: translated.task.skill_domain,
      base_difficulty: translated.task.base_difficulty,
      general_objective: translated.task.general_objective ?? null,
      tags: translated.task.tags,
      language: data.target_language,
      is_published: taskRow.is_published,
      parent_task_id: taskRow.id,
      created_at: now,
      updated_at: now
    });

    if (translated.criteria.length) {
      await db.insert(taskCriteria).values(
        translated.criteria.map((criterion, index) => ({
          task_id: newTaskId,
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          rubric: criterion.rubric ?? null,
          sort_order: index
        }))
      );
    }

    if (translated.examples.length) {
      await db.insert(taskExamples).values(
        translated.examples.map((example) => ({
          id: nanoid(),
          task_id: newTaskId,
          difficulty: example.difficulty,
          severity_label: example.severity_label ?? null,
          patient_text: example.patient_text,
          language: example.language ?? data.target_language,
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
    }

    const translatedInteractionExamples = sanitizeInteractionExamples(
      translated.interaction_examples,
      log
    );
    if (translatedInteractionExamples.length) {
      await db.insert(taskInteractionExamples).values(
        translatedInteractionExamples.map((example) => ({
          id: nanoid(),
          task_id: newTaskId,
          difficulty: example.difficulty,
          title: example.title ?? null,
          patient_text: example.patient_text,
          therapist_text: example.therapist_text,
          language: data.target_language,
          meta: null,
          created_at: now,
          updated_at: now
        }))
      );
    }

    return c.json({ id: newTaskId, slug });
  });

  app.put("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_update_task", taskId: id });
    const body = await c.req.json();
    const parsed = taskSchema
      .extend({
        criteria: z.array(taskCriterionSchema).optional(),
        examples: z.array(taskExampleSchema).optional(),
        interaction_examples: z.array(taskInteractionExampleSchema).optional()
      })
      .parse(body);
    const now = Date.now();
    const taskLanguage = parsed.language ?? "en";
    const interactionExamples =
      parsed.interaction_examples === undefined
        ? undefined
        : sanitizeInteractionExamples(parsed.interaction_examples, log);
    await db
      .update(tasks)
      .set({
        slug: parsed.slug,
        title: parsed.title,
        description: parsed.description,
        skill_domain: parsed.skill_domain,
        base_difficulty: parsed.base_difficulty,
        general_objective: parsed.general_objective ?? null,
        tags: parsed.tags,
        language: taskLanguage,
        is_published: parsed.is_published,
        parent_task_id: parsed.parent_task_id ?? null,
        updated_at: now
      })
      .where(eq(tasks.id, id));

    if (parsed.criteria) {
      await db.delete(taskCriteria).where(eq(taskCriteria.task_id, id));
      await db.insert(taskCriteria).values(
        parsed.criteria.map((criterion, index) => ({
          task_id: id,
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          rubric: criterion.rubric ?? null,
          sort_order: index
        }))
      );
    }
    if (parsed.examples) {
      await db.delete(taskExamples).where(eq(taskExamples.task_id, id));
      await db.insert(taskExamples).values(
        parsed.examples.map((example) => ({
          id: example.id,
          task_id: id,
          difficulty: example.difficulty,
          severity_label: example.severity_label ?? null,
          patient_text: example.patient_text,
          language: example.language ?? taskLanguage,
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
    }
    if (interactionExamples !== undefined) {
      await db.delete(taskInteractionExamples).where(eq(taskInteractionExamples.task_id, id));
      if (interactionExamples.length) {
        await db.insert(taskInteractionExamples).values(
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
            updated_at: now
          }))
        );
      }
    }

    return c.json({ status: "updated" });
  });

  app.delete("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    await db.delete(taskCriteria).where(eq(taskCriteria.task_id, id));
    await db.delete(taskExamples).where(eq(taskExamples.task_id, id));
    await db.delete(taskInteractionExamples).where(eq(taskInteractionExamples.task_id, id));
    await db.delete(tasks).where(eq(tasks.id, id));
    return c.json({ status: "deleted" });
  });

  app.get("/api/v1/me", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me" });
    const [record] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    const settings = await getUserSettingsRow(user.id);
    log.info("User profile fetched", { userId: user.id });
    return c.json({
      id: user.id,
      email: user.email,
      display_name: record?.display_name ?? "Player",
      bio: record?.bio ?? null,
      created_at: record?.created_at ? new Date(record.created_at).toISOString() : null,
      hasOpenAiKey: Boolean(settings?.openai_key_ciphertext && settings?.openai_key_iv)
    });
  });

  app.put("/api/v1/me/profile", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me_profile_update" });
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
      bio: z
        .string()
        .trim()
        .max(160, "Bio is too long.")
        .optional()
        .nullable()
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.warn("Profile payload failed validation", { userId: user.id });
      return c.json({ error: "Invalid profile payload", details: parsed.error.flatten() }, 400);
    }
    const data = parsed.data;
    const normalizedBio = data.bio?.trim() || null;
    await db
      .update(users)
      .set({
        display_name: data.displayName,
        bio: normalizedBio
      })
      .where(eq(users.id, user.id));
    log.info("Profile updated", { userId: user.id });
    return c.json({ ok: true, display_name: data.displayName, bio: normalizedBio });
  });

  app.get("/api/v1/me/settings", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me_settings_get" });
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
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me_settings_update" });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      log.warn("Invalid JSON body for settings", { error: safeError(error) });
      return c.json({ error: "Invalid JSON body" }, 400);
    }
    const nullableUrl = z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.string().url().nullable().optional()
    );
    const schema = z.object({
      aiMode: z.enum(["local_prefer", "openai_only", "local_only"]),
      localAiBaseUrl: nullableUrl,
      localSttUrl: nullableUrl,
      localLlmUrl: nullableUrl,
      storeAudio: z.boolean()
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      log.warn("Settings payload failed validation", { userId: user.id });
      return c.json({ error: "Invalid settings payload", details: parsed.error.flatten() }, 400);
    }
    const data = parsed.data;
    const normalizedBase = normalizeUrl(data.localAiBaseUrl);
    const normalizedStt = normalizeUrl(data.localSttUrl);
    const normalizedLlm = normalizeUrl(data.localLlmUrl);
    const hasOverrides = Boolean(normalizedStt || normalizedLlm);
    const resolvedBase = normalizedBase ?? DEFAULT_LOCAL_BASE_URL;
    await db
      .update(userSettings)
      .set({
        ai_mode: data.aiMode,
        local_base_url: hasOverrides ? null : resolvedBase,
        local_stt_url: hasOverrides ? normalizedStt : null,
        local_llm_url: hasOverrides ? normalizedLlm : null,
        store_audio: data.storeAudio,
        updated_at: Date.now()
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
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me_openai_key_update" });
    const body = await c.req.json();
    const schema = z.object({
      openaiApiKey: z
        .string()
        .trim()
        .min(20)
        .refine((value) => value.startsWith("sk-"), { message: "Invalid OpenAI key" })
    });
    const data = schema.parse(body);
    if (!env.openaiKeyEncryptionSecret) {
      logServerError(
        "me.openai_key.update.missing_secret",
        new Error("OPENAI_KEY_ENCRYPTION_SECRET is not configured"),
        { requestId: c.get("requestId"), userId: user.id }
      );
      return c.json({ error: "OPENAI_KEY_ENCRYPTION_SECRET is not configured" }, 500);
    }
    const encrypted = await encryptOpenAiKey(env.openaiKeyEncryptionSecret, data.openaiApiKey);
    await db
      .update(userSettings)
      .set({
        openai_key_ciphertext: encrypted.ciphertextB64,
        openai_key_iv: encrypted.ivB64,
        openai_key_kid: encrypted.kid,
        updated_at: Date.now()
      })
      .where(eq(userSettings.user_id, user.id));
    log.info("OpenAI key updated", { userId: user.id });
    return c.json({ ok: true, hasOpenAiKey: true });
  });

  app.delete("/api/v1/me/openai-key", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me_openai_key_delete" });
    await db
      .update(userSettings)
      .set({
        openai_key_ciphertext: null,
        openai_key_iv: null,
        openai_key_kid: null,
        updated_at: Date.now()
      })
      .where(eq(userSettings.user_id, user.id));
    log.info("OpenAI key deleted", { userId: user.id });
    return c.json({ ok: true, hasOpenAiKey: false });
  });

  app.post("/api/v1/me/openai-key/validate", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "me_openai_key_validate" });
    if (!checkRateLimit(`openai-validate:${user.id}`)) {
      log.warn("OpenAI key validation rate limited", { userId: user.id });
      return c.json({ ok: false, error: "Too many validation attempts. Try again shortly." }, 429);
    }
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const provided = typeof body.openaiApiKey === "string" ? body.openaiApiKey.trim() : "";

    let keyToValidate = provided;

    if (!keyToValidate) {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.user_id, user.id))
        .limit(1);

      const record = rows[0];

      if (!record?.openai_key_ciphertext || !record?.openai_key_iv) {
        return c.json({ ok: false, error: "No key provided and no key stored." }, 400);
      }

      if (!env.openaiKeyEncryptionSecret) {
        logServerError(
          "me.openai_key.validate.missing_secret",
          new Error("OPENAI_KEY_ENCRYPTION_SECRET is not set."),
          { requestId: c.get("requestId"), userId: user.id }
        );
        return c.json(
          {
            ok: false,
            error: "Server misconfigured: OPENAI_KEY_ENCRYPTION_SECRET is not set."
          },
          500
        );
      }

      keyToValidate = await decryptOpenAiKey(env.openaiKeyEncryptionSecret, {
        ciphertextB64: record.openai_key_ciphertext,
        ivB64: record.openai_key_iv
      });
    }

    const result = await validateOpenAiApiKey(keyToValidate);
    if (result.ok) {
      log.info("OpenAI key validated", { userId: user.id });
    } else {
      log.warn("OpenAI key validation failed", { userId: user.id, error: result.error });
    }
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/api/v1/attempts", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "attempts_list", userId: user.id });
    const { task_id } = c.req.query();
    const filters = [eq(attempts.user_id, user.id)];
    if (task_id) {
      filters.push(eq(attempts.task_id, task_id));
    }
    const results = await db
      .select({
        id: attempts.id,
        completed_at: attempts.completed_at,
        overall_score: attempts.overall_score,
        overall_pass: attempts.overall_pass,
        session_id: attempts.session_id,
        task_id: attempts.task_id,
        task_title: tasks.title,
        example_id: attempts.example_id,
        example_difficulty: taskExamples.difficulty
      })
      .from(attempts)
      .innerJoin(tasks, eq(attempts.task_id, tasks.id))
      .innerJoin(taskExamples, eq(attempts.example_id, taskExamples.id))
      .where(filters.length > 1 ? and(...filters) : filters[0]);
    log.info("Attempts fetched", { count: results.length, taskId: task_id ?? null });
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
        completed_at: new Date(attempt.completed_at ?? Date.now()).toISOString()
      }))
    );
  });

  const runPracticeAttempt = async ({
    body,
    debugEnabled,
    logEvent,
    requestId,
    user
  }: {
    body: unknown;
    debugEnabled: boolean;
    logEvent: (level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => void;
    requestId: string;
    user: { id: string };
  }): Promise<{
    status: number;
    payload: Record<string, unknown>;
    attemptId?: string;
    overallScore?: number;
    overallPass?: boolean;
  }> => {
    const timings: Record<string, number> = {};
    const errors: Array<{ stage: "input" | "stt" | "scoring" | "db"; message: string }> = [];

    logEvent("info", "practice.run.start");

    const inputParseStart = Date.now();
    const parsedInput = practiceRunInputSchema.safeParse(body);
    if (!parsedInput.success) {
      logEvent("warn", "input.parse.error", {
        issues: parsedInput.error.flatten().fieldErrors
      });
      return {
        status: 400,
        payload: { requestId, errors: [{ stage: "input", message: "Invalid practice payload." }] }
      };
    }
    const input = parsedInput.data;
    if (!input.session_item_id && !(input.task_id && input.example_id)) {
      return {
        status: 400,
        payload: {
          requestId,
          errors: [
            { stage: "input", message: "Provide session_item_id or task_id + example_id." }
          ]
        }
      };
    }
    const transcriptOverride = input.transcript_text?.trim() ?? "";
    const usesProvidedTranscript = transcriptOverride.length > 0;
    const usesAudioInput = Boolean(input.audio);
    if (usesProvidedTranscript && !usesAudioInput && !input.attempt_id) {
      return {
        status: 400,
        payload: {
          requestId,
          errors: [{ stage: "input", message: "Provide attempt_id with transcript_text." }]
        }
      };
    }
    const audioLength = input.audio?.length ?? 0;
    const minAudioLength = 128;
    if (!usesProvidedTranscript) {
      if (!input.audio || audioLength < minAudioLength) {
        logEvent("warn", "input.parse.error", {
          reason: "audio_too_small",
          audio_length: audioLength
        });
        return {
          status: 400,
          payload: {
            requestId,
            errors: [{ stage: "input", message: "Audio is missing or too short to evaluate." }]
          }
        };
      }
    }
    timings.input_parse = Date.now() - inputParseStart;

    if (!checkRateLimit(`practice:${user.id}`)) {
      logEvent("warn", "practice.run.rate_limited");
      return {
        status: 429,
        payload: { requestId, errors: [{ stage: "input", message: "Too many practice requests." }] }
      };
    }

    logEvent("info", "auth.context.start");
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "auth.context.error");
      return {
        status: 404,
        payload: { requestId, errors: [{ stage: "input", message: "Settings not found." }] }
      };
    }

    let config: EffectiveAiConfig;
    try {
      config = await resolveEffectiveAiConfig({
        env,
        settings,
        decryptOpenAiKey
      });
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "auth.context.error", { reason: error.code, mode: settings.ai_mode });
        return {
          status: error.status,
          payload: {
            requestId,
            errors: [{ stage: "input", message: error.message }]
          }
        };
      }
      logServerError("practice.config.error", error as Error, { requestId, userId: user.id });
      return {
        status: 500,
        payload: { requestId, errors: [{ stage: "input", message: "AI configuration failed." }] }
      };
    }

    try {
      assertOpenAiKey(config);
      assertLocalBaseUrl(config);
    } catch (error) {
      if (isProviderConfigError(error)) {
        logEvent("warn", "auth.context.error", { reason: error.code, mode: settings.ai_mode });
        return {
          status: error.status,
          payload: {
            requestId,
            errors: [{ stage: "input", message: error.message }]
          }
        };
      }
      logServerError("practice.config.error", error as Error, { requestId, userId: user.id });
      return {
        status: 500,
        payload: { requestId, errors: [{ stage: "input", message: "AI configuration failed." }] }
      };
    }

    logEvent("info", "auth.context.ok", {
      mode: config.mode,
      store_audio: settings.store_audio ?? false,
      has_openai_key: Boolean(config.openai.apiKey),
      local_base_configured: Boolean(config.local.baseUrl),
      resolved_from: config.resolvedFrom
    });

    let taskId = input.task_id ?? null;
    let exampleId = input.example_id ?? null;
    let sessionId: string | null = null;
    let sessionItemId: string | null = null;

    if (input.session_item_id) {
      const [itemRow] = await db
        .select()
        .from(practiceSessionItems)
        .where(eq(practiceSessionItems.id, input.session_item_id))
        .limit(1);
      if (!itemRow) {
        return {
          status: 404,
          payload: { requestId, errors: [{ stage: "input", message: "Session item not found." }] }
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
        payload: { requestId, errors: [{ stage: "input", message: "Task or example missing." }] }
      };
    }

    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!taskRow) {
      return {
        status: 404,
        payload: { requestId, errors: [{ stage: "input", message: "Task not found." }] }
      };
    }
    const criteriaRows = await db
      .select()
      .from(taskCriteria)
      .where(eq(taskCriteria.task_id, taskId))
      .orderBy(taskCriteria.sort_order);
    const [exampleRow] = await db
      .select()
      .from(taskExamples)
      .where(eq(taskExamples.id, exampleId))
      .limit(1);
    if (!exampleRow) {
      return {
        status: 404,
        payload: { requestId, errors: [{ stage: "input", message: "Example not found." }] }
      };
    }

    const task = normalizeTask(taskRow);
    const criteria: TaskCriterion[] = criteriaRows.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      description: criterion.description,
      rubric: criterion.rubric ?? undefined
    }));
    const example: TaskExample = {
      id: exampleRow.id,
      task_id: exampleRow.task_id,
      difficulty: exampleRow.difficulty,
      severity_label: exampleRow.severity_label ?? null,
      patient_text: exampleRow.patient_text,
      meta: exampleRow.meta ?? null
    };

    const [existingAttempt] = await db
      .select({
        id: attempts.id,
        completed_at: attempts.completed_at,
        evaluation: attempts.evaluation,
        overall_score: attempts.overall_score,
        overall_pass: attempts.overall_pass,
        model_info: attempts.model_info
      })
      .from(attempts)
      .where(eq(attempts.id, input.attempt_id ?? "__missing__"))
      .limit(1);
    const existingModelInfo =
      existingAttempt?.model_info && typeof existingAttempt.model_info === "object"
        ? (existingAttempt.model_info as {
            provider?: {
              stt?: { kind?: "local" | "openai"; model?: string };
              llm?: { kind?: "local" | "openai"; model?: string } | null;
            };
            timing_ms?: { stt?: number; llm?: number; total?: number };
            practice?: { mode?: string; turn_context?: unknown };
          })
        : undefined;

    let sttProvider: SttProvider | null = null;
    let transcript: { text: string };
    let sttDuration: number | undefined;
    let sttMeta: { kind: "local" | "openai"; model: string };
    if (usesProvidedTranscript) {
      transcript = { text: transcriptOverride };
      sttMeta = existingModelInfo?.provider?.stt?.kind
        ? {
            kind: existingModelInfo.provider.stt.kind,
            model: existingModelInfo.provider.stt.model ?? "unknown"
          }
        : { kind: "local", model: "manual" };
      logEvent("info", "stt.transcribe.skipped", {
        reason: "provided_transcript",
        transcript_length: transcript.text?.length ?? 0
      });
    } else {
      logEvent("info", "stt.select.start", { mode: config.mode });
      try {
        const sttSelection = await selectSttProvider(config, logEvent);
        sttProvider = sttSelection.provider;
        sttMeta = { kind: sttProvider.kind, model: sttProvider.model ?? "unknown" };
        logEvent("info", "stt.select.ok", {
          selected: { kind: sttProvider.kind, model: sttProvider.model },
          health: sttSelection.health
        });
      } catch (error) {
        logEvent("error", "stt.select.error", { error: safeError(error) });
        return {
          status: 502,
          payload: {
            requestId,
            errors: [{ stage: "stt", message: (error as Error).message || "STT unavailable." }]
          }
        };
      }

      const sttStart = Date.now();
      logEvent("info", "stt.transcribe.start", {
        audio_length: audioLength,
        provider: sttMeta
      });
      try {
        transcript = await sttProvider.transcribe(input.audio ?? "", {
          mimeType: input.audio_mime
        });
      } catch (error) {
        const duration = Date.now() - sttStart;
        logEvent("error", "stt.transcribe.error", {
          duration_ms: duration,
          error: safeError(error)
        });
        return {
          status: 502,
          payload: {
            requestId,
            errors: [{ stage: "stt", message: "Transcription failed. Please try again." }]
          }
        };
      }
      sttDuration = Date.now() - sttStart;
      timings.stt = sttDuration;
      logEvent("info", "stt.transcribe.ok", {
        duration_ms: sttDuration,
        transcript_length: transcript.text?.length ?? 0,
        transcript_preview: debugEnabled ? safeTruncate(transcript.text ?? "", 60) : undefined
      });
    }

    const attemptId = input.attempt_id ?? nanoid();
    const skipScoring = Boolean(input.skip_scoring);
    let llmProvider;
    if (!skipScoring) {
      logEvent("info", "llm.select.start", { mode: config.mode });
      try {
        const llmSelection = await selectLlmProvider(config, logEvent);
        llmProvider = llmSelection.provider;
        logEvent("info", "llm.select.ok", {
          selected: { kind: llmProvider.kind, model: llmProvider.model },
          health: llmSelection.health
        });
      } catch (error) {
        logEvent("error", "llm.select.error", { error: safeError(error) });
        errors.push({
          stage: "scoring",
          message: (error as Error).message || "LLM unavailable."
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
        provider: { kind: llmProvider.kind, model: llmProvider.model }
      });
      try {
        evaluation = await llmProvider.evaluateDeliberatePractice({
          task: { ...task, criteria },
          example,
          attempt_id: attemptId,
          transcript
        });
      } catch (error) {
        logEvent("error", "llm.evaluate.error", { error: safeError(error) });
        errors.push({
          stage: "scoring",
          message: "Scoring failed. Check your AI provider settings and try again."
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
          ? { task_id: taskId, example_id: exampleId, attempt_id: attemptId, ...evaluation }
          : evaluation;
      let parsed = evaluationResultSchema.safeParse(normalizedEvaluation);
      if (!parsed.success) {
        const repaired = attemptJsonRepair(JSON.stringify(normalizedEvaluation));
        if (repaired) {
          parsed = evaluationResultSchema.safeParse(JSON.parse(repaired));
        }
      }
      if (!parsed.success) {
        logEvent("warn", "llm.evaluate.invalid", {
          attemptId,
          issues: parsed.error.errors.map((issue) => issue.message)
        });
        errors.push({
          stage: "scoring",
          message: "We could not score this response due to invalid evaluation output."
        });
      } else {
        scoringResult = parsed.data;
      }
    }

    let nextDifficulty: number | undefined;
    let overallScore = scoringResult?.overall.score ?? 0;
    let overallPass = scoringResult?.overall.pass ?? false;
    if (transcript) {
      logEvent("info", "db.attempt.insert.start", { attemptId });
      try {
        const sttTiming = usesProvidedTranscript ? existingModelInfo?.timing_ms?.stt : sttDuration;
        const llmTiming = llmDuration ?? existingModelInfo?.timing_ms?.llm;
        const modelInfo = {
          provider: {
            stt: sttMeta,
            llm: llmProvider
              ? { kind: llmProvider.kind, model: llmProvider.model ?? "unknown" }
              : existingModelInfo?.provider?.llm ?? null
          },
          timing_ms: {
            stt: sttTiming,
            llm: llmTiming,
            total: (sttTiming ?? 0) + (llmTiming ?? 0)
          },
          practice: input.practice_mode
            ? {
                mode: input.practice_mode,
                turn_context: input.turn_context ?? null
              }
            : existingModelInfo?.practice
        };
        const transcriptText = transcript.text ?? "";

        await db
          .insert(attempts)
          .values({
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
            model_info: modelInfo
          })
          .onConflictDoUpdate({
            target: attempts.id,
            set: {
              transcript: transcriptText,
              model_info: modelInfo
            }
          });

        const shouldPersistScoring = Boolean(scoringResult);
        let completedNow = false;
        if (shouldPersistScoring) {
          const completionUpdate = await db
            .update(attempts)
            .set({
              completed_at: Date.now(),
              evaluation: scoringResult,
              overall_pass: overallPass,
              overall_score: overallScore,
              model_info: modelInfo
            })
            .where(and(eq(attempts.id, attemptId), isNull(attempts.completed_at)));
          const completionChanges =
            completionUpdate && typeof completionUpdate === "object"
              ? typeof (completionUpdate as { changes?: number }).changes === "number"
                ? (completionUpdate as { changes: number }).changes
                : typeof (completionUpdate as { meta?: { changes?: number } }).meta?.changes === "number"
                  ? (completionUpdate as { meta: { changes: number } }).meta.changes
                  : 0
              : 0;
          completedNow = completionChanges > 0;
        }

        if (completedNow) {
          const existingProgress = await ensureUserTaskProgress(user.id, task);
          let updatedDifficulty = existingProgress.current_difficulty;
          let nextStreak = existingProgress.streak;
          if (overallPass && overallScore >= 3.2) {
            updatedDifficulty = Math.min(5, updatedDifficulty + 1);
            nextStreak += 1;
          } else if (!overallPass || overallScore < 2.4) {
            updatedDifficulty = Math.max(1, updatedDifficulty - 1);
            nextStreak = 0;
          }
          nextDifficulty = updatedDifficulty;

          await db
            .update(userTaskProgress)
            .set({
              current_difficulty: updatedDifficulty,
              last_overall_score: overallScore,
              last_pass: overallPass,
              streak: nextStreak,
              attempt_count: existingProgress.attempt_count + 1,
              updated_at: Date.now()
            })
            .where(
              and(
                eq(userTaskProgress.user_id, user.id),
                eq(userTaskProgress.task_id, taskId)
              )
            );
        }

        logEvent("info", "db.attempt.insert.ok", { attemptId });
      } catch (error) {
        logEvent("error", "db.attempt.insert.error", { error: safeError(error) });
        errors.push({
          stage: "db",
          message: "We couldn't save this attempt. Please try again."
        });
      }
    }

    const responseSttDuration = sttDuration ?? existingModelInfo?.timing_ms?.stt ?? 0;
    const response = {
      requestId,
      attemptId,
      next_recommended_difficulty: nextDifficulty,
      transcript: transcript
        ? {
            text: transcript.text,
            provider: sttMeta,
            duration_ms: responseSttDuration
          }
        : undefined,
      scoring: scoringResult
        ? {
            evaluation: scoringResult,
            provider: llmProvider
              ? { kind: llmProvider.kind, model: llmProvider.model ?? "unknown" }
              : { kind: "openai", model: "unknown" },
            duration_ms: llmDuration ?? 0
          }
        : undefined,
      errors: errors.length ? errors : undefined,
      debug: debugEnabled
        ? {
            timings,
            selectedProviders: {
              stt: sttMeta,
              llm: llmProvider
                ? { kind: llmProvider.kind, model: llmProvider.model ?? "unknown" }
                : null
            }
          }
        : undefined
    };

    if (errors.length) {
      logEvent("warn", "practice.run.error", {
        attemptId,
        error_count: errors.length
      });
    } else {
      logEvent("info", "practice.run.ok", {
        attemptId,
        total_duration_ms: responseSttDuration + (llmDuration ?? 0)
      });
    }

    return {
      status: 200,
      payload: response,
      attemptId,
      overallScore,
      overallPass
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
        delaySeverity = Math.min(1, Math.max(0, 1 - timing.response_delay_ms / minDelayMs));
      }
    }
    if (timing.max_response_duration_seconds && timing.response_duration_ms != null) {
      const maxDurationMs = timing.max_response_duration_seconds * 1000;
      if (timing.response_duration_ms > maxDurationMs) {
        durationSeverity = Math.min(
          1,
          Math.max(0, (timing.response_duration_ms - maxDurationMs) / maxDurationMs)
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
      task_selection: z.record(z.unknown()),
      settings: z
        .object({
          rounds_per_player: z.number().optional(),
          response_timer_enabled: z.boolean().optional(),
          response_timer_seconds: z.number().optional(),
          max_response_duration_enabled: z.boolean().optional(),
          max_response_duration_seconds: z.number().optional()
        })
        .passthrough()
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid session payload." }, 400);
    }
    const sessionId = generateUuid();
    const now = Date.now();
    await db.insert(minigameSessions).values({
      id: sessionId,
      user_id: user.id,
      game_type: parsed.data.game_type,
      visibility_mode: parsed.data.visibility_mode,
      task_selection: parsed.data.task_selection,
      settings: parsed.data.settings,
      created_at: now,
      ended_at: null,
      last_active_at: now
    });
    return c.json({ session_id: sessionId });
  });

  app.get("/api/v1/minigames/sessions", async (c) => {
    const user = c.get("user");
    const status = c.req.query("status") as "active" | "ended" | "all" | undefined;
    const sort = c.req.query("sort") as "newest" | "oldest" | "recently_active" | undefined;
    const sessions = await listMinigameSessions(db, { userId: user.id, status, sort });
    return c.json({ sessions });
  });

  const fetchMinigameSessionState = async (sessionId: string, userId: string) => {
    const [session] = await db
      .select()
      .from(minigameSessions)
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, userId),
          isNull(minigameSessions.deleted_at)
        )
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
        patient_text: taskExamples.patient_text
      })
      .from(minigameRounds)
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
        evaluation: attempts.evaluation
      })
      .from(minigameRoundResults)
      .leftJoin(attempts, eq(minigameRoundResults.attempt_id, attempts.id))
      .leftJoin(minigameRounds, eq(minigameRoundResults.round_id, minigameRounds.id))
      .where(eq(minigameRounds.session_id, sessionId));

    return {
      session,
      teams,
      players,
      rounds,
      results
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
      last_active_at: z.number().nullable().optional()
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid resume payload." }, 400);
    }
    const updated = await updateMinigameResume(db, {
      userId: user.id,
      sessionId,
      currentRoundId: parsed.data.current_round_id,
      currentPlayerId: parsed.data.current_player_id,
      lastActiveAt: parsed.data.last_active_at
    });
    if (!updated) {
      return c.json({ error: "Session not found." }, 404);
    }
    return c.json({ ok: true });
  });

  app.delete("/api/v1/minigames/sessions/:id", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const deleted = await softDeleteMinigameSession(db, { userId: user.id, sessionId });
    if (!deleted) {
      return c.json({ error: "Session not found." }, 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/v1/minigames/sessions/:id/end", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const now = Date.now();
    await db
      .update(minigameSessions)
      .set({ ended_at: now, last_active_at: now })
      .where(
        and(
          eq(minigameSessions.id, sessionId),
          eq(minigameSessions.user_id, user.id),
          isNull(minigameSessions.deleted_at)
        )
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
          isNull(minigameSessions.deleted_at)
        )
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    const schema = z.object({
      teams: z
        .array(
          z.object({
            name: z.string(),
            color: z.string()
          })
        )
        .min(1)
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid teams payload." }, 400);
    }
    const rows = parsed.data.teams.map((team) => ({
      id: generateUuid(),
      session_id: sessionId,
      name: team.name,
      color: team.color,
      created_at: Date.now()
    }));
    await db.insert(minigameTeams).values(rows);
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
          isNull(minigameSessions.deleted_at)
        )
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    const schema = z.object({
      players: z
        .array(
          z.object({
            name: z.string(),
            avatar: z.string(),
            team_id: z.string().nullable().optional()
          })
        )
        .min(1)
    });
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid players payload." }, 400);
    }
    const rows = parsed.data.players.map((player) => ({
      id: generateUuid(),
      session_id: sessionId,
      name: player.name,
      avatar: player.avatar,
      team_id: player.team_id ?? null,
      created_at: Date.now()
    }));
    await db.insert(minigamePlayers).values(rows);
    return c.json({ players: rows });
  });

  app.post("/api/v1/minigames/sessions/:id/rounds/generate", async (c) => {
    const user = c.get("user");
    const sessionId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
      count: z.number().int().positive().optional()
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
          isNull(minigameSessions.deleted_at)
        )
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }

    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { sessionId, ...fields });
    try {
      const result = await generateMinigameRounds({
        db,
        session,
        count: parsed.data.count,
        logEvent
      });
      return c.json({ round_count: result.roundCount });
    } catch (error) {
      if (error instanceof NoUniquePatientStatementsLeftError) {
        return c.json(
          {
            error: error.message,
            code: NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
            metadata: error.metadata
          },
          409
        );
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
          isNull(minigameSessions.deleted_at)
        )
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
          or(eq(minigameRounds.status, "pending"), eq(minigameRounds.status, "active"))
        )
      )
      .orderBy(minigameRounds.position)
      .limit(1);
    if (pendingRound) {
      await db
        .update(minigameRounds)
        .set({ status: "completed", completed_at: Date.now() })
        .where(eq(minigameRounds.id, pendingRound.id));
    }

    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { sessionId, ...fields });
    try {
      const result = await redrawMinigameRound({ db, session, logEvent });
      return c.json({ round_count: result.roundCount });
    } catch (error) {
      if (error instanceof NoUniquePatientStatementsLeftError) {
        return c.json(
          {
            error: error.message,
            code: NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
            metadata: error.metadata
          },
          409
        );
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

  app.post("/api/v1/minigames/sessions/:id/rounds/:roundId/start", async (c) => {
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
          isNull(minigameSessions.deleted_at)
        )
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    await db
      .update(minigameRounds)
      .set({ status: "active", started_at: Date.now() })
      .where(and(eq(minigameRounds.id, roundId), eq(minigameRounds.session_id, sessionId)));
    return c.json({ ok: true });
  });

  app.post("/api/v1/minigames/sessions/:id/rounds/:roundId/submit", async (c) => {
    const user = c.get("user");
    const requestId = c.get("requestId");
    const sessionId = c.req.param("id");
    const roundId = c.req.param("roundId");
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, userId: user?.id ?? null, ...fields });
    const schema = z
      .object({
        player_id: z.string(),
        audio_base64: z.string().optional(),
        audio_mime: z.string().optional(),
        transcript_text: z.string().optional(),
        attempt_id: z.string().optional(),
        skip_scoring: z.boolean().optional(),
        mode: z.enum(["local_prefer", "openai_only", "local_only"]).optional(),
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
                max_response_duration_seconds: z.number().optional()
              })
              .optional()
          })
          .optional()
      })
      .superRefine((data, ctx) => {
        if (!data.audio_base64 && !data.transcript_text) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Provide audio_base64 or transcript_text."
          });
        }
      });
    const body = await c.req.json().catch(() => null);
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
          isNull(minigameSessions.deleted_at)
        )
      )
      .limit(1);
    if (!session) {
      return c.json({ error: "Session not found." }, 404);
    }
    const [round] = await db
      .select()
      .from(minigameRounds)
      .where(and(eq(minigameRounds.id, roundId), eq(minigameRounds.session_id, sessionId)))
      .limit(1);
    if (!round) {
      return c.json({ error: "Round not found." }, 404);
    }

    const runResult = await runPracticeAttempt({
      body: {
        task_id: round.task_id,
        example_id: round.example_id,
        audio: parsed.data.audio_base64,
        audio_mime: parsed.data.audio_mime,
        transcript_text: parsed.data.transcript_text,
        attempt_id: parsed.data.attempt_id,
        skip_scoring: parsed.data.skip_scoring,
        mode: parsed.data.mode,
        practice_mode: parsed.data.practice_mode,
        turn_context: parsed.data.turn_context
      },
      debugEnabled: env.environment === "development",
      logEvent,
      requestId,
      user
    });

    if (runResult.status !== 200 || !runResult.attemptId) {
      return c.json(runResult.payload, runResult.status);
    }

    if (parsed.data.skip_scoring) {
      return c.json(runResult.payload, runResult.status);
    }

    const timingPenalty = calculateTimingPenalty(parsed.data.turn_context?.timing);
    const adjustedScore = Math.max(0, (runResult.overallScore ?? 0) - timingPenalty);

    await db.insert(minigameRoundResults).values({
      id: generateUuid(),
      round_id: roundId,
      player_id: parsed.data.player_id,
      attempt_id: runResult.attemptId,
      overall_score: adjustedScore,
      overall_pass: runResult.overallPass ?? false,
      created_at: Date.now()
    });
    if (!round.player_b_id) {
      await db
        .update(minigameRounds)
        .set({ status: "completed", completed_at: Date.now() })
        .where(eq(minigameRounds.id, roundId));
    } else {
      const [resultCount] = await db
        .select({ count: count(minigameRoundResults.id) })
        .from(minigameRoundResults)
        .where(eq(minigameRoundResults.round_id, roundId));
      if ((resultCount?.count ?? 0) >= 2) {
        await db
          .update(minigameRounds)
          .set({ status: "completed", completed_at: Date.now() })
          .where(eq(minigameRounds.id, roundId));
      }
    }

    return c.json({
      ...runResult.payload,
      timing_penalty: timingPenalty,
      adjusted_score: adjustedScore
    });
  });

  app.post("/api/v1/practice/run", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, userId: user?.id ?? null, ...fields });
    const debugEnabled = env.environment === "development" || c.req.query("debug") === "true";

    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      logEvent("error", "input.parse.error", { error: safeError(error) });
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Invalid JSON body." }] },
        400
      );
    }

    const result = await runPracticeAttempt({
      body,
      debugEnabled,
      logEvent,
      requestId,
      user
    });

    return c.json(result.payload, result.status);
  });

  return app;
};
