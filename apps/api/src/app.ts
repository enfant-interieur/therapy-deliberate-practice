import { Hono, type Context } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  attempts,
  practiceSessionItems,
  practiceSessions,
  taskCriteria,
  taskExamples,
  tasks,
  ttsAssets,
  userSettings,
  userTaskProgress,
  users
} from "./db/schema";
import { and, eq, like, or } from "drizzle-orm";
import {
  deliberatePracticeTaskV2Schema,
  evaluationResultSchema,
  practiceRunInputSchema,
  taskCriterionSchema,
  taskExampleSchema,
  taskSchema,
  type Task,
  type TaskCriterion,
  type TaskExample
} from "@deliberate/shared";
import { selectLlmProvider, selectSttProvider } from "./providers";
import { attemptJsonRepair } from "./utils/jsonRepair";
import type { ProviderMode, RuntimeEnv } from "./env";
import type { ApiDatabase } from "./db/types";
import { createAdminAuth, resolveAdminStatus } from "./middleware/adminAuth";
import { createUserAuth } from "./middleware/userAuth";
import { decryptOpenAiKey, encryptOpenAiKey } from "./utils/crypto";
import { createLogger, log, makeRequestId, safeError, safeTruncate } from "./utils/logger";
import { OpenAITtsProvider } from "./providers/tts";
import { OPENAI_TTS_FORMAT, OPENAI_TTS_MODEL } from "./providers/models";
import { getOrCreateTtsAsset, type TtsStorage } from "./services/ttsService";

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

  const normalizeSettings = (settings: typeof userSettings.$inferSelect) => ({
    aiMode: settings.ai_mode,
    localSttUrl: settings.local_stt_url ?? env.localSttUrl,
    localLlmUrl: settings.local_llm_url ?? env.localLlmUrl,
    storeAudio: settings.store_audio ?? false,
    hasOpenAiKey: Boolean(settings.openai_key_ciphertext && settings.openai_key_iv)
  });

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

  app.get("/api/v1/health/local-ai", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "health_local_ai" });
    const stt = await selectSttProvider("local_only", env, env.openaiApiKey).then(
      () => true,
      () => false
    );
    const llm = await selectLlmProvider("local_only", env, env.openaiApiKey).then(
      () => true,
      () => false
    );
    log.info("Local AI health check completed", { stt, llm });
    return c.json({ stt, llm });
  });

  app.get("/api/v1/tasks", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "tasks_list" });
    const { q, tag, skill_domain, published } = c.req.query();
    const filters = [];
    if (q) {
      filters.push(or(like(tasks.title, `%${q}%`), like(tasks.description, `%${q}%`)));
    }
    if (tag) {
      filters.push(like(tasks.tags, `%"${tag}"%`));
    }
    if (skill_domain) {
      filters.push(eq(tasks.skill_domain, skill_domain));
    }
    if (published === "1") {
      filters.push(eq(tasks.is_published, true));
    }
    const baseQuery = db.select().from(tasks);
    const results = filters.length ? await baseQuery.where(and(...filters)) : await baseQuery;
    log.info("Tasks fetched", { count: results.length });
    return c.json(results.map((task) => normalizeTask(task)));
  });

  app.get("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
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
    const counts = exampleRows.reduce<Record<number, number>>((acc, example) => {
      acc[example.difficulty] = (acc[example.difficulty] ?? 0) + 1;
      return acc;
    }, {});
    log.info("Task detail fetched", { criteria: criteriaRows.length, examples: exampleRows.length });
    return c.json({
      ...normalizeTask(taskRow),
      criteria: criteriaRows.map((criterion) => ({
        id: criterion.id,
        label: criterion.label,
        description: criterion.description,
        rubric: criterion.rubric ?? undefined
      })),
      example_counts: counts
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
      const picked = pickExamplesForDifficulty(
        examples.map((example) => ({
          ...example,
          meta: example.meta ?? null
        })),
        targetDifficulty,
        data.item_count
      );
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
        const picked = pickExamplesForDifficulty(
          examples.map((example) => ({
            ...example,
            meta: example.meta ?? null
          })),
          targetDifficulty,
          1
        );
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

  app.get("/api/v1/admin/whoami", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_whoami" });
    const result = await resolveAdminStatus(env, c.req.raw.headers);
    if (!result.ok) {
      log.warn("Admin whoami failed", { status: result.status });
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
  app.use("/api/v1/practice/*", userAuth);
  app.use("/api/v1/sessions/*", userAuth);
  app.use("/api/v1/tts/*", userAuth);

  const ttsConfigReady = Boolean(env.r2Bucket);

  const handleTtsRequest = async (c: Context) => {
    const requestId = c.get("requestId");
    const cacheKey = c.req.param("cacheKey");
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, cache_key: cacheKey, ...fields });

    if (!ttsConfigReady) {
      logEvent("error", "tts.config.missing");
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
        "Cache-Control": "private, max-age=31536000, immutable"
      };
      if (object.etag) {
        headers.ETag = object.etag;
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
      logEvent("error", "tts.config.missing");
      return c.json({ error: "TTS storage is not configured." }, 500);
    }
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "tts.prefetch.settings_missing");
      return c.json({ error: "Settings not found." }, 404);
    }

    let openaiApiKey = env.openaiApiKey;
    if (settings.openai_key_ciphertext && settings.openai_key_iv) {
      if (!env.openaiKeyEncryptionSecret) {
        logEvent("error", "tts.prefetch.encryption_secret_missing");
        return c.json({ error: "OPENAI_KEY_ENCRYPTION_SECRET is not configured." }, 500);
      }
      openaiApiKey = await decryptOpenAiKey(env.openaiKeyEncryptionSecret, {
        ciphertextB64: settings.openai_key_ciphertext,
        ivB64: settings.openai_key_iv
      });
    }

    if (!openaiApiKey) {
      logEvent("warn", "tts.openai_key_missing");
      return c.json(
        { error: "OpenAI API key is required to generate patient audio." },
        400
      );
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

    const ttsProvider = OpenAITtsProvider(
      {
        apiKey: openaiApiKey,
        model: OPENAI_TTS_MODEL,
        voice: "alloy",
        format: OPENAI_TTS_FORMAT
      },
      logEvent
    );

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

  app.post("/api/v1/admin/parse-task", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_parse_task" });
    const body = await c.req.json();
    const schema = z.object({
      free_text: z.string().optional().default(""),
      source_url: z.string().nullable().optional()
    });
    const data = schema.parse(body);
    log.info("Parse task request received", {
      hasSourceUrl: Boolean(data.source_url),
      hasFreeText: Boolean(data.free_text?.trim())
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
    if (!env.openaiApiKey) {
      log.error("OpenAI key missing for parse task");
      return c.json({ error: "OpenAI key missing" }, 500);
    }
    let llmProvider;
    try {
      const selection = await selectLlmProvider("openai_only", env, env.openaiApiKey);
      llmProvider = selection.provider;
    } catch (error) {
      log.error("LLM provider selection failed", { error: safeError(error) });
      return c.json({ error: "OpenAI LLM unavailable" }, 500);
    }

    let parsed;
    try {
      parsed = await llmProvider.parseExercise({ sourceText });
    } catch (error) {
      log.error("LLM parse failed", { error: safeError(error) });
      return c.json({ error: "OpenAI parse failed" }, 500);
    }

    const validated = deliberatePracticeTaskV2Schema.safeParse(parsed);
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
          is_published: data.task_overrides?.is_published ?? existing.is_published,
          updated_at: now
        })
        .where(eq(tasks.id, existing.id));

      await db.delete(taskCriteria).where(eq(taskCriteria.task_id, existing.id));
      await db.delete(taskExamples).where(eq(taskExamples.task_id, existing.id));

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
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
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
        meta: example.meta ?? null,
        created_at: now,
        updated_at: now
      }))
    );
    log.info("Task imported (created)", { taskId, slug });
    return c.json({ id: taskId, slug });
  });

  app.get("/api/v1/admin/tasks", async (c) => {
    const rows = await db.select().from(tasks);
    return c.json(rows.map((row) => normalizeTask(row)));
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
      }))
    });
  });

  app.put("/api/v1/admin/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const parsed = taskSchema
      .extend({
        criteria: z.array(taskCriterionSchema).optional(),
        examples: z.array(taskExampleSchema).optional()
      })
      .parse(body);
    const now = Date.now();
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
          meta: example.meta ?? null,
          created_at: now,
          updated_at: now
        }))
      );
    }

    return c.json({ status: "updated" });
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
      created_at: record?.created_at ? new Date(record.created_at).toISOString() : null,
      hasOpenAiKey: Boolean(settings?.openai_key_ciphertext && settings?.openai_key_iv)
    });
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
    const normalizeUrl = (value?: string | null) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    };
    await db
      .update(userSettings)
      .set({
        ai_mode: data.aiMode,
        local_stt_url: normalizeUrl(data.localSttUrl),
        local_llm_url: normalizeUrl(data.localLlmUrl),
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
      log.error("Missing OpenAI encryption secret", { userId: user.id });
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
        overall_score: attempt.overall_score,
        overall_pass: attempt.overall_pass,
        completed_at: new Date(attempt.completed_at ?? Date.now()).toISOString()
      }))
    );
  });

  app.post("/api/v1/practice/run", async (c) => {
    const requestId = c.get("requestId");
    const user = c.get("user");
    const logEvent = (level: "debug" | "info" | "warn" | "error", event: string, fields = {}) =>
      log(level, event, { requestId, userId: user?.id ?? null, ...fields });
    const debugEnabled = env.environment === "development" || c.req.query("debug") === "true";
    const timings: Record<string, number> = {};
    const errors: Array<{ stage: "input" | "stt" | "scoring" | "db"; message: string }> = [];

    logEvent("info", "practice.run.start");

    const inputParseStart = Date.now();
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
    const parsedInput = practiceRunInputSchema.safeParse(body);
    if (!parsedInput.success) {
      logEvent("warn", "input.parse.error", {
        issues: parsedInput.error.flatten().fieldErrors
      });
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Invalid practice payload." }] },
        400
      );
    }
    const input = parsedInput.data;
    if (!input.session_item_id && !(input.task_id && input.example_id)) {
      return c.json(
        {
          requestId,
          errors: [
            { stage: "input", message: "Provide session_item_id or task_id + example_id." }
          ]
        },
        400
      );
    }
    const audioLength = input.audio?.length ?? 0;
    const minAudioLength = 128;
    if (!input.audio || audioLength < minAudioLength) {
      logEvent("warn", "input.parse.error", {
        reason: "audio_too_small",
        audio_length: audioLength
      });
      return c.json(
        {
          requestId,
          errors: [{ stage: "input", message: "Audio is missing or too short to evaluate." }]
        },
        400
      );
    }
    timings.input_parse = Date.now() - inputParseStart;

    if (!checkRateLimit(`practice:${user.id}`)) {
      logEvent("warn", "practice.run.rate_limited");
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Too many practice requests." }] },
        429
      );
    }

    logEvent("info", "auth.context.start");
    const settings = await getUserSettingsRow(user.id);
    if (!settings) {
      logEvent("warn", "auth.context.error");
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Settings not found." }] },
        404
      );
    }

    const mode = (settings.ai_mode ?? env.aiMode) as ProviderMode;
    const envWithOverrides = {
      ...env,
      localSttUrl: settings.local_stt_url ?? env.localSttUrl,
      localLlmUrl: settings.local_llm_url ?? env.localLlmUrl
    };

    let openaiApiKey = env.openaiApiKey;
    if (settings.openai_key_ciphertext && settings.openai_key_iv) {
      if (!env.openaiKeyEncryptionSecret) {
        return c.json(
          {
            requestId,
            errors: [
              { stage: "input", message: "OPENAI_KEY_ENCRYPTION_SECRET is not configured." }
            ]
          },
          500
        );
      }
      openaiApiKey = await decryptOpenAiKey(env.openaiKeyEncryptionSecret, {
        ciphertextB64: settings.openai_key_ciphertext,
        ivB64: settings.openai_key_iv
      });
    }

    logEvent("info", "auth.context.ok", {
      mode,
      store_audio: settings.store_audio ?? false,
      has_openai_key: Boolean(openaiApiKey),
      local_stt_configured: Boolean(envWithOverrides.localSttUrl),
      local_llm_configured: Boolean(envWithOverrides.localLlmUrl)
    });

    if (mode === "openai_only" && !openaiApiKey) {
      logEvent("warn", "auth.context.error", { reason: "openai_key_missing", mode });
      return c.json(
        {
          requestId,
          errors: [
            {
              stage: "input",
              message: "OpenAI mode requires an API key. Add one in Settings to continue."
            }
          ]
        },
        400
      );
    }

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
        return c.json({ requestId, errors: [{ stage: "input", message: "Session item not found." }] }, 404);
      }
      sessionItemId = itemRow.id;
      sessionId = itemRow.session_id;
      taskId = itemRow.task_id;
      exampleId = itemRow.example_id;
    }

    if (!taskId || !exampleId) {
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Task or example missing." }] },
        400
      );
    }

    const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!taskRow) {
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Task not found." }] },
        404
      );
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
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Example not found." }] },
        404
      );
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

    let sttProvider;
    logEvent("info", "stt.select.start", { mode });
    try {
      const sttSelection = await selectSttProvider(mode, envWithOverrides, openaiApiKey, logEvent);
      sttProvider = sttSelection.provider;
      logEvent("info", "stt.select.ok", {
        selected: { kind: sttProvider.kind, model: sttProvider.model },
        health: sttSelection.health
      });
    } catch (error) {
      logEvent("error", "stt.select.error", { error: safeError(error) });
      return c.json(
        {
          requestId,
          errors: [{ stage: "stt", message: (error as Error).message || "STT unavailable." }]
        },
        502
      );
    }

    const sttStart = Date.now();
    logEvent("info", "stt.transcribe.start", {
      audio_length: audioLength,
      provider: { kind: sttProvider.kind, model: sttProvider.model }
    });
    let transcript: { text: string };
    try {
      transcript = await sttProvider.transcribe(input.audio);
    } catch (error) {
      const duration = Date.now() - sttStart;
      logEvent("error", "stt.transcribe.error", {
        duration_ms: duration,
        error: safeError(error)
      });
      return c.json(
        {
          requestId,
          errors: [{ stage: "stt", message: "Transcription failed. Please try again." }]
        },
        502
      );
    }
    const sttDuration = Date.now() - sttStart;
    timings.stt = sttDuration;
    logEvent("info", "stt.transcribe.ok", {
      duration_ms: sttDuration,
      transcript_length: transcript.text?.length ?? 0,
      transcript_preview: debugEnabled ? safeTruncate(transcript.text ?? "", 60) : undefined
    });

    const attemptId = input.attempt_id ?? nanoid();
    let llmProvider;
    logEvent("info", "llm.select.start", { mode });
    try {
      const llmSelection = await selectLlmProvider(mode, envWithOverrides, openaiApiKey, logEvent);
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
    if (transcript) {
      logEvent("info", "db.attempt.insert.start", { attemptId });
      try {
        const modelInfo = {
          provider: {
            stt: { kind: sttProvider.kind, model: sttProvider.model },
            llm: llmProvider ? { kind: llmProvider.kind, model: llmProvider.model } : null
          },
          timing_ms: {
            stt: sttDuration,
            llm: llmDuration,
            total: sttDuration + (llmDuration ?? 0)
          },
          practice: input.practice_mode
            ? {
                mode: input.practice_mode,
                turn_context: input.turn_context ?? null
              }
            : undefined
        };
        const evaluationPayload = scoringResult ?? {};
        const overallScore = scoringResult?.overall.score ?? 0;
        const overallPass = scoringResult?.overall.pass ?? false;
        const transcriptText = transcript.text ?? "";

        await db.insert(attempts).values({
          id: attemptId,
          user_id: user.id,
          session_id: sessionId,
          session_item_id: sessionItemId,
          task_id: taskId,
          example_id: exampleId,
          started_at: Date.now(),
          completed_at: Date.now(),
          audio_ref: null,
          transcript: transcriptText,
          evaluation: evaluationPayload,
          overall_pass: overallPass,
          overall_score: overallScore,
          model_info: modelInfo
        });

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

        logEvent("info", "db.attempt.insert.ok", { attemptId });
      } catch (error) {
        logEvent("error", "db.attempt.insert.error", { error: safeError(error) });
        errors.push({
          stage: "db",
          message: "We couldn't save this attempt. Please try again."
        });
      }
    }

    const response = {
      requestId,
      attemptId,
      next_recommended_difficulty: nextDifficulty,
      transcript: transcript
        ? {
            text: transcript.text,
            provider: { kind: sttProvider.kind, model: sttProvider.model },
            duration_ms: sttDuration
          }
        : undefined,
      scoring: scoringResult
        ? {
            evaluation: scoringResult,
            provider: llmProvider
              ? { kind: llmProvider.kind, model: llmProvider.model }
              : { kind: "openai", model: "unknown" },
            duration_ms: llmDuration ?? 0
          }
        : undefined,
      errors: errors.length ? errors : undefined,
      debug: debugEnabled
        ? {
            timings,
            selectedProviders: {
              stt: { kind: sttProvider.kind, model: sttProvider.model },
              llm: llmProvider ? { kind: llmProvider.kind, model: llmProvider.model } : null
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
        total_duration_ms: sttDuration + (llmDuration ?? 0)
      });
    }

    return c.json(response);
  });

  return app;
};
