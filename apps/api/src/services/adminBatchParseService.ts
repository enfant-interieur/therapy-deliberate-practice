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
import {
  log as defaultLog,
  safeError,
  safeTruncate,
  type LogFields,
  type LogFn,
  type LogLevel
} from "../utils/logger";

type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";
type JobStep = "created_job" | "planning_segments" | "parsing_segment" | "persisting_task" | "done";

type SegmentContextBlock = {
  start: number;
  end: number;
  label: string;
  reason: string | null;
};

type BatchSegment = {
  start: number;
  end: number;
  titleHint: string | null;
  contextBlocks: SegmentContextBlock[];
};

const now = () => Date.now();

const headingRegex = /^\s*(\d+)[\).]\s+/;

const extractHeadingTitle = (line: string) => line.replace(headingRegex, "").trim();

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
    return [{ start: 1, end: lines.length, titleHint: null, contextBlocks: [] }];
  }
  return segments
    .map((segment) => {
      const start = Math.max(1, Math.min(lines.length, segment.start));
      const end = Math.max(start, Math.min(lines.length, segment.end));
      return { start, end, titleHint: segment.titleHint, contextBlocks: segment.contextBlocks };
    })
    .sort((a, b) => a.start - b.start);
};

const detectHeadingSegments = (lines: string[]): BatchSegment[] => {
  const headings: Array<{ line: number; titleHint: string | null }> = [];
  lines.forEach((line, index) => {
    if (headingRegex.test(line)) {
      headings.push({ line: index + 1, titleHint: extractHeadingTitle(line) || null });
    }
  });
  if (headings.length <= 1) {
    return [];
  }
  return headings.map((heading, idx) => {
    const next = headings[idx + 1];
    return {
      start: heading.line,
      end: next ? next.line - 1 : lines.length,
      titleHint: heading.titleHint,
      contextBlocks: []
    };
  });
};

const normalizeContextBlocks = (lines: string[], blocks?: BatchParsePlan["tasks"][number]["context_blocks"]) => {
  if (!blocks?.length) return [];
  const seen = new Set<string>();
  return blocks
    .map((block) => {
      const start = Math.max(1, Math.min(lines.length, block.start_line));
      const end = Math.max(start, Math.min(lines.length, block.end_line));
      const label = block.label.trim();
      const reason = block.reason?.trim() ?? null;
      return label
        ? {
            start,
            end,
            label,
            reason
          }
        : null;
    })
    .filter((block): block is SegmentContextBlock => Boolean(block))
    .filter((block) => {
      const key = `${block.start}:${block.end}:${block.label.toLowerCase()}:${block.reason ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const MAX_SEGMENT_DEBUG = 25;

const describeSegments = (segments: Array<{ start: number; end: number; titleHint: string | null; contextBlocks: SegmentContextBlock[] }>) => {
  const preview = segments.slice(0, MAX_SEGMENT_DEBUG).map((segment, index) => ({
    index: index + 1,
    start_line: segment.start,
    end_line: segment.end,
    title_hint: segment.titleHint,
    context_block_count: segment.contextBlocks.length
  }));
  return {
    total: segments.length,
    preview_count: preview.length,
    truncated_count: Math.max(0, segments.length - preview.length),
    segments: preview
  };
};

const extractSegmentMetadata = (segmentText: string) => {
  const metadata: Record<string, string> = {};
  const therapyMatch = segmentText.match(/Therapy model\s*:\s*(.+)/i);
  if (therapyMatch) {
    metadata.therapy_model = therapyMatch[1]?.trim() ?? "";
  }
  const tagMatch = segmentText.match(/Tags\s*:\s*(.+)/i);
  if (tagMatch) {
    metadata.tags = tagMatch[1]?.trim() ?? "";
  }
  const whenMatch = segmentText.match(/When to use[^:]*:\s*(.+)/i);
  if (whenMatch) {
    metadata.when_to_use = whenMatch[1]?.trim() ?? "";
  }
  return metadata;
};

type SegmentContextSnippet = SegmentContextBlock & { text: string };

const gatherContextSnippets = (lines: string[], blocks: SegmentContextBlock[]) => {
  if (!blocks?.length) return [];
  return blocks
    .map((block) => {
      const text = sliceByLines(lines, block.start, block.end);
      if (!text) return null;
      return { ...block, text };
    })
    .filter((block): block is SegmentContextSnippet => Boolean(block));
};

const buildSegmentPrompt = (
  segmentText: string,
  options: {
    titleHint: string | null;
    segmentIndex: number;
    totalSegments: number;
    globalContext: string | null;
    contextBlocks: SegmentContextSnippet[];
  }
) => {
  const metadata = extractSegmentMetadata(segmentText);
  const contextualMeta: Record<string, unknown> = {
    segment_index: options.segmentIndex,
    total_segments: options.totalSegments
  };
  if (options.titleHint) {
    contextualMeta.title_hint = options.titleHint;
  }
  if (options.globalContext) {
    contextualMeta.global_context = options.globalContext;
  }
  if (options.contextBlocks.length) {
    contextualMeta.external_context_blocks = options.contextBlocks.map((block) => ({
      label: block.label,
      reason: block.reason,
      start_line: block.start,
      end_line: block.end
    }));
  }
  if (Object.keys(metadata).length) {
    contextualMeta.detected_metadata = metadata;
  }

  const parts: string[] = [];
  parts.push(`Segment metadata:\n${JSON.stringify(contextualMeta, null, 2)}`);
  if (options.contextBlocks.length) {
    const contextText = options.contextBlocks
      .map((block, index) => {
        const reason = block.reason ? `Reason: ${block.reason}\n` : "";
        return `Context block ${index + 1}: ${block.label} (lines ${block.start}-${block.end})\n${reason}${block.text}`;
      })
      .join("\n\n---\n\n");
    parts.push(`Additional context outside this segment:\n${contextText}`);
  }
  parts.push(`Segment source text:\n${segmentText}`);
  return parts.join("\n\n---\n\n");
};

const MAX_PARSE_ATTEMPTS = 3;
const RETRIABLE_PARSE_ERROR_PATTERNS = [
  /schema validation failed/i,
  /invalid json/i,
  /returned empty output/i
];

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const shouldRetryParseError = (error: unknown) => {
  const message = getErrorMessage(error);
  if (!message) return false;
  return RETRIABLE_PARSE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const buildRetryHints = (message: string) => {
  const hints: string[] = [];
  const lower = message.toLowerCase();
  if (lower.includes("examples") && lower.includes("language")) {
    hints.push(
      "Every example object must include a non-empty `language` field that matches task.language (for English, use \"en\"). Never return null."
    );
  }
  if (lower.includes("interaction_examples") && lower.includes("therapist_text")) {
    hints.push("Each interaction example needs a single patient_text and therapist_text. Do not omit either field.");
  }
  if (lower.includes("criteria") && lower.includes("anchors")) {
    hints.push(
      "Each criterion rubric must include anchors for scores 0, 2, and 4 (score_min=0, score_max=4). Supply observable behaviors."
    );
  }
  return hints;
};

const buildRetryInstruction = (attempt: number, message: string) => {
  const hints = buildRetryHints(message);
  const instructions = [
    `RETRY INSTRUCTIONS (attempt ${attempt}):`,
    "The previous response failed schema validation. Fix the root cause and regenerate the ENTIRE JSON payload.",
    `Error summary: ${safeTruncate(message, 600)}`,
    "Checklist before responding:",
    "- Validate that every field matches the DeliberatePracticeTask schema.",
    "- Do not return null or empty strings for required properties.",
    "- Ensure ids remain stable (c1/c2…, ex1/ex2…, ix1/ix2…).",
    "- Re-run your internal validation before sending the JSON."
  ];
  hints.forEach((hint) => instructions.push(`- ${hint}`));
  instructions.push(
    "Return strictly valid JSON only. Do not apologize or describe the fix—just output the corrected object."
  );
  return instructions.join("\n");
};

const buildPromptWithRetryNotes = (basePrompt: string, notes: string[]) => {
  if (!notes.length) return basePrompt;
  const noteText = notes
    .map((note, index) => `Correction block ${index + 1}:\n${note}`)
    .join("\n\n---\n\n");
  return `${basePrompt}\n\n---\n\n${noteText}`;
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
  logger?: LogFn;
};

export const runBatchParseJob = async (
  db: ApiDatabase,
  env: RuntimeEnv,
  jobId: string,
  input: { sourceText: string; parseMode?: ParseMode },
  deps: BatchParseJobDeps = {}
) => {
  const logFn = deps.logger ?? defaultLog;
  const baseLogFields: LogFields = {
    jobId,
    parseMode: input.parseMode ?? "original"
  };
  const jobLog = (level: LogLevel, event: string, fields?: LogFields) => {
    logFn(level, event, { ...baseLogFields, ...(fields ?? {}) });
  };

  try {
    await updateJob(db, jobId, { status: "running", step: "planning_segments" });
    await appendEvent(db, jobId, {
      level: "info",
      step: "planning_segments",
      message: "Analyzing text to detect task boundaries…"
    });

    const { lines, numberedText } = toLineNumbered(input.sourceText);
    const sourceHash = await hashCheap(input.sourceText);
    jobLog("info", "batch_parse.job.run_start", {
      source_char_count: input.sourceText.length,
      source_line_count: lines.length,
      source_hash: sourceHash
    });

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

    const planStart = now();
    let parsedPlan: BatchParsePlan;
    try {
      jobLog("info", "batch_parse.plan_segments.request", {
        numbered_preview: numberedText.slice(0, 500)
      });
      parsedPlan = await planSegments({ numberedText });
      jobLog("info", "batch_parse.plan_segments.ok", {
        duration_ms: now() - planStart,
        planned_segments: parsedPlan.tasks.length
      });
    } catch (error) {
      const safe = safeError(error);
      jobLog("error", "batch_parse.plan_segments.error", safe);
      await appendEvent(db, jobId, {
        level: "error",
        step: "planning_segments",
        message: "Segment planning failed.",
        meta: safe
      });
      throw error;
    }
    const rawSegments =
      parsedPlan.tasks.length <= 1
        ? [
            {
              start_line: 1,
              end_line: lines.length,
              title_hint: parsedPlan.tasks[0]?.title_hint ?? null,
              context_blocks: parsedPlan.tasks[0]?.context_blocks ?? []
            }
          ]
        : parsedPlan.tasks;

    let candidateSegments = rawSegments
      .filter((segment) => segment.end_line >= segment.start_line)
      .map((segment) => ({
        start: segment.start_line,
        end: segment.end_line,
        titleHint: segment.title_hint ?? null,
        contextBlocks: normalizeContextBlocks(lines, segment.context_blocks)
      }));

    if (candidateSegments.length <= 1) {
      const implicit = detectHeadingSegments(lines);
      if (implicit.length > 1) {
        candidateSegments = implicit.map((segment) => ({
          ...segment,
          contextBlocks: []
        }));
        await appendEvent(db, jobId, {
          level: "info",
          step: "planning_segments",
          message: `Detected ${implicit.length} numbered headings and will split segments accordingly.`
        });
      }
    }

    const normalizedSegments = normalizeSegments(lines, candidateSegments);

    await updateJob(db, jobId, { total_segments: normalizedSegments.length });
    await appendEvent(db, jobId, {
      level: "info",
      step: "planning_segments",
      message: `Detected ${normalizedSegments.length} segment(s).`,
      meta: describeSegments(normalizedSegments)
    });
    jobLog("info", "batch_parse.plan_segments.normalized", describeSegments(normalizedSegments));

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

    const prefaceEnd = normalizedSegments[0] ? normalizedSegments[0].start - 1 : 0;
    const globalContext = prefaceEnd > 0 ? sliceByLines(lines, 1, prefaceEnd).trim() || null : null;
    if (globalContext) {
      await appendEvent(db, jobId, {
        level: "info",
        step: "planning_segments",
        message: "Global context detected before the first segment.",
        meta: { char_count: globalContext.length }
      });
      jobLog("info", "batch_parse.global_context.detected", { char_count: globalContext.length });
    }

    await updateJob(db, jobId, { step: "parsing_segment" });

    const createdTaskResults: Array<{ taskId: string; slug: string; title: string } | null> = new Array(
      normalizedSegments.length
    ).fill(null);
    let completedSegments = 0;
    let persistStepSet = false;

    const markPersistingStep = async () => {
      if (persistStepSet) return;
      persistStepSet = true;
      await updateJob(db, jobId, { step: "persisting_task" });
    };

    const currentTaskIds = () =>
      createdTaskResults.filter((result): result is { taskId: string; slug: string; title: string } => Boolean(result)).map(
        (result) => result.taskId
      );

    const processSegment = async (segment: BatchSegment, index: number) => {
      const segmentText = sliceByLines(lines, segment.start, segment.end);
      const contextSnippets = gatherContextSnippets(lines, segment.contextBlocks);
      const baseSegmentPrompt = buildSegmentPrompt(segmentText, {
        titleHint: segment.titleHint,
        segmentIndex: index + 1,
        totalSegments: normalizedSegments.length,
        globalContext,
        contextBlocks: contextSnippets
      });

      const retryNotes: string[] = [];
      let parsed: DeliberatePracticeTaskV2 | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= MAX_PARSE_ATTEMPTS; attempt += 1) {
        const segmentPrompt = buildPromptWithRetryNotes(baseSegmentPrompt, retryNotes);

        await appendEvent(db, jobId, {
          level: "info",
          step: "parsing_segment",
          message: `Parsing segment ${index + 1} of ${normalizedSegments.length} (attempt ${attempt}/${MAX_PARSE_ATTEMPTS})…`,
          meta: {
            start_line: segment.start,
            end_line: segment.end,
            title_hint: segment.titleHint,
            context_block_count: contextSnippets.length,
            attempt,
            max_attempts: MAX_PARSE_ATTEMPTS,
            prompt_char_count: segmentPrompt.length
          }
        });

        const parseStarted = now();
        try {
          jobLog("info", "batch_parse.segment.parse_start", {
            segment_index: index + 1,
            start_line: segment.start,
            end_line: segment.end,
            prompt_char_count: segmentPrompt.length,
            context_block_count: contextSnippets.length,
            attempt
          });
          parsed = await parseSegment({ sourceText: segmentPrompt, parseMode: input.parseMode });
          jobLog("info", "batch_parse.segment.parse_ok", {
            segment_index: index + 1,
            duration_ms: now() - parseStarted,
            criteria_count: parsed.criteria.length,
            example_count: parsed.examples.length,
            interaction_example_count: parsed.interaction_examples?.length ?? 0,
            attempt
          });
          break;
        } catch (error) {
          lastError = error;
          const safe = safeError(error);
          const retriable = attempt < MAX_PARSE_ATTEMPTS && shouldRetryParseError(error);
          jobLog("error", "batch_parse.segment.parse_error", {
            segment_index: index + 1,
            start_line: segment.start,
            end_line: segment.end,
            attempt,
            retriable,
            error: safe
          });
          await appendEvent(db, jobId, {
            level: retriable ? "warn" : "error",
            step: "parsing_segment",
            message: retriable
              ? `Segment ${index + 1} attempt ${attempt} failed validation, retrying…`
              : `Segment ${index + 1} failed to parse.`,
            meta: {
              start_line: segment.start,
              end_line: segment.end,
              title_hint: segment.titleHint,
              attempt,
              retriable,
              error: safe
            }
          });
          if (!retriable) {
            throw error;
          }
          const errorMessage = getErrorMessage(error);
          retryNotes.push(buildRetryInstruction(attempt + 1, errorMessage));
        }
      }

      if (!parsed) {
        throw lastError ?? new Error(`Segment ${index + 1} failed after ${MAX_PARSE_ATTEMPTS} attempts.`);
      }

      const normalizedParsed = prepareParsedTask(parsed);
      await appendEvent(db, jobId, {
        level: "info",
        step: "parsing_segment",
        message: `Segment ${index + 1} parsed.`,
        meta: {
          criteria_count: normalizedParsed.criteria.length,
          example_count: normalizedParsed.examples.length,
          interaction_example_count: normalizedParsed.interaction_examples?.length ?? 0
        }
      });

      await markPersistingStep();
      await appendEvent(db, jobId, {
        level: "info",
        step: "persisting_task",
        message: `Creating draft task ${index + 1} of ${normalizedSegments.length}…`,
        meta: { title: normalizedParsed.task.title }
      });

      let created: Awaited<ReturnType<typeof createDraftTaskFromParsed>>;
      try {
        created = await createDraftTaskFromParsed(db, normalizedParsed);
      } catch (error) {
        const safe = safeError(error);
        jobLog("error", "batch_parse.segment.persist_error", {
          segment_index: index + 1,
          error: safe
        });
        await appendEvent(db, jobId, {
          level: "error",
          step: "persisting_task",
          message: `Draft creation failed for segment ${index + 1}.`,
          meta: {
            error: safe,
            title: normalizedParsed.task.title
          }
        });
        throw error;
      }
      jobLog("info", "batch_parse.segment.persist_ok", {
        segment_index: index + 1,
        task_id: created.taskId,
        slug: created.slug
      });
      createdTaskResults[index] = created;
      completedSegments += 1;
      await updateJob(db, jobId, {
        completed_segments: completedSegments,
        created_task_ids: currentTaskIds()
      });
      await appendEvent(db, jobId, {
        level: "info",
        step: "persisting_task",
        message: `Draft created: ${created.title}`,
        meta: { task_id: created.taskId, slug: created.slug }
      });
    };

    const segmentPromises = normalizedSegments.map((segment, index) => processSegment(segment, index));
    const settledResults = await Promise.allSettled(segmentPromises);
    const failedResult = settledResults.find((result) => result.status === "rejected");
    if (failedResult && failedResult.status === "rejected") {
      throw failedResult.reason;
    }

    await updateJob(db, jobId, { status: "completed", step: "done" });
    await appendEvent(db, jobId, {
      level: "info",
      step: "done",
      message: "Batch parsing completed."
    });
    jobLog("info", "batch_parse.job.completed", {
      total_segments: createdTaskResults.filter(Boolean).length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(db, jobId, { status: "failed", step: "done", error: message });
    const safe = safeError(error);
    await appendEvent(db, jobId, {
      level: "error",
      step: "done",
      message: `Batch parsing failed: ${message}`,
      meta: safe
    });
    jobLog("error", "batch_parse.job.failed", safe);
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
