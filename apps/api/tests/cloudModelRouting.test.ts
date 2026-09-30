import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { z } from "zod";
import type { DeliberatePracticeTaskV2 } from "@deliberate/shared";
import { OpenAILlmProvider } from "../src/providers/llm";
import { getOpenAIClient } from "../src/providers/openaiClient";
import { createStructuredResponse } from "../src/providers/openaiResponses";
import { CLOUD_LLM_POLICIES } from "../src/providers/models";
import {
  assertTranslationStructure,
  requiresClinicalTranslation,
} from "../src/providers/translationPolicy";

const plainTask = (): DeliberatePracticeTaskV2 => ({
  version: "2.1",
  task: {
    title: "Welcome",
    description: "Read these instructions.",
    skill_domain: "Orientation",
    base_difficulty: 1,
    general_objective: "Find the next page.",
    tags: ["welcome"],
    language: "en",
  },
  criteria: [],
  examples: [
    {
      id: "ex1",
      difficulty: 1,
      patient_text: "Hello",
      language: "en",
      meta: { retained: true },
    },
  ],
  interaction_examples: [],
});
const translation = (source: DeliberatePracticeTaskV2) => ({
  ...source,
  task: { ...source.task, language: "fr" },
  criteria: source.criteria.map((criterion) => ({
    ...criterion,
    rubric: criterion.rubric ?? null,
  })),
  examples: source.examples.map(({ meta: _meta, ...example }) => ({
    ...example,
    language: "fr",
  })),
});
const completed = (value: unknown) => ({
  status: "completed",
  output_text: JSON.stringify(value),
  _request_id: "req_synthetic",
});

test("Sol reasoning requests remove sampling, bound tokens/time, disable SDK retries and pass cancellation", async () => {
  const controller = new AbortController();
  let body: Record<string, unknown> = {};
  let options: Record<string, unknown> = {};
  const client = {
    responses: {
      create: async (
        request: Record<string, unknown>,
        requestOptions: Record<string, unknown>,
      ) => {
        body = request;
        options = requestOptions;
        return completed({ ok: true });
      },
    },
  };
  await createStructuredResponse({
    apiKey: "synthetic",
    ...CLOUD_LLM_POLICIES.evaluation,
    temperature: 0.2,
    input: "Synthetic fixture",
    schemaName: "Fixture",
    schema: z.object({ ok: z.boolean() }),
    signal: controller.signal,
    client: client as never,
  });
  assert.equal(body.model, "gpt-6.1-sol");
  assert.deepEqual(body.reasoning, { effort: "xhigh" });
  assert.equal("temperature" in body, false);
  assert.equal(body.store, false);
  assert.equal(body.max_output_tokens, 16384);
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, 180000);
  assert.equal(options.signal, controller.signal);
});

test("ordinary translation uses Luna and keeps source metadata outside the strict output schema", async () => {
  const source = plainTask();
  const client = getOpenAIClient({ apiKey: "synthetic-ordinary" });
  const requests: Record<string, unknown>[] = [];
  const mocked = mock.method(
    client.responses,
    "create",
    async (body: Record<string, unknown>) => {
      requests.push(body);
      return completed({
        translation: translation(source),
        requires_clinical_review: false,
      });
    },
  );
  try {
    const logs: unknown[] = [];
    const result = await OpenAILlmProvider(
      { apiKey: "synthetic-ordinary" },
      (_level, _event, fields) => logs.push(fields),
    ).translateTask({ source, targetLanguage: "fr" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "gpt-6-luna");
    assert.deepEqual(requests[0].reasoning, { effort: "none" });
    assert.deepEqual(result.examples[0].meta, { retained: true });
    assert.equal(
      JSON.stringify(requests[0].text as object).includes('"meta"'),
      false,
    );
    assert.equal(JSON.stringify(logs).includes('"model":"gpt-6-luna"'), true);
  } finally {
    mocked.mock.restore();
  }
});

test("unambiguous grading guidance and therapist responses require Sol independently of wording ambiguity", async () => {
  for (const field of ["criteria", "interaction_examples"] as const) {
    const source = plainTask();
    if (field === "criteria")
      source.criteria = [
        {
          id: "c1",
          label: "Reflect",
          description: "Name the emotion.",
          rubric: {
            score_min: 0,
            score_max: 4,
            anchors: [
              { score: 0, meaning: "No reflection" },
              { score: 2, meaning: "Partial reflection" },
              { score: 4, meaning: "Specific reflection" },
            ],
          },
        },
      ];
    else
      source.interaction_examples = [
        {
          id: "ix1",
          difficulty: 2,
          patient_text: "I feel alone.",
          therapist_text: "We can explore that together.",
        },
      ];
    assert.equal(requiresClinicalTranslation(source), true);
    const apiKey = `synthetic-${field}`;
    const client = getOpenAIClient({ apiKey });
    let request: Record<string, unknown> = {};
    const mocked = mock.method(
      client.responses,
      "create",
      async (body: Record<string, unknown>) => {
        request = body;
        return completed({
          translation: translation(source),
          requires_clinical_review: false,
        });
      },
    );
    try {
      await OpenAILlmProvider({ apiKey }).translateTask({
        source,
        targetLanguage: "fr",
      });
      assert.equal(request.model, "gpt-6.1-sol");
      assert.deepEqual(request.reasoning, { effort: "xhigh" });
    } finally {
      mocked.mock.restore();
    }
  }
});

test("ambiguity escalates to Sol and failed required review never returns the Luna candidate", async () => {
  for (const shouldFail of [false, true]) {
    const source = plainTask();
    const apiKey = `synthetic-escalation-${shouldFail}`;
    const client = getOpenAIClient({ apiKey });
    const models: unknown[] = [];
    const mocked = mock.method(
      client.responses,
      "create",
      async (body: Record<string, unknown>) => {
        models.push(body.model);
        if (models.length === 2 && shouldFail)
          throw Object.assign(new Error("Sensitive provider body"), {
            status: 503,
          });
        return completed({
          translation: translation(source),
          requires_clinical_review: models.length === 1,
        });
      },
    );
    try {
      const events: Array<{ event: string; fields: Record<string, unknown> }> =
        [];
      const promise = OpenAILlmProvider({ apiKey }, (_level, event, fields) =>
        events.push({ event, fields: fields ?? {} }),
      ).translateTask({
        source,
        targetLanguage: "fr",
      });
      if (shouldFail)
        await assert.rejects(
          promise,
          (error: Error) =>
            error.message.includes("503") &&
            !error.message.includes("Sensitive"),
        );
      else assert.equal((await promise).task.language, "fr");
      assert.deepEqual(models, ["gpt-6-luna", "gpt-6.1-sol"]);
      const finalEvent = events.find(
        ({ event }) =>
          event ===
          (shouldFail ? "llm.translate.http_error" : "llm.translate.http_ok"),
      );
      assert.deepEqual(finalEvent?.fields.provider, {
        kind: "openai",
        model: "gpt-6.1-sol",
      });
      assert.ok(!JSON.stringify(events).includes("Sensitive provider body"));
    } finally {
      mocked.mock.restore();
    }
  }
});

test("translation rejects changed identifiers, numeric grading anchors, ordering and wrong languages", () => {
  const source = plainTask();
  source.examples.push({ ...source.examples[0], id: "ex2", difficulty: 2 });
  const valid = {
    ...source,
    task: { ...source.task, language: "fr" },
    examples: source.examples.map((example) => ({
      ...example,
      language: "fr",
    })),
  };
  assert.doesNotThrow(() => assertTranslationStructure(source, valid, "fr"));
  for (const changed of [
    { ...valid, examples: [...valid.examples].reverse() },
    { ...valid, task: { ...valid.task, base_difficulty: 5 } },
    {
      ...valid,
      examples: valid.examples.map((example) => ({
        ...example,
        language: "en",
      })),
    },
  ])
    assert.throws(() => assertTranslationStructure(source, changed, "fr"));
});

test("refusal, incomplete and invalid output fail without leaking generated therapy text", async () => {
  for (const response of [
    { status: "incomplete", output_text: '{"ok":true}' },
    {
      status: "completed",
      output: [{ content: [{ type: "refusal", refusal: "Sensitive detail" }] }],
    },
    { status: "completed", output_text: "Sensitive invalid therapy text" },
  ]) {
    const client = { responses: { create: async () => response } };
    await assert.rejects(
      createStructuredResponse({
        apiKey: "synthetic",
        ...CLOUD_LLM_POLICIES.evaluation,
        input: "Synthetic fixture",
        schemaName: "Fixture",
        schema: z.object({ ok: z.boolean() }),
        client: client as never,
      }),
      (error: Error) => !error.message.includes("Sensitive"),
    );
  }
});

test("actual rating and task-generation call sites select Sol xhigh with their distinct budgets", async () => {
  const source = plainTask();
  const apiKey = "synthetic-ratings-generation";
  const client = getOpenAIClient({ apiKey });
  const requests: Record<string, unknown>[] = [];
  const evaluation = {
    version: "2.0",
    task_id: "task1",
    example_id: "ex1",
    attempt_id: "a1",
    transcript: { text: "Synthetic response" },
    criterion_scores: [],
    overall: {
      score: 0,
      pass: false,
      summary_feedback: "Synthetic feedback",
      what_to_improve_next: ["Try reflecting the concern"],
    },
    patient_reaction: { emotion: "neutral", intensity: 0 },
  };
  const mocked = mock.method(
    client.responses,
    "create",
    async (body: Record<string, unknown>) => {
      requests.push(body);
      return completed(
        requests.length === 1
          ? evaluation
          : {
              ...source,
              examples: source.examples.map(({ meta: _meta, ...example }) => ({
                ...example,
                severity_label: null,
              })),
            },
      );
    },
  );
  try {
    const provider = OpenAILlmProvider({ apiKey });
    await provider.evaluateDeliberatePractice({
      task: {
        ...source.task,
        id: "task1",
        slug: "task1",
        is_published: true,
        authors: [],
        created_at: 1,
        updated_at: 1,
      },
      example: source.examples[0],
      attempt_id: "a1",
      transcript: { text: "Synthetic response" },
    });
    await provider.parseExercise({
      sourceText: "Create a synthetic practice exercise.",
      parseMode: "original",
    });
    assert.deepEqual(
      requests.map((request) => request.model),
      ["gpt-6.1-sol", "gpt-6.1-sol"],
    );
    assert.deepEqual(
      requests.map((request) => request.max_output_tokens),
      [16384, 24576],
    );
    assert.equal(
      requests.every(
        (request) =>
          !("temperature" in request) &&
          (request.reasoning as { effort: string }).effort === "xhigh",
      ),
      true,
    );
  } finally {
    mocked.mock.restore();
  }
});
