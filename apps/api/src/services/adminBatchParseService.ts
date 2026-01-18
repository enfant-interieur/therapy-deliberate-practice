import { nanoid } from "nanoid";
import { and, eq, gt } from "drizzle-orm";
import type { ApiDatabase } from "../db/types";
import type { RuntimeEnv } from "../env";
import {
  adminBatchParseJobs,
  adminBatchParseJobEvents,
  taskCriteria,
  taskExamples,
  taskInteractionExamples,
  tasks
} from "../db/schema";
import { batchSegmentationInstructions } from "../providers/batchSegmentationPrompt";
import {
  batchParsePlanSchema,
  deliberatePracticeTaskV2Schema,
  type BatchParsePlan,
  type DeliberatePracticeTaskV2,
  type ParseMode
} from "@deliberate/shared";
import { createStructuredResponse } from "../providers/openaiResponses";
import { buildEnvAiConfig } from "../providers/config";
import { selectLlmProvider } from "../providers";
import { remapIdReferences, remapUniqueUuids } from "../utils/remap";
import { sanitizeInteractionExamples } from "../utils/interactionExamples";
import { slugify } from "../utils/slug";

type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";
type JobStep = "created_job" | "planning_segments" | "parsing_segment" | "persisting_task" | "done";

type BatchSegment = {
  start: number;
  end: number;
  titleHint: string | null;
};

const now = () => Date.now();

const getSubtle = async () => {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  const { webcrypto } = await import("node:crypto");
  return webcrypto.subtle;
};

const hashCheap = async (text: string) => {
  const subtle = await getSubtle();
  const encoded = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const toLineNumbered = (text: string) => {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const numberedText = lines.map((line, index) => `L${String(index + 1).padStart(4, "0")}: ${line}`).join("\n");
  return { lines, numberedText };
};

const sliceByLines = (lines: string[], start: number, end: number) => {
  const safeStart = Math.max(1, Math.min(lines.length, start));
  const safeEnd = Math.max(safeStart, Math.min(lines.length, end));
  return lines.slice(safeStart - 1, safeEnd).join("\n").trim();
};

const appendEvent = async (
  db: ApiDatabase,
  jobId: string,
  event: { level: "info" | "warn" | "error"; step: JobStep; message: string; meta?: unknown }
) => {
  await db.insert(adminBatchParseJobEvents).values({
    job_id: jobId,
    ts: now(),
    level: event.level,
    step: event.step,
    message: event.message,
    meta: event.meta ?? null
  });
};

const updateJob = async (
  db: ApiDatabase,
  jobId: string,
  patch: Partial<{
    status: JobStatus;
    step: JobStep;
    total_segments: number | null;
    completed_segments: number;
    created_task_ids: string[];
    error: string | null;
  }>
) => {
  await db
    .update(adminBatchParseJobs)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.step ? { step: patch.step } : {}),
      ...(patch.total_segments !== undefined ? { total_segments: patch.total_segments } : {}),
      ...(patch.completed_segments !== undefined ? { completed_segments: patch.completed_segments } : {}),
      ...(patch.created_task_ids !== undefined ? { created_task_ids: patch.created_task_ids } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      updated_at: now()
    })
    .where(eq(adminBatchParseJobs.id, jobId));
};

const normalizeSegments = (lines: string[], segments: BatchSegment[]) => {
  if (!segments.length) {
    return [{ start: 1, end: lines.length, titleHint: null }];
  }
  return segments
    .map((segment) => {
      const start = Math.max(1, Math.min(lines.length, segment.start));
      const end = Math.max(start, Math.min(lines.length, segment.end));
      return { start, end, titleHint: segment.titleHint };
    })
    .sort((a, b) => a.start - b.start);
};

const prepareParsedTask = (parsed: DeliberatePracticeTaskV2) => {
  const fallbackLanguage = parsed.task.language ?? "en";
  const { items: criteria, idMap: criteriaIdMap } = remapUniqueUuids(parsed.criteria, "criteria");
  const { items: examples, idMap: exampleIdMap } = remapUniqueUuids(parsed.examples, "examples");
  const { items: interactions, idMap: interactionIdMap } = remapUniqueUuids(
    parsed.interaction_examples ?? [],
    "interaction_examples"
  );
  const normalized = remapIdReferences(
    {
      ...parsed,
      task: { ...parsed.task, language: fallbackLanguage },
      criteria,
      examples: examples.map((example) => ({
        ...example,
        language: example.language ?? fallbackLanguage
      })),
      interaction_examples: interactions
    },
    [criteriaIdMap, exampleIdMap, interactionIdMap]
  );
  const validated = deliberatePracticeTaskV2Schema.parse(normalized);
  const sanitizedInteractions = sanitizeInteractionExamples(validated.interaction_examples);
  return { ...validated, interaction_examples: sanitizedInteractions };
};

const createDraftTaskFromParsed = async (db: ApiDatabase, parsed: DeliberatePracticeTaskV2) => {
  const taskId = `task_${nanoid(12)}`;
  const base = slugify(parsed.task.title) || "task";
  const slug = `${base}-${nanoid(6)}`.slice(0, 80);
  const timestamp = now();
  const language = parsed.task.language ?? "en";

  await db.insert(tasks).values({
    id: taskId,
    slug,
    title: parsed.task.title,
    description: parsed.task.description,
    skill_domain: parsed.task.skill_domain,
    base_difficulty: parsed.task.base_difficulty,
    general_objective: parsed.task.general_objective ?? null,
    tags: parsed.task.tags,
    authors: [],
    language,
    is_published: 0,
    parent_task_id: null,
    created_at: timestamp,
    updated_at: timestamp
  });

  if (parsed.criteria.length) {
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

  if (parsed.examples.length) {
    await db.insert(taskExamples).values(
      parsed.examples.map((example) => ({
        id: example.id,
        task_id: taskId,
        difficulty: example.difficulty,
        severity_label: example.severity_label ?? null,
        patient_text: example.patient_text,
        language: example.language ?? language,
        meta: example.meta ?? null,
        created_at: timestamp,
        updated_at: timestamp
      }))
    );
  }

  if (parsed.interaction_examples?.length) {
    await db.insert(taskInteractionExamples).values(
      parsed.interaction_examples.map((example) => ({
        id: example.id,
        task_id: taskId,
        difficulty: example.difficulty,
        title: example.title ?? null,
        patient_text: example.patient_text,
        therapist_text: example.therapist_text,
        language,
        meta: null,
        created_at: timestamp,
        updated_at: timestamp
      }))
    );
  }

  return { taskId, slug, title: parsed.task.title };
};

export const createBatchParseJob = async (db: ApiDatabase, sourceText: string) => {
  const jobId = `job_${nanoid(12)}`;
  const ts = now();
  const source_hash = await hashCheap(sourceText);
  await db.insert(adminBatchParseJobs).values({
    id: jobId,
    status: "queued",
    step: "created_job",
    total_segments: null,
    completed_segments: 0,
    created_task_ids: [],
    error: null,
    source_hash,
    created_at: ts,
    updated_at: ts
  });
  await appendEvent(db, jobId, { level: "info", step: "created_job", message: "Job created." });
  return jobId;
};

type SegmentPlanner = (input: { numberedText: string }) => Promise<BatchParsePlan>;
type SegmentParser = (input: { sourceText: string; parseMode?: ParseMode }) => Promise<DeliberatePracticeTaskV2>;

export type BatchParseJobDeps = {
  planSegments?: SegmentPlanner;
  parseSegment?: SegmentParser;
};

export const runBatchParseJob = async (
  db: ApiDatabase,
  env: RuntimeEnv,
  jobId: string,
  input: { sourceText: string; parseMode?: ParseMode },
  deps: BatchParseJobDeps = {}
) => {
  try {
    await updateJob(db, jobId, { status: "running", step: "planning_segments" });
    await appendEvent(db, jobId, {
      level: "info",
      step: "planning_segments",
      message: "Analyzing text to detect task boundaries…"
    });

    const { lines, numberedText } = toLineNumbered(input.sourceText);

    const planSegments: SegmentPlanner =
      deps.planSegments ??
      (async ({ numberedText: text }) => {
        if (!env.openaiApiKey) {
          throw new Error("OpenAI key missing for batch parsing.");
        }
        const structured = await createStructuredResponse({
          apiKey: env.openaiApiKey,
          model: "gpt-5.1",
          temperature: 0.1,
          instructions: batchSegmentationInstructions,
          input: text,
          schemaName: "BatchParsePlan",
          schema: batchParsePlanSchema
        });
        return structured.value;
      });

    const parsedPlan = await planSegments({ numberedText });
    const rawSegments =
      parsedPlan.tasks.length <= 1
        ? [{ start_line: 1, end_line: lines.length, title_hint: parsedPlan.tasks[0]?.title_hint ?? null }]
        : parsedPlan.tasks;

    const normalizedSegments = normalizeSegments(
      lines,
      rawSegments
        .filter((segment) => segment.end_line >= segment.start_line)
        .map((segment) => ({
          start: segment.start_line,
          end: segment.end_line,
          titleHint: segment.title_hint ?? null
        }))
    );

    await updateJob(db, jobId, { total_segments: normalizedSegments.length });
    await appendEvent(db, jobId, {
      level: "info",
      step: "planning_segments",
      message: `Detected ${normalizedSegments.length} segment(s).`
    });

    const parseSegment: SegmentParser =
      deps.parseSegment ??
      (() => {
        let providerPromise: ReturnType<typeof selectLlmProvider> | null = null;
        return async (payload) => {
          if (!providerPromise) {
            const config = buildEnvAiConfig(env, "openai_only");
            providerPromise = selectLlmProvider(config);
          }
          const provider = (await providerPromise).provider;
          return provider.parseExercise(payload);
        };
      })();

    const createdTaskIds: string[] = [];
    for (let index = 0; index < normalizedSegments.length; index += 1) {
      const segment = normalizedSegments[index];
      const segmentText = sliceByLines(lines, segment.start, segment.end);
      await updateJob(db, jobId, { step: "parsing_segment" });
      await appendEvent(db, jobId, {
        level: "info",
        step: "parsing_segment",
        message: `Parsing segment ${index + 1} of ${normalizedSegments.length}…`,
        meta: { start_line: segment.start, end_line: segment.end, title_hint: segment.titleHint }
      });

      const parsed = await parseSegment({ sourceText: segmentText, parseMode: input.parseMode });
      const normalizedParsed = prepareParsedTask(parsed);

      await updateJob(db, jobId, { step: "persisting_task" });
      await appendEvent(db, jobId, {
        level: "info",
        step: "persisting_task",
        message: `Creating draft task ${index + 1} of ${normalizedSegments.length}…`,
        meta: { title: normalizedParsed.task.title }
      });

      const created = await createDraftTaskFromParsed(db, normalizedParsed);
      createdTaskIds.push(created.taskId);
      await updateJob(db, jobId, {
        completed_segments: index + 1,
        created_task_ids: [...createdTaskIds]
      });
      await appendEvent(db, jobId, {
        level: "info",
        step: "persisting_task",
        message: `Draft created: ${created.title}`,
        meta: { task_id: created.taskId, slug: created.slug }
      });
    }

    await updateJob(db, jobId, { status: "completed", step: "done" });
    await appendEvent(db, jobId, {
      level: "info",
      step: "done",
      message: "Batch parsing completed."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(db, jobId, { status: "failed", step: "done", error: message });
    await appendEvent(db, jobId, {
      level: "error",
      step: "done",
      message: `Batch parsing failed: ${message}`
    });
  }
};

const parseJsonArray = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const parseJsonValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
};

export const getBatchParseStatus = async (db: ApiDatabase, jobId: string, afterEventId: number) => {
  const [job] = await db.select().from(adminBatchParseJobs).where(eq(adminBatchParseJobs.id, jobId)).limit(1);
  if (!job) return null;

  const events = await db
    .select()
    .from(adminBatchParseJobEvents)
    .where(and(eq(adminBatchParseJobEvents.job_id, jobId), gt(adminBatchParseJobEvents.id, afterEventId)))
    .orderBy(adminBatchParseJobEvents.id);

  const nextAfterEventId = events.length ? events[events.length - 1]!.id : afterEventId;

  return {
    job: {
      id: job.id,
      status: job.status as JobStatus,
      step: job.step as JobStep,
      totalSegments: job.total_segments ?? null,
      completedSegments: job.completed_segments ?? 0,
      createdTaskIds: parseJsonArray(job.created_task_ids),
      error: job.error ?? null,
      createdAt: job.created_at,
      updatedAt: job.updated_at
    },
    events: events.map((event) => ({
      id: event.id,
      ts: event.ts,
      level: event.level as "info" | "warn" | "error",
      step: event.step as JobStep,
      message: event.message,
      meta: parseJsonValue(event.meta)
    })),
    nextAfterEventId
  };
};
