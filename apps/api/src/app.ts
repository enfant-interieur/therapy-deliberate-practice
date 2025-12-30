import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { exercises, attempts } from "./db/schema";
import { eq } from "drizzle-orm";
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

export type ApiDatabase = DrizzleD1Database | BetterSQLite3Database;

export type ApiDependencies = {
  env: RuntimeEnv;
  db: ApiDatabase;
};

const requireAdmin = (
  env: RuntimeEnv,
  c: { req: { header: (name: string) => string | undefined } }
) => {
  if (!env.adminToken) {
    return { ok: false as const, error: "ADMIN_TOKEN is not configured" };
  }
  const token = c.req.header("x-admin-token");
  if (!token || token !== env.adminToken) {
    return { ok: false as const, error: "Unauthorized" };
  }
  return { ok: true as const };
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

  app.use(async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? nanoid();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const start = Date.now();
    await next();
    const duration = Date.now() - start;
    console.log(
      JSON.stringify({
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: duration
      })
    );
  });

  app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

  app.get("/api/v1/health/local-ai", async (c) => {
    const stt = await selectSttProvider("local_only", env).then(
      () => true,
      () => false
    );
    const llm = await selectLlmProvider("local_only", env).then(
      () => true,
      () => false
    );
    return c.json({ stt, llm });
  });

  app.get("/api/v1/exercises", async (c) => {
    const results = await db.select().from(exercises);
    return c.json(results);
  });

  app.post("/api/v1/exercises", async (c) => {
    const body = await c.req.json();
    const data = exerciseSchema.parse(body);
    await db.insert(exercises).values({
      ...data,
      content: data.content ?? {},
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return c.json({ status: "created", id: data.id }, 201);
  });

  app.get("/api/v1/exercises/:id", async (c) => {
    const id = c.req.param("id");
    const [result] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, id))
      .limit(1);
    if (!result) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(result);
  });

  app.put("/api/v1/exercises/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const data = exerciseSchema.parse({ ...body, id });
    await db
      .update(exercises)
      .set({ ...data, content: data.content ?? {}, updated_at: Date.now() })
      .where(eq(exercises.id, id));
    return c.json({ status: "updated" });
  });

  app.post("/api/v1/admin/parse-exercise", async (c) => {
    const auth = requireAdmin(env, c);
    if (!auth.ok) {
      return c.json({ error: auth.error }, auth.error === "Unauthorized" ? 401 : 500);
    }
    const body = await c.req.json();
    const schema = z.object({
      free_text: z.string().optional().default(""),
      source_url: z.string().nullable().optional()
    });
    const data = schema.parse(body);
    let sourceText = data.free_text?.trim() ?? "";
    if (!sourceText && data.source_url) {
      const response = await fetch(data.source_url);
      if (!response.ok) {
        return c.json({ error: "Failed to fetch source URL" }, 400);
      }
      const html = await response.text();
      sourceText = stripHtml(html);
    }
    if (!sourceText) {
      return c.json({ error: "Provide free_text or source_url" }, 400);
    }
    if (!env.openaiApiKey) {
      return c.json({ error: "OpenAI key missing" }, 500);
    }
    const jsonSchema = {
      name: "DeliberatePracticeTaskV2",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["version", "task", "content"],
        properties: {
          version: { type: "string", enum: ["2.0"] },
          task: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "description",
              "skill_domain",
              "skill_difficulty_numeric",
              "objectives",
              "tags"
            ],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
              skill_domain: { type: "string" },
              skill_difficulty_label: { type: "string" },
              skill_difficulty_numeric: { type: "number" },
              objectives: {
                type: "array",
                minItems: 1,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "description"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" }
                  }
                }
              },
              tags: { type: "array", items: { type: "string" } }
            }
          },
          content: {
            type: "object",
            additionalProperties: false,
            required: ["criteria", "roleplay_sets", "example_dialogues", "patient_cues"],
            properties: {
              preparations: { type: "array", items: { type: "string" } },
              expected_therapist_response: { type: "string" },
              criteria: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "description"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    description: { type: "string" },
                    objective_id: { type: "string" }
                  }
                }
              },
              roleplay_sets: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "statements"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    statements: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["id", "difficulty", "text"],
                        properties: {
                          id: { type: "string" },
                          difficulty: {
                            type: "string",
                            enum: ["beginner", "intermediate", "advanced"]
                          },
                          text: { type: "string" },
                          criterion_ids: { type: "array", items: { type: "string" } },
                          cue_ids: { type: "array", items: { type: "string" } }
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
                  required: ["id", "label", "turns"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    turns: {
                      type: "array",
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["role", "text"],
                        properties: {
                          role: { type: "string", enum: ["client", "therapist"] },
                          text: { type: "string" }
                        }
                      }
                    },
                    related_statement_id: { type: "string" }
                  }
                }
              },
              patient_cues: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["id", "label", "text"],
                  properties: {
                    id: { type: "string" },
                    label: { type: "string" },
                    text: { type: "string" },
                    related_statement_ids: { type: "array", items: { type: "string" } }
                  }
                }
              },
              practice_instructions: { type: "string" },
              source: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: ["string", "null"] },
                  url: { type: ["string", "null"] }
                }
              }
            }
          }
        }
      },
      strict: true
    };

    const systemPrompt =
      "You are an expert instructional designer. Extract the exercise into DeliberatePracticeTaskV2 JSON.";
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
      return c.json({ error: "OpenAI parse failed" }, 500);
    }
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return c.json({ error: "OpenAI parse returned empty response" }, 500);
    }
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(content);
    } catch (error) {
      return c.json({ error: "OpenAI parse returned invalid JSON", details: String(error) }, 500);
    }
    const parsed = deliberatePracticeTaskV2Schema.safeParse(parsedJson);
    if (!parsed.success) {
      return c.json({ error: "Invalid parse response", details: parsed.error.flatten() }, 400);
    }
    return c.json(parsed.data);
  });

  app.post("/api/v1/admin/import-exercise", async (c) => {
    const auth = requireAdmin(env, c);
    if (!auth.ok) {
      return c.json({ error: auth.error }, auth.error === "Unauthorized" ? 401 : 500);
    }
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
    return c.json({ id: validated.id, slug: validated.slug });
  });

  app.post("/api/v1/attempts/start", async (c) => {
    const body = await c.req.json();
    const schema = z.object({ exercise_id: z.string(), user_id: z.string() });
    const data = schema.parse(body);
    const id = nanoid();
    await db.insert(attempts).values({
      id,
      user_id: data.user_id,
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
    return c.json({ attempt_id: id });
  });

  app.post("/api/v1/attempts/:id/upload-audio", async (c) => {
    const attemptId = c.req.param("id");
    const body = await c.req.json();
    const schema = z.object({ audio_ref: z.string() });
    const data = schema.parse(body);
    await db.update(attempts).set({ audio_ref: data.audio_ref }).where(eq(attempts.id, attemptId));
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
    await db
      .update(attempts)
      .set({
        transcript: data.transcript,
        evaluation: data.evaluation,
        overall_pass: data.overall_pass,
        overall_score: data.overall_score
      })
      .where(eq(attempts.id, attemptId));
    return c.json({ status: "ok" });
  });

  app.post("/api/v1/attempts/:id/complete", async (c) => {
    const attemptId = c.req.param("id");
    await db.update(attempts).set({ completed_at: Date.now() }).where(eq(attempts.id, attemptId));
    return c.json({ status: "ok" });
  });

  app.get("/api/v1/attempts", async (c) => {
    const results = await db.select().from(attempts);
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
    const body = await c.req.json();
    const input = practiceRunInputSchema.parse(body);
    const mode = input.mode ?? (env.aiMode as ProviderMode);

    const sttProvider = await selectSttProvider(mode, env);
    const llmProvider = await selectLlmProvider(mode, env);

    const sttStart = Date.now();
    const transcript = await sttProvider.transcribe(input.audio);
    const sttDuration = Date.now() - sttStart;

    const [exercise] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, input.exercise_id))
      .limit(1);
    if (!exercise) {
      return c.json({ error: "Exercise not found" }, 404);
    }

    const llmStart = Date.now();
    let evaluation: any;
    try {
      evaluation = await llmProvider.evaluateDeliberatePractice({
        exercise,
        attempt_id: input.attempt_id ?? nanoid(),
        transcript
      });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
    const llmDuration = Date.now() - llmStart;

    let parsed = evaluationResultSchema.safeParse(evaluation);
    if (!parsed.success) {
      const repaired = attemptJsonRepair(JSON.stringify(evaluation));
      if (repaired) {
        parsed = evaluationResultSchema.safeParse(JSON.parse(repaired));
      }
    }

    const result = parsed.success
      ? parsed.data
      : {
          version: "1.0" as const,
          exercise_id: input.exercise_id,
          attempt_id: input.attempt_id ?? nanoid(),
          transcript: { text: transcript.text },
          objective_scores: [],
          overall: {
            score: 0,
            pass: false,
            summary_feedback:
              "We could not score this response because the evaluation format was invalid.",
            what_to_improve_next: ["Try again with a shorter response."]
          },
          patient_reaction: {
            emotion: "neutral",
            intensity: 1,
            response_text: "Let's reset and try again."
          },
          diagnostics: {
            provider: {
              stt: { kind: sttProvider.kind, model: sttProvider.model },
              llm: { kind: llmProvider.kind, model: llmProvider.model }
            },
            timing_ms: { stt: sttDuration, llm: llmDuration, total: sttDuration + llmDuration }
          }
        };

    return c.json({
      ...result,
      transcript: { ...result.transcript, text: transcript.text },
      diagnostics: {
        provider: {
          stt: { kind: sttProvider.kind, model: sttProvider.model },
          llm: { kind: llmProvider.kind, model: llmProvider.model }
        },
        timing_ms: { stt: sttDuration, llm: llmDuration, total: sttDuration + llmDuration }
      }
    });
  });

  return app;
};
