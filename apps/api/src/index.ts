import { Hono } from "hono";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "./env";
import { createDb } from "./db";
import { ensureSchema } from "./db/init";
import { exercises, attempts } from "./db/schema";
import { eq } from "drizzle-orm";
import { evaluationResultSchema, practiceRunInputSchema, exerciseSchema } from "@deliberate/shared";
import { selectLlmProvider, selectSttProvider } from "./providers";
import { attemptJsonRepair } from "./utils/jsonRepair";
import { seedExercises } from "./seed";

ensureSchema(env.dbPath);
const db = createDb(env.dbPath);
await seedExercises(db);

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
  const stt = await selectSttProvider("local_only").then(
    () => true,
    () => false
  );
  const llm = await selectLlmProvider("local_only").then(
    () => true,
    () => false
  );
  return c.json({ stt, llm });
});

app.get("/api/v1/exercises", async (c) => {
  const results = await db.select().from(exercises).all();
  return c.json(results);
});

app.post("/api/v1/exercises", async (c) => {
  const body = await c.req.json();
  const data = exerciseSchema.parse(body);
  await db.insert(exercises).values({
    ...data,
    created_at: Date.now(),
    updated_at: Date.now()
  });
  return c.json({ status: "created", id: data.id }, 201);
});

app.get("/api/v1/exercises/:id", async (c) => {
  const id = c.req.param("id");
  const [result] = await db.select().from(exercises).where(eq(exercises.id, id));
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
    .set({ ...data, updated_at: Date.now() })
    .where(eq(exercises.id, id));
  return c.json({ status: "updated" });
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
  await db
    .update(attempts)
    .set({ completed_at: Date.now() })
    .where(eq(attempts.id, attemptId));
  return c.json({ status: "ok" });
});

app.get("/api/v1/attempts", async (c) => {
  const results = await db.select().from(attempts).all();
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
  const mode = input.mode ?? (env.aiMode as "local_prefer" | "openai_only" | "local_only");

  const sttProvider = await selectSttProvider(mode);
  const llmProvider = await selectLlmProvider(mode);

  const sttStart = Date.now();
  const transcript = await sttProvider.transcribe(input.audio);
  const sttDuration = Date.now() - sttStart;

  const [exercise] = await db.select().from(exercises).where(eq(exercises.id, input.exercise_id));
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

export default app;
