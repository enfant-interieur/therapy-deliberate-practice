import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliberatePracticeTaskV2 } from "@deliberate/shared";
import { batchParsePlanSchema } from "@deliberate/shared";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import { resolveEnv } from "../src/env";
import {
  createBatchParseJob,
  getBatchParseStatus,
  runBatchParseJob
} from "../src/services/adminBatchParseService";
import { tasks, taskExamples } from "../src/db/schema";

const createTempDb = async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dir = await mkdtemp(path.join(__dirname, "tmp-admin-batch-"));
  const dbPath = path.join(dir, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  return { db, dir };
};

test("batchParsePlanSchema enforces valid ranges", () => {
  assert.throws(() =>
    batchParsePlanSchema.parse({
      tasks: [
        { start_line: 0, end_line: 5, title_hint: null, confidence: 0.8, reason: "bad start" }
      ]
    })
  );

  const result = batchParsePlanSchema.parse({
    tasks: [
      { start_line: 1, end_line: 10, title_hint: "Task A", confidence: 0.9, reason: "clear break" }
    ]
  });
  assert.equal(result.tasks.length, 1);
});

test("batch parse job stores incremental events and remaps duplicate example ids", async () => {
  const { db, dir } = await createTempDb();
  const env = resolveEnv({ ENV: "development", BYPASS_ADMIN_AUTH: "true" });
  const sourceText = "Line one\n---\nLine two";
  const jobId = await createBatchParseJob(db, sourceText);

  const mockParsed: DeliberatePracticeTaskV2 = {
    version: "2.1",
    task: {
      title: "Mock Task",
      description: "Example",
      skill_domain: "demo",
      base_difficulty: 3,
      general_objective: null,
      tags: [],
      language: "en"
    },
    criteria: [
      {
        id: "crit1",
        label: "Label",
        description: "Desc",
        rubric: {
          score_min: 0,
          score_max: 4,
          anchors: [
            { score: 0, meaning: "low" },
            { score: 4, meaning: "high" }
          ]
        }
      }
    ],
    examples: [
      { id: "dup", difficulty: 2, severity_label: null, patient_text: "Hi", language: "en", meta: null },
      { id: "dup", difficulty: 3, severity_label: null, patient_text: "There", language: "en", meta: null }
    ],
    interaction_examples: [
      {
        id: "int-1",
        difficulty: 2,
        title: "Say hi",
        patient_text: "Please help",
        therapist_text: "I'm here"
      }
    ]
  };

  await runBatchParseJob(
    db,
    env,
    jobId,
    { sourceText, parseMode: "original" },
    {
      planSegments: async () => ({
        tasks: [
          { start_line: 1, end_line: 1, title_hint: "A", confidence: 0.9, reason: "split" },
          { start_line: 3, end_line: 3, title_hint: "B", confidence: 0.8, reason: "split" }
        ]
      }),
      parseSegment: async () => mockParsed
    }
  );

  const firstStatus = await getBatchParseStatus(db, jobId, 0);
  assert.ok(firstStatus);
  assert.ok(firstStatus.events.length >= 2);
  const cursor = firstStatus.nextAfterEventId;
  const nextStatus = await getBatchParseStatus(db, jobId, cursor);
  assert.ok(nextStatus);
  assert.equal(nextStatus.events.length, 0);
  assert.equal(firstStatus.job.status, "completed");
  assert.equal(firstStatus.job.createdTaskIds.length, 2);

  const storedTasks = await db.select().from(tasks);
  assert.equal(storedTasks.length, 2);
  const storedExamples = await db.select().from(taskExamples);
  assert.equal(storedExamples.length, 4); // two segments, two examples each
  const exampleIds = storedExamples.map((example) => example.id);
  const uniqueIds = new Set(exampleIds);
  assert.equal(uniqueIds.size, exampleIds.length);

  await rm(dir, { recursive: true, force: true });
});

test("heading fallback splits segments when the model returns one block", async () => {
  const { db, dir } = await createTempDb();
  const env = resolveEnv({ ENV: "development", BYPASS_ADMIN_AUTH: "true" });
  const sourceText = `Preface

1) First skill
Therapy model: Test Model A

2) Second skill
Therapy model: Test Model B`;
  const jobId = await createBatchParseJob(db, sourceText);
  const mockParsed: DeliberatePracticeTaskV2 = {
    version: "2.1",
    task: {
      title: "Mock Task",
      description: "Desc",
      skill_domain: "demo",
      base_difficulty: 3,
      general_objective: null,
      tags: [],
      language: "en"
    },
    criteria: [
      {
        id: "crit1",
        label: "Label",
        description: "Desc",
        rubric: {
          score_min: 0,
          score_max: 4,
          anchors: [
            { score: 0, meaning: "low" },
            { score: 4, meaning: "high" }
          ]
        }
      }
    ],
    examples: [
      { id: "dup", difficulty: 2, severity_label: null, patient_text: "Hi", language: "en", meta: null }
    ],
    interaction_examples: []
  };

  let parseCalls = 0;
  await runBatchParseJob(
    db,
    env,
    jobId,
    { sourceText, parseMode: "exact" },
    {
      planSegments: async () => ({
        tasks: [{ start_line: 1, end_line: 5, title_hint: "Whole blob" }]
      }),
      parseSegment: async () => {
        parseCalls += 1;
        return mockParsed;
      }
    }
  );

  const status = await getBatchParseStatus(db, jobId, 0);
  assert.ok(status);
  assert.equal(status!.job.status, "completed");
  assert.equal(status!.job.totalSegments, 2);
  assert.equal(parseCalls, 2);

  await rm(dir, { recursive: true, force: true });
});

test("context blocks are injected into the parsing prompt", async () => {
  const { db, dir } = await createTempDb();
  const env = resolveEnv({ ENV: "development", BYPASS_ADMIN_AUTH: "true" });
  const sourceText = `Cluster overview: Systemic therapy focus

1) Skill card
Therapy model: Demo`;
  const jobId = await createBatchParseJob(db, sourceText);

  const mockParsed: DeliberatePracticeTaskV2 = {
    version: "2.1",
    task: {
      title: "Mock Task",
      description: "Desc",
      skill_domain: "demo",
      base_difficulty: 3,
      general_objective: null,
      tags: [],
      language: "en"
    },
    criteria: [
      {
        id: "crit1",
        label: "Label",
        description: "Desc",
        rubric: {
          score_min: 0,
          score_max: 4,
          anchors: [
            { score: 0, meaning: "low" },
            { score: 4, meaning: "high" }
          ]
        }
      }
    ],
    examples: [
      { id: "dup", difficulty: 2, severity_label: null, patient_text: "Hi", language: "en", meta: null }
    ],
    interaction_examples: []
  };

  let seenPrompt = "";
  await runBatchParseJob(
    db,
    env,
    jobId,
    { sourceText, parseMode: "exact" },
    {
      planSegments: async () => ({
        tasks: [
          {
            start_line: 3,
            end_line: 4,
            title_hint: "Skill card",
            confidence: 0.9,
            reason: "single block",
            context_blocks: [
              { start_line: 1, end_line: 1, label: "Cluster overview", reason: "Applies to the skill card." }
            ]
          }
        ]
      }),
      parseSegment: async ({ sourceText: prompt }) => {
        seenPrompt = prompt;
        return mockParsed;
      }
    }
  );

  assert.match(seenPrompt, /Additional context outside this segment/i);
  assert.match(seenPrompt, /Cluster overview: Systemic therapy focus/);

  await rm(dir, { recursive: true, force: true });
});

test("segments parse in parallel", async () => {
  const { db, dir } = await createTempDb();
  const env = resolveEnv({ ENV: "development", BYPASS_ADMIN_AUTH: "true" });
  const sourceText = `1) A
Line

2) B
Line`;
  const jobId = await createBatchParseJob(db, sourceText);

  const mockParsed: DeliberatePracticeTaskV2 = {
    version: "2.1",
    task: {
      title: "Mock Task",
      description: "Desc",
      skill_domain: "demo",
      base_difficulty: 3,
      general_objective: null,
      tags: [],
      language: "en"
    },
    criteria: [
      {
        id: "crit1",
        label: "Label",
        description: "Desc",
        rubric: {
          score_min: 0,
          score_max: 4,
          anchors: [
            { score: 0, meaning: "low" },
            { score: 4, meaning: "high" }
          ]
        }
      }
    ],
    examples: [
      { id: "dup", difficulty: 2, severity_label: null, patient_text: "Hi", language: "en", meta: null }
    ],
    interaction_examples: []
  };

  let active = 0;
  let maxActive = 0;
  await runBatchParseJob(
    db,
    env,
    jobId,
    { sourceText, parseMode: "exact" },
    {
      planSegments: async () => ({
        tasks: [
          { start_line: 1, end_line: 2, title_hint: "A", confidence: 0.9, reason: "card 1" },
          { start_line: 4, end_line: 5, title_hint: "B", confidence: 0.9, reason: "card 2" }
        ]
      }),
      parseSegment: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return mockParsed;
      }
    }
  );

  assert.ok(maxActive >= 2);

  await rm(dir, { recursive: true, force: true });
});
