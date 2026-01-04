import type {
  LlmProvider,
  EvaluationInput,
  EvaluationResult,
  LlmParseResult,
  DeliberatePracticeTaskV2,
  ParseMode
} from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { deliberatePracticeTaskV2Schema, evaluationResultSchema, llmParseSchema } from "@deliberate/shared";
import { createStructuredResponse } from "./openaiResponses";
import { OPENAI_LLM_MODEL } from "./models";
import { BaseLlmProvider } from "./base";

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

class LocalMlxLlmProviderImpl extends BaseLlmProvider {
  constructor(private env: RuntimeEnv, logger?: LogFn) {
    super("local", env.localLlmModel, logger);
  }

  healthCheck() {
    return healthCheck(this.env.localLlmUrl);
  }

  protected async doEvaluateDeliberatePractice(input: EvaluationInput) {
    const response = await fetch(`${this.env.localLlmUrl}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      throw new Error(`Local LLM failed (${response.status}): ${body}`);
    }
    return { value: (await response.json()) as EvaluationResult };
  }

  protected async doParseExercise(_input: { sourceText: string; parseMode?: ParseMode }) {
    throw new Error("Local LLM does not support task parsing.");
  }

  protected async doTranslateTask(_input: {
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }) {
    throw new Error("Local LLM does not support task translation.");
  }
}

class OpenAILlmProviderImpl extends BaseLlmProvider {
  constructor(private apiKey: string, logger?: LogFn) {
    super("openai", OPENAI_LLM_MODEL, logger);
  }

  healthCheck() {
    return Promise.resolve(Boolean(this.apiKey));
  }

  protected async doEvaluateDeliberatePractice(input: EvaluationInput) {
    const systemPrompt =
      "You are an evaluator for psychotherapy deliberate practice tasks. Return strict JSON only that matches EvaluationResult with criterion_scores.";
    const result = await createStructuredResponse<EvaluationResult>({
      apiKey: this.apiKey,
      model: OPENAI_LLM_MODEL,
      temperature: 0.2,
      instructions: systemPrompt,
      input: JSON.stringify(input),
      schemaName: "EvaluationResult",
      schema: evaluationResultSchema
    });
    return {
      value: result.value,
      requestId: result.responseId
    };
  }

  protected async doParseExercise(input: {
    sourceText: string;
    parseMode?: ParseMode;
  }): Promise<{ value: LlmParseResult; requestId?: string }> {
    const exactPrompt = `You are a meticulous content-to-JSON extractor for a psychotherapy deliberate-practice platform.
Your ONLY job is to transform the provided free text into a single JSON object that matches the schema.
Return STRICT JSON ONLY. No markdown. No commentary. No trailing commas. No extra keys.

Hard rules:
- Preserve meaning; you may rewrite for clarity but do not invent facts not present in the text.
- If a field is not present, use null (not empty string) or [] for arrays.
- Every item that can be graded MUST be represented as a criterion with an explicit rubric.
- Provide a list of patient text examples (short statements) with difficulty 1..5.
- Provide 2–3 interaction_examples with a single patient statement and a single therapist response.
- Set task.language to the detected source language (e.g., "en" or "fr").
- Create stable ids:
  - criterion ids: "c1", "c2", ...
  - example ids: "ex1", "ex2", ...
  - interaction_examples ids: "ix1", "ix2", ...

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
- Provide 2–3 interaction_examples with a single patient statement and a single therapist response.

ID REQUIREMENTS:
- criterion ids: "c1", "c2", ...
- example ids: "ex1", "ex2", ...
- interaction_examples ids: "ix1", "ix2", ...

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
- Include interaction_examples with a single patient statement and a single therapist response.
- Include top-level "version": "2.1".
- Create stable ids:
  - criterion ids: "c1", "c2", ...
  - example ids: "ex1", "ex2", ...
  - interaction_examples ids: "ix1", "ix2", ...

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

Interaction examples requirements:
- Generate 2–3 interaction_examples by default unless the user specifies another number.
- Each interaction example contains exactly one patient_text and one therapist_text (no multi-turn threads).
- Therapist responses should be exemplary and aligned with the task criteria.

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
  ],
  "interaction_examples": [
    {
      "id": "ix1",
      "difficulty": 2,
      "title": "Warmth with limits",
      "patient_text": "I just want you to tell me I’m okay right now.",
      "therapist_text": "I hear how much you want reassurance in this moment, and it makes sense that this feels urgent. I care about you and I want you to feel steadier. I also want us to build your own soothing skills so you don’t have to rely only on me. Let’s take one slow breath together and name what the younger part of you is needing right now. Then we can choose one small, kind thing you can do for yourself after session. I’m here with you in this, and I believe you can practice that Healthy Adult support."
    },
    {
      "id": "ix2",
      "difficulty": 3,
      "title": null,
      "patient_text": "Can we add another session this week? I don’t think I can handle it otherwise.",
      "therapist_text": "It sounds like you’re feeling really alone and overwhelmed, and that makes the request for more contact feel important. I want to respond with care, while keeping our boundaries clear. We can’t add extra sessions this week, but we can plan for support that helps you feel held between sessions. Let’s identify the hardest time of day and choose a grounding routine you can practice, plus one person or resource you can lean on. We’ll also check in next session about how that went."
    }
  ]
}`;
    const systemPrompt =
      input.parseMode === "original"
        ? originalPrompt
        : input.parseMode === "partial_prompt"
          ? partialPromptPrompt
          : exactPrompt;
    const result = await createStructuredResponse<LlmParseResult>({
      apiKey: this.apiKey,
      model: OPENAI_LLM_MODEL,
      temperature: 0.2,
      instructions: systemPrompt,
      input: input.sourceText,
      schemaName: "DeliberatePracticeTask",
      schema: llmParseSchema
    });
    return { value: result.value, requestId: result.responseId };
  }

  protected async doTranslateTask({
    source,
    targetLanguage
  }: {
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }): Promise<{ value: DeliberatePracticeTaskV2; requestId?: string }> {
    const systemPrompt = `You are a meticulous translation engine for psychotherapy deliberate-practice tasks.
Translate the provided JSON into ${targetLanguage}.
Return STRICT JSON ONLY that matches the DeliberatePracticeTaskV2 schema. No markdown. No commentary. No trailing commas. No extra keys.

Translation rules:
- Translate all human-readable strings: task title, description, skill_domain, general_objective, tags, criterion label/description, rubric anchors, example patient_text, severity_label, interaction example title/patient_text/therapist_text.
- Preserve all ids and numeric values exactly as provided.
- Do NOT reorder arrays.
- Set task.language and each example.language to "${targetLanguage}".`;
    const result = await createStructuredResponse<DeliberatePracticeTaskV2>({
      apiKey: this.apiKey,
      model: OPENAI_LLM_MODEL,
      temperature: 0.2,
      instructions: systemPrompt,
      input: JSON.stringify(source),
      schemaName: "DeliberatePracticeTaskV2",
      schema: deliberatePracticeTaskV2Schema
    });
    return { value: result.value, requestId: result.responseId };
  }
}

export const LocalMlxLlmProvider = (env: RuntimeEnv, logger?: LogFn): LlmProvider =>
  new LocalMlxLlmProviderImpl(env, logger);

export const OpenAILlmProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn
): LlmProvider => new OpenAILlmProviderImpl(apiKey, logger);
