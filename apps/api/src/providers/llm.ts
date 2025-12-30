import type { LlmProvider, EvaluationInput, EvaluationResult } from "@deliberate/shared";
import type { RuntimeEnv } from "../env";

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

export const LocalMlxLlmProvider = (env: RuntimeEnv): LlmProvider => ({
  kind: "local",
  model: env.localLlmModel,
  healthCheck: () => healthCheck(env.localLlmUrl),
  evaluateDeliberatePractice: async (input) => {
    const response = await fetch(`${env.localLlmUrl}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      throw new Error("Local LLM failed");
    }
    return response.json();
  }
});

export const OpenAILlmProvider = (env: RuntimeEnv): LlmProvider => ({
  kind: "openai",
  model: "gpt-4o-mini",
  healthCheck: async () => Boolean(env.openaiApiKey),
  evaluateDeliberatePractice: async (input: EvaluationInput) => {
    if (!env.openaiApiKey) {
      throw new Error("OpenAI key missing");
    }
    const systemPrompt =
      "You are an evaluator for psychotherapy deliberate practice. Return strict JSON only that matches EvaluationResult.";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
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
      throw new Error("OpenAI LLM failed");
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return JSON.parse(content) as EvaluationResult;
  }
});
