import type { LlmProvider, EvaluationInput, EvaluationResult } from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";

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
  }
});

export const OpenAILlmProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn
): LlmProvider => ({
  kind: "openai",
  model: "gpt-4o-mini",
  healthCheck: async () => Boolean(apiKey),
  evaluateDeliberatePractice: async (input: EvaluationInput) => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const start = Date.now();
    logger?.("info", "llm.evaluate.http_start", {
      provider: { kind: "openai", model: "gpt-4o-mini" }
    });
    const systemPrompt =
      "You are an evaluator for psychotherapy deliberate practice. Return strict JSON only that matches EvaluationResult.";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: JSON.stringify(input)
          }
        ]
      })
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "llm.evaluate.http_error", {
        provider: { kind: "openai", model: "gpt-4o-mini" },
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`OpenAI LLM failed (${response.status})`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    logger?.("info", "llm.evaluate.http_ok", {
      provider: { kind: "openai", model: "gpt-4o-mini" },
      duration_ms: Date.now() - start
    });
    try {
      return JSON.parse(content) as EvaluationResult;
    } catch (error) {
      logger?.("error", "llm.evaluate.parse_error", {
        provider: { kind: "openai", model: "gpt-4o-mini" },
        preview: safeTruncate(String(content ?? ""), 200)
      });
      throw error;
    }
  }
});
