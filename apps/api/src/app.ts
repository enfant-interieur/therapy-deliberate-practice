import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { exercises, attempts, users, userSettings } from "./db/schema";
import { and, eq } from "drizzle-orm";
import {
  evaluationResultSchema,
  practiceRunInputSchema,
  exerciseSchema,
  deliberatePracticeTaskV2Schema,
  type DeliberatePracticeTaskV2,
  type ExerciseContentV2,
  type Objective
} from "@deliberate/shared";
import { selectLlmProvider, selectSttProvider } from "./providers";
import { attemptJsonRepair } from "./utils/jsonRepair";
import type { ProviderMode, RuntimeEnv } from "./env";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { createAdminAuth, resolveAdminStatus } from "./middleware/adminAuth";
import { createUserAuth } from "./middleware/userAuth";
import { decryptOpenAiKey, encryptOpenAiKey } from "./utils/crypto";
import { createLogger, log, makeRequestId, safeError, safeTruncate } from "./utils/logger";

export type ApiDatabase = DrizzleD1Database | BetterSQLite3Database;

export type ApiDependencies = {
  env: RuntimeEnv;
  db: ApiDatabase;
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

const defaultRubric = () => ({
  score_min: 0,
  score_max: 4,
  anchors: [
    { score: 0, meaning: "Missed the target behavior." },
    { score: 2, meaning: "Partially demonstrated the behavior." },
    { score: 4, meaning: "Clearly demonstrated the behavior." }
  ]
});

const llmParseSchema = z.object({
  version: z.literal("2.0"),
  task: z.object({
    name: z.string(),
    short_name: z.string(),
    skill_domain: z.string(),
    skill_difficulty_label: z.enum(["beginner", "intermediate", "advanced"]).nullable(),
    skill_difficulty_numeric: z.number().min(1).max(5),
    description: z.string(),
    objective_overview: z.string(),
    preparations: z.array(z.string()),
    source: z.object({
      citation_text: z.string().nullable(),
      source_url: z.string().nullable()
    }),
    expected_therapist_response: z.object({
      must_do: z.array(z.string()),
      should_do: z.array(z.string()),
      must_avoid: z.array(z.string()),
      style_constraints: z.array(z.string())
    }),
    criteria: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        behavioral_markers: z.array(z.string()),
        common_mistakes: z.array(z.string()),
        what_counts_as_evidence: z.array(z.string()),
        weight: z.number().nullable()
      })
    ),
    objectives: z.array(
      z.object({
        id: z.string(),
        criterion_ids: z.array(z.string()),
        label: z.string(),
        description: z.string(),
        rubric: z.object({
          score_min: z.literal(0),
          score_max: z.literal(4),
          anchors: z.array(
            z.object({
              score: z.union([
                z.literal(0),
                z.literal(1),
                z.literal(2),
                z.literal(3),
                z.literal(4)
              ]),
              meaning: z.string()
            })
          )
        })
      })
    ),
    practice_instructions: z.object({
      timebox_minutes: z.number().nullable(),
      steps: z.array(z.string()),
      feedback_process: z.array(z.string()),
      difficulty_adjustment_rule: z.string().nullable(),
      role_switching: z.string().nullable()
    }),
    roleplay_sets: z.array(
      z.object({
        difficulty_label: z.enum(["beginner", "intermediate", "advanced"]),
        difficulty_numeric: z.number().min(1).max(5),
        client_statements: z.array(
          z.object({
            id: z.string(),
            title: z.string().nullable(),
            affect_tag: z.string().nullable(),
            text: z.string(),
            primary_themes: z.array(z.string()),
            linked_criterion_ids: z.array(z.string()),
            extracted_cue_ids: z.array(z.string())
          })
        )
      })
    ),
    example_dialogues: z.array(
      z.object({
        id: z.string(),
        difficulty_label: z.enum(["beginner", "intermediate", "advanced"]).nullable(),
        client_turn: z.string(),
        therapist_turn: z.string(),
        criterion_callouts: z.array(
          z.object({
            criterion_id: z.string(),
            evidence_in_therapist_turn: z.string()
          })
        )
      })
    ),
    patient_cues: z.array(
      z.object({
        id: z.string(),
        difficulty: z.number().min(1).max(5),
        label: z.string(),
        evidence_quote: z.string(),
        why_it_matters: z.string(),
        therapist_response_hint: z.string(),
        difficulty_reason: z.string(),
        applies_to_statement_ids: z.array(z.string())
      })
    ),
    tags: z.array(z.string())
  })
});

const formatList = (label: string, items: string[]) => {
  if (!items.length) return "";
  const lines = items.map((item) => `- ${item}`).join("\n");
  return `${label}:\n${lines}`;
};

const buildExpectedTherapistResponse = (
  expected: z.infer<typeof llmParseSchema>["task"]["expected_therapist_response"]
) => {
  const sections = [
    formatList("Must do", expected.must_do),
    formatList("Should do", expected.should_do),
    formatList("Must avoid", expected.must_avoid),
    formatList("Style constraints", expected.style_constraints)
  ].filter(Boolean);
  return sections.join("\n\n");
};

const buildPracticeInstructions = (
  practice: z.infer<typeof llmParseSchema>["task"]["practice_instructions"],
  objectiveOverview: string
) => {
  const sections = [
    objectiveOverview ? `Objective overview:\n${objectiveOverview}` : "",
    practice.timebox_minutes ? `Timebox: ${practice.timebox_minutes} minutes` : "",
    formatList("Steps", practice.steps),
    formatList("Feedback process", practice.feedback_process),
    practice.difficulty_adjustment_rule
      ? `Difficulty adjustment: ${practice.difficulty_adjustment_rule}`
      : "",
    practice.role_switching ? `Role switching: ${practice.role_switching}` : ""
  ].filter(Boolean);
  return sections.join("\n\n");
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

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

const mapCriterionDescription = (
  criterion: z.infer<typeof llmParseSchema>["task"]["criteria"][number]
) => {
  const parts = [
    criterion.description,
    formatList("Behavioral markers", criterion.behavioral_markers),
    formatList("Common mistakes", criterion.common_mistakes),
    formatList("Evidence", criterion.what_counts_as_evidence)
  ].filter(Boolean);
  return parts.join("\n\n");
};

const mapPatientCueText = (
  cue: z.infer<typeof llmParseSchema>["task"]["patient_cues"][number]
) =>
  [
    `Evidence: ${cue.evidence_quote}`,
    `Why it matters: ${cue.why_it_matters}`,
    `Response hint: ${cue.therapist_response_hint}`,
    `Difficulty (${cue.difficulty}): ${cue.difficulty_reason}`
  ]
    .filter(Boolean)
    .join("\n");

const mapLlmTaskToV2 = (parsed: z.infer<typeof llmParseSchema>): DeliberatePracticeTaskV2 => {
  const content: ExerciseContentV2 = {
    preparations: parsed.task.preparations,
    expected_therapist_response: buildExpectedTherapistResponse(
      parsed.task.expected_therapist_response
    ),
    criteria: parsed.task.criteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.name,
      description: mapCriterionDescription(criterion)
    })),
    roleplay_sets: parsed.task.roleplay_sets.map((set, index) => ({
      id: `set-${index + 1}`,
      label: `${set.difficulty_label} (${set.difficulty_numeric})`,
      statements: set.client_statements.map((statement) => ({
        id: statement.id,
        difficulty: set.difficulty_label,
        text: statement.text,
        criterion_ids: statement.linked_criterion_ids,
        cue_ids: statement.extracted_cue_ids
      }))
    })),
    example_dialogues: parsed.task.example_dialogues.map((dialogue) => ({
      id: dialogue.id,
      label: dialogue.difficulty_label ?? "example",
      turns: [
        { role: "client", text: dialogue.client_turn },
        { role: "therapist", text: dialogue.therapist_turn }
      ]
    })),
    patient_cues: parsed.task.patient_cues.map((cue) => ({
      id: cue.id,
      label: cue.label,
      text: mapPatientCueText(cue),
      related_statement_ids: cue.applies_to_statement_ids
    })),
    practice_instructions: buildPracticeInstructions(
      parsed.task.practice_instructions,
      parsed.task.objective_overview
    ),
    source: {
      text: parsed.task.source.citation_text ?? null,
      url: parsed.task.source.source_url ?? null
    }
  };

  return {
    version: "2.0",
    task: {
      name: parsed.task.name,
      description: parsed.task.description,
      skill_domain: parsed.task.skill_domain,
      skill_difficulty_label: parsed.task.skill_difficulty_label ?? undefined,
      skill_difficulty_numeric: parsed.task.skill_difficulty_numeric,
      objectives: parsed.task.objectives.map((objective) => ({
        id: objective.id,
        label: objective.label,
        description: objective.description
      })),
      tags: parsed.task.tags
    },
    content
  };
};

const mapObjectives = (task: DeliberatePracticeTaskV2["task"], content: ExerciseContentV2) => {
  const objectiveMap = new Map(task.objectives.map((obj) => [obj.id, obj]));
  const orderedIds = content.criteria
    .map((criterion) => criterion.objective_id)
    .filter((id): id is string => Boolean(id));
  const uniqueIds = Array.from(
    new Set(orderedIds.length ? orderedIds : task.objectives.map((obj) => obj.id))
  );
  const trimmedIds = uniqueIds.slice(0, 6);
  const objectives: Objective[] = trimmedIds
    .map((id) => objectiveMap.get(id))
    .filter((obj): obj is DeliberatePracticeTaskV2["task"]["objectives"][number] =>
      Boolean(obj)
    )
    .map((obj) => ({
      id: obj.id,
      label: obj.label,
      description: obj.description,
      rubric: defaultRubric()
    }));
  if (objectives.length < 2) {
    const fallback = task.objectives.slice(0, 2).map((obj) => ({
      id: obj.id,
      label: obj.label,
      description: obj.description,
      rubric: defaultRubric()
    }));
    return fallback;
  }
  return objectives;
};

const pickExamplePrompt = (content: ExerciseContentV2) => {
  for (const set of content.roleplay_sets) {
    const statement = set.statements.find((item) => item.difficulty === "beginner");
    if (statement) return statement.text;
  }
  const fallback = content.roleplay_sets.flatMap((set) => set.statements)[0];
  return fallback?.text ?? "Client statement goes here.";
};

const pickExampleResponse = (content: ExerciseContentV2) => {
  for (const dialogue of content.example_dialogues) {
    const therapistTurn = dialogue.turns.find((turn) => turn.role === "therapist");
    if (therapistTurn) return therapistTurn.text;
  }
  return null;
};

const exerciseFromTask = (
  taskV2: DeliberatePracticeTaskV2,
  overrides?: {
    id?: string;
    slug?: string;
    is_published?: boolean;
    tags?: string[];
  }
) => {
  const slug = overrides?.slug ?? slugify(taskV2.task.name);
  const content = taskV2.content;
  const objectives = mapObjectives(taskV2.task, content);
  return {
    id: overrides?.id ?? nanoid(),
    slug,
    title: taskV2.task.name,
    description: taskV2.task.description,
    skill_domain: taskV2.task.skill_domain,
    difficulty: taskV2.task.skill_difficulty_numeric,
    patient_profile: { presenting: "schema therapy practice" },
    example_prompt: pickExamplePrompt(content),
    example_good_response: pickExampleResponse(content),
    objectives,
    grading: {
      pass_rule: {
        overall_min_score: 2.5,
        min_per_objective: 2,
        required_objective_ids: objectives.map((objective) => objective.id)
      },
      scoring: { aggregation: "weighted_mean" }
    },
    tags: overrides?.tags ?? taskV2.task.tags,
    is_published: overrides?.is_published ?? false,
    content,
    criteria: content.criteria
  };
};

export const createApiApp = ({ env, db }: ApiDependencies) => {
  const app = new Hono();
  const adminAuth = createAdminAuth(env);
  const userAuth = createUserAuth(env, db);
  const logger = createLogger({ service: "api" });

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

  app.get("/api/v1/exercises", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "exercises_list" });
    log.debug("Listing exercises");
    const results = await db.select().from(exercises);
    log.info("Exercises fetched", { count: results.length });
    return c.json(results);
  });

  app.post("/api/v1/exercises", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "exercises_create" });
    const body = await c.req.json();
    const data = exerciseSchema.parse(body);
    await db.insert(exercises).values({
      ...data,
      content: data.content ?? {},
      created_at: Date.now(),
      updated_at: Date.now()
    });
    log.info("Exercise created", { exerciseId: data.id });
    return c.json({ status: "created", id: data.id }, 201);
  });

  app.get("/api/v1/exercises/:id", async (c) => {
    const id = c.req.param("id");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "exercises_get",
      exerciseId: id
    });
    const [result] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, id))
      .limit(1);
    if (!result) {
      log.warn("Exercise not found");
      return c.json({ error: "Not found" }, 404);
    }
    log.info("Exercise retrieved");
    return c.json(result);
  });

  app.put("/api/v1/exercises/:id", async (c) => {
    const id = c.req.param("id");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "exercises_update",
      exerciseId: id
    });
    const body = await c.req.json();
    const data = exerciseSchema.parse({ ...body, id });
    await db
      .update(exercises)
      .set({ ...data, content: data.content ?? {}, updated_at: Date.now() })
      .where(eq(exercises.id, id));
    log.info("Exercise updated");
    return c.json({ status: "updated" });
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

  app.post("/api/v1/admin/parse-exercise", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_parse_exercise" });
    const body = await c.req.json();
    const schema = z.object({
      free_text: z.string().optional().default(""),
      source_url: z.string().nullable().optional()
    });
    const data = schema.parse(body);
    log.info("Parse exercise request received", {
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
      log.warn("Parse exercise missing source text");
      return c.json({ error: "Provide free_text or source_url" }, 400);
    }
    if (!env.openaiApiKey) {
      log.error("OpenAI key missing for parse exercise");
      return c.json({ error: "OpenAI key missing" }, 500);
    }
    const jsonSchema = {
      name: "DeliberatePracticeTask",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["version", "task"],
        properties: {
          version: { type: "string", enum: ["2.0"] },
          task: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "short_name",
              "skill_domain",
              "skill_difficulty_label",
              "skill_difficulty_numeric",
              "description",
              "objective_overview",
              "preparations",
              "source",
              "expected_therapist_response",
              "criteria",
              "objectives",
              "practice_instructions",
              "roleplay_sets",
              "example_dialogues",
              "patient_cues",
              "tags"
            ],
            properties: {
              name: { type: "string" },
              short_name: { type: "string" },
              skill_domain: { type: "string" },
              skill_difficulty_label: {
                type: ["string", "null"],
                enum: ["beginner", "intermediate", "advanced", null]
              },
              skill_difficulty_numeric: { type: "number", minimum: 1, maximum: 5 },
              description: { type: "string" },
              objective_overview: { type: "string" },
              preparations: { type: "array", items: { type: "string" } },
              source: {
                type: "object",
                additionalProperties: false,
                required: ["citation_text", "source_url"],
                properties: {
                  citation_text: { type: ["string", "null"] },
                  source_url: { type: ["string", "null"] }
                }
              },
              expected_therapist_response: {
                type: "object",
                additionalProperties: false,
                required: ["must_do", "should_do", "must_avoid", "style_constraints"],
                properties: {
                  must_do: { type: "array", items: { type: "string" } },
                  should_do: { type: "array", items: { type: "string" } },
                  must_avoid: { type: "array", items: { type: "string" } },
                  style_constraints: { type: "array", items: { type: "string" } }
                }
              },
              criteria: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "name",
                    "description",
                    "behavioral_markers",
                    "common_mistakes",
                    "what_counts_as_evidence",
                    "weight"
                  ],
                  properties: {
                    id: { type: "string" },
                    name: { type: "string" },
                    description: { type: "string" },
                    behavioral_markers: { type: "array", items: { type: "string" } },
                    common_mistakes: { type: "array", items: { type: "string" } },
                    what_counts_as_evidence: { type: "array", items: { type: "string" } },
                    weight: { type: ["number", "null"] }
                  }
                }
              },
              objectives: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "criterion_ids", "label", "description", "rubric"],
                  properties: {
                    id: { type: "string" },
                    criterion_ids: { type: "array", items: { type: "string" } },
                    label: { type: "string" },
                    description: { type: "string" },
                    rubric: {
                      type: "object",
                      additionalProperties: false,
                      required: ["score_min", "score_max", "anchors"],
                      properties: {
                        score_min: { type: "number", enum: [0] },
                        score_max: { type: "number", enum: [4] },
                        anchors: {
                          type: "array",
                          minItems: 1,
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["score", "meaning"],
                            properties: {
                              score: { type: "number", enum: [0, 1, 2, 3, 4] },
                              meaning: { type: "string" }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              practice_instructions: {
                type: "object",
                additionalProperties: false,
                required: [
                  "timebox_minutes",
                  "steps",
                  "feedback_process",
                  "difficulty_adjustment_rule",
                  "role_switching"
                ],
                properties: {
                  timebox_minutes: { type: ["number", "null"] },
                  steps: { type: "array", items: { type: "string" } },
                  feedback_process: { type: "array", items: { type: "string" } },
                  difficulty_adjustment_rule: { type: ["string", "null"] },
                  role_switching: { type: ["string", "null"] }
                }
              },
              roleplay_sets: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["difficulty_label", "difficulty_numeric", "client_statements"],
                  properties: {
                    difficulty_label: {
                      type: "string",
                      enum: ["beginner", "intermediate", "advanced"]
                    },
                    difficulty_numeric: { type: "number", minimum: 1, maximum: 5 },
                    client_statements: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: [
                          "id",
                          "title",
                          "affect_tag",
                          "text",
                          "primary_themes",
                          "linked_criterion_ids",
                          "extracted_cue_ids"
                        ],
                        properties: {
                          id: { type: "string" },
                          title: { type: ["string", "null"] },
                          affect_tag: { type: ["string", "null"] },
                          text: { type: "string" },
                          primary_themes: { type: "array", items: { type: "string" } },
                          linked_criterion_ids: { type: "array", items: { type: "string" } },
                          extracted_cue_ids: { type: "array", items: { type: "string" } }
                        }
                      }
                    }
                  }
                }
              },
              example_dialogues: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "difficulty_label",
                    "client_turn",
                    "therapist_turn",
                    "criterion_callouts"
                  ],
                  properties: {
                    id: { type: "string" },
                    difficulty_label: {
                      type: ["string", "null"],
                      enum: ["beginner", "intermediate", "advanced", null]
                    },
                    client_turn: { type: "string" },
                    therapist_turn: { type: "string" },
                    criterion_callouts: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["criterion_id", "evidence_in_therapist_turn"],
                        properties: {
                          criterion_id: { type: "string" },
                          evidence_in_therapist_turn: { type: "string" }
                        }
                      }
                    }
                  }
                }
              },
              patient_cues: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "difficulty",
                    "label",
                    "evidence_quote",
                    "why_it_matters",
                    "therapist_response_hint",
                    "difficulty_reason",
                    "applies_to_statement_ids"
                  ],
                  properties: {
                    id: { type: "string" },
                    difficulty: { type: "number", minimum: 1, maximum: 5 },
                    label: { type: "string" },
                    evidence_quote: { type: "string" },
                    why_it_matters: { type: "string" },
                    therapist_response_hint: { type: "string" },
                    difficulty_reason: { type: "string" },
                    applies_to_statement_ids: { type: "array", items: { type: "string" } }
                  }
                }
              },
              tags: { type: "array", items: { type: "string" } }
            }
          }
        }
      },
      strict: true
    };

    const systemPrompt = `You are a meticulous content-to-JSON extractor for a psychotherapy deliberate-practice platform.
Your ONLY job is to transform the provided free text into a single JSON object that matches the schema below.
Return STRICT JSON ONLY. No markdown. No commentary. No trailing commas. No extra keys.

Hard rules:
- Preserve meaning; you may rewrite for clarity but do not invent facts not present in the text.
- If a field is not present, use null (not empty string) or [] for arrays.
- Every item that can be graded MUST be represented as a criterion/objective with an explicit rubric.
- All example dialogues MUST be represented as structured interactions with criterion references.
- All client statements MUST be captured and tagged with: difficulty_label, affect_tag, and extracted patient cues.
- Patient cues MUST be a separate list (“patient_cues”) and each cue MUST have a difficulty rating.
- Create stable ids:
  - criterion ids: "c1", "c2", ...
  - objective ids: "o1", "o2", ... (usually 1:1 with criteria)
  - example dialogue ids: "ex1", "ex2", ...
  - client statement ids: "b1".."bN", "i1".."iN", "a1".."aN" (beginner/intermediate/advanced)
  - cue ids: "cue1", "cue2", ...
- Normalize difficulty_label to one of: "beginner", "intermediate", "advanced".
- Map difficulty_label to difficulty_numeric (1..5) as:
  - beginner → 2
  - intermediate → 3
  - advanced → 4
  (Use 1 or 5 ONLY if the text explicitly suggests easier/harder than the named level.)

Rubric requirements (for each objective):
- score_min must be 0, score_max must be 4
- provide anchors for 0, 2, 4 at minimum (you may add 1 and 3 if helpful)
- anchors must describe observable therapist behavior in the response (not internal states)

What “patient cues” means here:
- Short, concrete signals embedded in the client text that guide the therapist response:
  examples: hesitancy, shame, defensiveness, self-doubt, testing the therapist, anger, fear, pride, relief,
  relational dynamics, boundary setting, self-advocacy, vulnerability, critic-mode language, etc.
- Each cue must include:
  - label (short)
  - evidence (a short quote fragment from the client statement)
  - why_it_matters (1 sentence)
  - therapist_response_hint (1 sentence)
  - difficulty (1..5) and difficulty_reason (1 sentence)

Now produce JSON that matches EXACTLY this schema:

{
  "version": "2.0",
  "task": {
    "name": string,
    "short_name": string,
    "skill_domain": string,
    "skill_difficulty_label": "beginner" | "intermediate" | "advanced" | null,
    "skill_difficulty_numeric": 1 | 2 | 3 | 4 | 5,
    "description": string,
    "objective_overview": string,
    "preparations": string[],
    "source": {
      "citation_text": string | null,
      "source_url": string | null
    },
    "expected_therapist_response": {
      "must_do": string[],
      "should_do": string[],
      "must_avoid": string[],
      "style_constraints": string[]
    },
    "criteria": [
      {
        "id": "c1" | "c2" | string,
        "name": string,
        "description": string,
        "behavioral_markers": string[],
        "common_mistakes": string[],
        "what_counts_as_evidence": string[],
        "weight": number | null
      }
    ],
    "objectives": [
      {
        "id": "o1" | "o2" | string,
        "criterion_ids": string[],
        "label": string,
        "description": string,
        "rubric": {
          "score_min": 0,
          "score_max": 4,
          "anchors": [
            { "score": 0 | 1 | 2 | 3 | 4, "meaning": string }
          ]
        }
      }
    ],
    "practice_instructions": {
      "timebox_minutes": number | null,
      "steps": string[],
      "feedback_process": string[],
      "difficulty_adjustment_rule": string | null,
      "role_switching": string | null
    },
    "roleplay_sets": [
      {
        "difficulty_label": "beginner" | "intermediate" | "advanced",
        "difficulty_numeric": 1 | 2 | 3 | 4 | 5,
        "client_statements": [
          {
            "id": string,
            "title": string | null,
            "affect_tag": string | null,
            "text": string,
            "primary_themes": string[],
            "linked_criterion_ids": string[],
            "extracted_cue_ids": string[]
          }
        ]
      }
    ],
    "example_dialogues": [
      {
        "id": string,
        "difficulty_label": "beginner" | "intermediate" | "advanced" | null,
        "client_turn": string,
        "therapist_turn": string,
        "criterion_callouts": [
          { "criterion_id": string, "evidence_in_therapist_turn": string }
        ]
      }
    ],
    "patient_cues": [
      {
        "id": string,
        "difficulty": 1 | 2 | 3 | 4 | 5,
        "label": string,
        "evidence_quote": string,
        "why_it_matters": string,
        "therapist_response_hint": string,
        "difficulty_reason": string,
        "applies_to_statement_ids": string[]
      }
    ],
    "tags": string[]
  }
}`;
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_schema", json_schema: jsonSchema },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: sourceText
          }
        ]
      })
    });
    if (!response.ok) {
      log.error("OpenAI parse request failed", { status: response.status });
      return c.json({ error: "OpenAI parse failed" }, 500);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      log.error("OpenAI parse returned empty content");
      return c.json({ error: "OpenAI parse returned empty response" }, 500);
    }
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(content);
    } catch (error) {
      log.error("OpenAI parse returned invalid JSON", { error: safeError(error) });
      return c.json({ error: "OpenAI parse returned invalid JSON", details: String(error) }, 500);
    }
    const parsed = llmParseSchema.safeParse(parsedJson);
    if (!parsed.success) {
      log.warn("OpenAI parse response failed validation");
      return c.json({ error: "Invalid parse response", details: parsed.error.flatten() }, 400);
    }
    const mapped = mapLlmTaskToV2(parsed.data);
    const validated = deliberatePracticeTaskV2Schema.safeParse(mapped);
    if (!validated.success) {
      log.warn("Mapped parse response failed validation");
      return c.json(
        { error: "Mapped parse response failed validation", details: validated.error.flatten() },
        400
      );
    }
    log.info("Parse exercise completed");
    return c.json(validated.data);
  });

  app.post("/api/v1/admin/import-exercise", async (c) => {
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "admin_import_exercise" });
    const body = await c.req.json();
    const schema = z.object({
      task_v2: deliberatePracticeTaskV2Schema,
      exercise_overrides: z
        .object({
          id: z.string().optional(),
          slug: z.string().optional(),
          is_published: z.boolean().optional(),
          tags: z.array(z.string()).optional()
        })
        .optional()
    });
    const data = schema.parse(body);
    const exercise = exerciseFromTask(data.task_v2, data.exercise_overrides);
    const validated = exerciseSchema.parse(exercise);
    const existingById = data.exercise_overrides?.id
      ? await db
          .select()
          .from(exercises)
          .where(eq(exercises.id, data.exercise_overrides.id))
          .limit(1)
      : [];
    const existingBySlug = existingById.length
      ? []
      : await db.select().from(exercises).where(eq(exercises.slug, validated.slug)).limit(1);
    if (existingById.length || existingBySlug.length) {
      const existing = existingById[0] ?? existingBySlug[0];
      await db
        .update(exercises)
        .set({
          ...validated,
          id: existing.id,
          content: validated.content ?? {},
          source_text: data.task_v2.content.source?.text ?? null,
          source_url: data.task_v2.content.source?.url ?? null,
          updated_at: Date.now()
        })
        .where(eq(exercises.id, existing.id));
      log.info("Exercise imported (updated)", { exerciseId: existing.id, slug: validated.slug });
      return c.json({ id: existing.id, slug: validated.slug });
    }
    await db.insert(exercises).values({
      ...validated,
      content: validated.content ?? {},
      source_text: data.task_v2.content.source?.text ?? null,
      source_url: data.task_v2.content.source?.url ?? null,
      created_at: Date.now(),
      updated_at: Date.now()
    });
    log.info("Exercise imported (created)", { exerciseId: validated.id, slug: validated.slug });
    return c.json({ id: validated.id, slug: validated.slug });
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
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
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

  app.post("/api/v1/attempts/start", async (c) => {
    const body = await c.req.json();
    const schema = z.object({ exercise_id: z.string() });
    const data = schema.parse(body);
    const user = c.get("user");
    const id = nanoid();
    await db.insert(attempts).values({
      id,
      user_id: user.id,
      exercise_id: data.exercise_id,
      started_at: Date.now(),
      completed_at: null,
      audio_ref: null,
      transcript: "",
      evaluation: {},
      overall_pass: false,
      overall_score: 0,
      model_info: {}
    });
    logger
      .child({ requestId: c.get("requestId"), endpoint: "attempts_start" })
      .info("Attempt started", { attemptId: id, userId: user.id, exerciseId: data.exercise_id });
    return c.json({ attempt_id: id });
  });

  app.post("/api/v1/attempts/:id/upload-audio", async (c) => {
    const attemptId = c.req.param("id");
    const body = await c.req.json();
    const schema = z.object({ audio_ref: z.string() });
    const data = schema.parse(body);
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "attempts_upload_audio",
      attemptId,
      userId: user.id
    });
    await db
      .update(attempts)
      .set({ audio_ref: data.audio_ref })
      .where(and(eq(attempts.id, attemptId), eq(attempts.user_id, user.id)));
    log.info("Audio uploaded", { audioRef: data.audio_ref });
    return c.json({ status: "ok" });
  });

  app.post("/api/v1/attempts/:id/evaluate", async (c) => {
    const attemptId = c.req.param("id");
    const body = await c.req.json();
    const schema = z.object({
      transcript: z.string(),
      evaluation: evaluationResultSchema,
      overall_pass: z.boolean(),
      overall_score: z.number()
    });
    const data = schema.parse(body);
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "attempts_evaluate",
      attemptId,
      userId: user.id
    });
    await db
      .update(attempts)
      .set({
        transcript: data.transcript,
        evaluation: data.evaluation,
        overall_pass: data.overall_pass,
        overall_score: data.overall_score
      })
      .where(and(eq(attempts.id, attemptId), eq(attempts.user_id, user.id)));
    log.info("Attempt evaluated", { overallScore: data.overall_score, overallPass: data.overall_pass });
    return c.json({ status: "ok" });
  });

  app.post("/api/v1/attempts/:id/complete", async (c) => {
    const attemptId = c.req.param("id");
    const user = c.get("user");
    const log = logger.child({
      requestId: c.get("requestId"),
      endpoint: "attempts_complete",
      attemptId,
      userId: user.id
    });
    await db
      .update(attempts)
      .set({ completed_at: Date.now() })
      .where(and(eq(attempts.id, attemptId), eq(attempts.user_id, user.id)));
    log.info("Attempt completed");
    return c.json({ status: "ok" });
  });

  app.get("/api/v1/attempts", async (c) => {
    const user = c.get("user");
    const log = logger.child({ requestId: c.get("requestId"), endpoint: "attempts_list", userId: user.id });
    const { exercise_id } = c.req.query();
    const filters = [eq(attempts.user_id, user.id)];
    if (exercise_id) {
      filters.push(eq(attempts.exercise_id, exercise_id));
    }
    const results = await db
      .select()
      .from(attempts)
      .where(filters.length > 1 ? and(...filters) : filters[0]);
    log.info("Attempts fetched", { count: results.length, exerciseId: exercise_id ?? null });
    return c.json(
      results.map((attempt) => ({
        id: attempt.id,
        exercise_id: attempt.exercise_id,
        overall_score: attempt.overall_score,
        overall_pass: attempt.overall_pass,
        completed_at: new Date(attempt.completed_at ?? attempt.started_at).toISOString()
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
    logEvent("info", "input.parse.ok", {
      exerciseId: input.exercise_id,
      attemptId: input.attempt_id ?? null,
      mode: input.mode ?? null,
      audio_length: audioLength
    });

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

    logEvent("info", "exercise.load.start", { exerciseId: input.exercise_id });
    const [exercise] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, input.exercise_id))
      .limit(1);
    if (!exercise) {
      logEvent("warn", "exercise.load.error", { exerciseId: input.exercise_id });
      return c.json(
        { requestId, errors: [{ stage: "input", message: "Exercise not found." }] },
        404
      );
    }
    logEvent("info", "exercise.load.ok", { exerciseId: input.exercise_id });

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
          exercise,
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
      let parsed = evaluationResultSchema.safeParse(evaluation);
      if (!parsed.success) {
        const repaired = attemptJsonRepair(JSON.stringify(evaluation));
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
          }
        };
        const evaluationPayload = scoringResult ?? {};
        const overallScore = scoringResult?.overall.score ?? 0;
        const overallPass = scoringResult?.overall.pass ?? false;
        const transcriptText = transcript.text ?? "";
        if (input.attempt_id) {
          const [existing] = await db
            .select({ id: attempts.id })
            .from(attempts)
            .where(and(eq(attempts.id, input.attempt_id), eq(attempts.user_id, user.id)))
            .limit(1);
          if (existing) {
            await db
              .update(attempts)
              .set({
                completed_at: Date.now(),
                transcript: transcriptText,
                evaluation: evaluationPayload,
                overall_score: overallScore,
                overall_pass: overallPass,
                model_info: modelInfo
              })
              .where(and(eq(attempts.id, input.attempt_id), eq(attempts.user_id, user.id)));
          } else {
            await db.insert(attempts).values({
              id: attemptId,
              user_id: user.id,
              exercise_id: input.exercise_id,
              started_at: Date.now(),
              completed_at: Date.now(),
              audio_ref: null,
              transcript: transcriptText,
              evaluation: evaluationPayload,
              overall_pass: overallPass,
              overall_score: overallScore,
              model_info: modelInfo
            });
          }
        } else {
          await db.insert(attempts).values({
            id: attemptId,
            user_id: user.id,
            exercise_id: input.exercise_id,
            started_at: Date.now(),
            completed_at: Date.now(),
            audio_ref: null,
            transcript: transcriptText,
            evaluation: evaluationPayload,
            overall_pass: overallPass,
            overall_score: overallScore,
            model_info: modelInfo
          });
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

    const response = {
      requestId,
      attemptId,
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
