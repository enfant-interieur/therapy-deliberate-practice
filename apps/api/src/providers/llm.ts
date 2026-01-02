import type {
  LlmProvider,
  EvaluationInput,
  EvaluationResult,
  LlmParseResult,
  DeliberatePracticeTaskV2
} from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { deliberatePracticeTaskV2Schema, evaluationResultSchema, llmParseSchema } from "@deliberate/shared";
import { createStructuredResponse } from "./openaiResponses";
import { OPENAI_LLM_MODEL } from "./models";

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

export const LocalMlxLlmProvider = (env: RuntimeEnv, logger?: LogFn): LlmProvider => ({
  kind: "local",
  model: env.localLlmModel,
  healthCheck: () => healthCheck(env.localLlmUrl),
  evaluateDeliberatePractice: async (input) => {
    const start = Date.now();
    logger?.("info", "llm.evaluate.http_start", {
      provider: { kind: "local", model: env.localLlmModel }
    });
    const response = await fetch(`${env.localLlmUrl}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "llm.evaluate.http_error", {
        provider: { kind: "local", model: env.localLlmModel },
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`Local LLM failed (${response.status})`);
    }
    logger?.("info", "llm.evaluate.http_ok", {
      provider: { kind: "local", model: env.localLlmModel },
      duration_ms: Date.now() - start
    });
    return response.json();
  },
  parseExercise: async (_input) => {
    throw new Error("Local LLM does not support task parsing.");
  },
  translateTask: async (_input) => {
    throw new Error("Local LLM does not support task translation.");
  }
});

export const OpenAILlmProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn
): LlmProvider => ({
  kind: "openai",
  model: OPENAI_LLM_MODEL,
  healthCheck: async () => Boolean(apiKey),
  evaluateDeliberatePractice: async (input: EvaluationInput) => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const start = Date.now();
    logger?.("info", "llm.evaluate.http_start", {
      provider: { kind: "openai", model: OPENAI_LLM_MODEL }
    });
    const systemPrompt =
      "You are an evaluator for psychotherapy deliberate practice tasks. Return strict JSON only that matches EvaluationResult with criterion_scores.";
    try {
      const result = await createStructuredResponse<EvaluationResult>({
        apiKey,
        model: OPENAI_LLM_MODEL,
        temperature: 0.2,
        instructions: systemPrompt,
        input: JSON.stringify(input),
        schemaName: "EvaluationResult",
        schema: evaluationResultSchema
      });
      logger?.("info", "llm.evaluate.http_ok", {
        provider: { kind: "openai", model: OPENAI_LLM_MODEL },
        duration_ms: Date.now() - start,
        response_id: result.responseId
      });
      return result.value;
    } catch (error) {
      logger?.("error", "llm.evaluate.http_error", {
        provider: { kind: "openai", model: OPENAI_LLM_MODEL },
        duration_ms: Date.now() - start,
        error: safeTruncate(String(error), 200)
      });
      throw error;
    }
  },
  parseExercise: async (input): Promise<LlmParseResult> => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const start = Date.now();
    logger?.("info", "llm.parse.http_start", {
      provider: { kind: "openai", model: OPENAI_LLM_MODEL }
    });
    const exactPrompt = `You are a meticulous content-to-JSON extractor for a psychotherapy deliberate-practice platform.
Your ONLY job is to transform the provided free text into a single JSON object that matches the schema.
Return STRICT JSON ONLY. No markdown. No commentary. No trailing commas. No extra keys.

Hard rules:
- Preserve meaning; you may rewrite for clarity but do not invent facts not present in the text.
- If a field is not present, use null (not empty string) or [] for arrays.
- Every item that can be graded MUST be represented as a criterion with an explicit rubric.
- Provide a list of patient text examples (short statements) with difficulty 1..5.
- Set task.language to the detected source language (e.g., "en" or "fr").
- Create stable ids:
  - criterion ids: "c1", "c2", ...
  - example ids: "ex1", "ex2", ...

Rubric requirements (for each criterion):
- score_min must be 0, score_max must be 4
- provide anchors for 0, 2, 4 at minimum (you may add 1 and 3 if helpful)
- anchors must describe observable therapist behavior in the response (not internal states)`;
    const originalPrompt = `You are a content-to-JSON generator for a psychotherapy deliberate-practice platform.

You will be given source material (free text and/or notes). Your job is to produce an ORIGINAL deliberate-practice task INSPIRED BY the material, but rewritten in your own words.

CRITICAL OUTPUT RULE:
- Return STRICT JSON ONLY that matches the required schema. No markdown. No commentary. No trailing commas. No extra keys.

COPYRIGHT-SAFER / ORIGINALITY RULES:
- Do NOT quote the source material.
- Do NOT reuse distinctive phrases or long sequences from the source.
- Do NOT closely paraphrase sentence-by-sentence.
- Instead: distill the underlying ideas and recreate them in fresh language and structure.
- Patient examples must be newly written and not derived verbatim from the source.

CONTENT RULES:
- Preserve meaning at a high level (topic, skill focus, intent) but make the wording original.
- Do not invent specific claims that are not implied by the source; keep it clinically plausible and generic when uncertain.
- If the source is incomplete or vague, fill gaps conservatively and keep claims general.
- If a field is not supported, use null (not empty string) or [] for arrays.

TASK CONSTRUCTION REQUIREMENTS:
- Provide a task with: title, description, skill_domain, base_difficulty (1..5), general_objective, tags.
- Every item that can be graded MUST be represented as a criterion with an explicit rubric.
- Provide patient text examples with difficulty 1..5.

ID REQUIREMENTS:
- criterion ids: "c1", "c2", ...
- example ids: "ex1", "ex2", ...

RUBRIC REQUIREMENTS (for each criterion):
- score_min must be 0, score_max must be 4
- provide anchors for 0, 2, 4 at minimum (you may add 1 and 3 if helpful)
- anchors must describe observable therapist behavior in the response (not internal states)

LANGUAGE:
- Keep the generated content in the same language as the source when possible.
- Also set the task language field accordingly (see schema).`;
    const partialPromptPrompt = `You are a task generation engine for a psychotherapy deliberate-practice platform.
The user input is an instruction prompt for creating a NEW deliberate-practice task (not source material to extract or paraphrase).

Output constraints:
- Return STRICT JSON ONLY that matches the required schema. No markdown. No commentary. No trailing commas. No extra keys.
- Use null for unknown fields, and [] for empty arrays.
- Keep content clinically plausible and conservative when details are missing.
- Include a task, criteria with rubrics, and patient examples.
- Include top-level "version": "2.1".
- Create stable ids:
  - criterion ids: "c1", "c2", ...
  - example ids: "ex1", "ex2", ...

Criteria requirements:
- Each criterion must include a rubric.
- score_min must be 0, score_max must be 4.
- Provide anchors for scores 0, 2, 4 at minimum (1 and 3 optional).
- Anchors must describe observable therapist behavior.
- If the prompt does not specify a number of criteria, produce 4–6 criteria.

Examples requirements:
- Generate patient examples as short statements.
- If the user requests N examples (e.g., "generate 10 valid examples"), output exactly N examples.
- Otherwise, default to 5 examples.
- Difficulties must be integers 1..5.
- For N > 5, distribute difficulties roughly evenly across 1..5 (cycle 1..5 as needed).

Language:
- Generate content in the language implied by the prompt and set task.language accordingly.

The following is an example of valid output structure. Do not copy its content unless requested. Do not output the example.
{
  "version": "2.1",
  "task": {
    "title": "Limited Reparenting",
    "description": "Practice offering warmth, validation, and appropriate nurturance while maintaining clear therapeutic boundaries and fostering autonomy.",
    "skill_domain": "Schema Therapy",
    "base_difficulty": 3,
    "general_objective": "Offer emotionally attuned support, name the unmet need, provide a bounded dose of reassurance, and guide the client back to their Healthy Adult resources.",
    "tags": ["schema-therapy", "limited-reparenting", "boundaries", "attachment"],
    "language": "en"
  },
  "criteria": [
    {
      "id": "c1",
      "label": "Validate emotion and need",
      "description": "Accurately name the emotion and the underlying unmet need without minimizing or rushing to fix.",
      "rubric": {
        "score_min": 0,
        "score_max": 4,
        "anchors": [
          { "score": 0, "meaning": "Misses or dismisses the emotion/need." },
          { "score": 2, "meaning": "Names emotion or need partially, limited attunement." },
          { "score": 4, "meaning": "Clearly names emotion and unmet need with warmth and precision." }
        ]
      }
    },
    {
      "id": "c2",
      "label": "Provide bounded nurturance",
      "description": "Offer warmth/reassurance in a measured way that supports safety without fostering dependency.",
      "rubric": {
        "score_min": 0,
        "score_max": 4,
        "anchors": [
          { "score": 0, "meaning": "No warmth or reassurance; overly detached or overly rescuing." },
          { "score": 2, "meaning": "Some reassurance but unclear bounds." },
          { "score": 4, "meaning": "Warm, supportive reassurance with appropriate limits." }
        ]
      }
    }
  ],
  "examples": [
    { "id": "ex1", "difficulty": 1, "severity_label": "mild", "patient_text": "I keep second-guessing myself after our sessions. Part of me wishes you could just tell me I did it “right.”" },
    { "id": "ex2", "difficulty": 2, "severity_label": "moderate", "patient_text": "When I don’t hear back quickly, I start spiraling. I know you’re busy, but it feels like I don’t matter." },
    { "id": "ex3", "difficulty": 3, "severity_label": "moderate-high", "patient_text": "I’m embarrassed to say this, but I really need you to reassure me right now. If you can’t, I don’t know what I’ll do with these feelings." },
    { "id": "ex4", "difficulty": 4, "severity_label": "high", "patient_text": "I hate needing anyone. But I’m so alone this week that I caught myself thinking you’re the only safe person. Can we talk more often?" },
    { "id": "ex5", "difficulty": 5, "severity_label": "very high", "patient_text": "If you set limits with me, it feels like rejection. I get angry and then ashamed. I want you to promise you won’t leave, but I also hate myself for asking." }
  ]
}`;
    const systemPrompt =
      input.parseMode === "original"
        ? originalPrompt
        : input.parseMode === "partial_prompt"
          ? partialPromptPrompt
          : exactPrompt;
    try {
      const result = await createStructuredResponse<LlmParseResult>({
        apiKey,
        model: OPENAI_LLM_MODEL,
        temperature: 0.2,
        instructions: systemPrompt,
        input: input.sourceText,
        schemaName: "DeliberatePracticeTask",
        schema: llmParseSchema
      });
      logger?.("info", "llm.parse.http_ok", {
        provider: { kind: "openai", model: OPENAI_LLM_MODEL },
        duration_ms: Date.now() - start,
        response_id: result.responseId
      });
      return result.value;
    } catch (error) {
      logger?.("error", "llm.parse.http_error", {
        provider: { kind: "openai", model: OPENAI_LLM_MODEL },
        duration_ms: Date.now() - start,
        error: safeTruncate(String(error), 200)
      });
      throw error;
    }
  },
  translateTask: async ({
    source,
    targetLanguage
  }): Promise<DeliberatePracticeTaskV2> => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const start = Date.now();
    logger?.("info", "llm.translate.http_start", {
      provider: { kind: "openai", model: OPENAI_LLM_MODEL },
      target_language: targetLanguage
    });
    const systemPrompt = `You are a meticulous translation engine for psychotherapy deliberate-practice tasks.
Translate the provided JSON into ${targetLanguage}.
Return STRICT JSON ONLY that matches the DeliberatePracticeTaskV2 schema. No markdown. No commentary. No trailing commas. No extra keys.

Translation rules:
- Translate all human-readable strings: task title, description, skill_domain, general_objective, tags, criterion label/description, rubric anchors, example patient_text, severity_label.
- Preserve all ids and numeric values exactly as provided.
- Do NOT reorder arrays.
- Set task.language and each example.language to "${targetLanguage}".`;
    try {
      const result = await createStructuredResponse<DeliberatePracticeTaskV2>({
        apiKey,
        model: OPENAI_LLM_MODEL,
        temperature: 0.2,
        instructions: systemPrompt,
        input: JSON.stringify(source),
        schemaName: "DeliberatePracticeTaskV2",
        schema: deliberatePracticeTaskV2Schema
      });
      logger?.("info", "llm.translate.http_ok", {
        provider: { kind: "openai", model: OPENAI_LLM_MODEL },
        duration_ms: Date.now() - start,
        response_id: result.responseId
      });
      return result.value;
    } catch (error) {
      logger?.("error", "llm.translate.http_error", {
        provider: { kind: "openai", model: OPENAI_LLM_MODEL },
        duration_ms: Date.now() - start,
        error: safeTruncate(String(error), 200)
      });
      throw error;
    }
  }
});
