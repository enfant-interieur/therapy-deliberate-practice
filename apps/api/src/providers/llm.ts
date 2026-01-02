import type {
  LlmProvider,
  EvaluationInput,
  EvaluationResult,
  LlmParseResult
} from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { evaluationResultSchema, llmParseSchema } from "@deliberate/shared";
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
    const systemPrompt = input.parseMode === "original" ? originalPrompt : exactPrompt;
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
  }
});
