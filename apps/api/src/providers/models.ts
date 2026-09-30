import { CLOUD_MODEL_ROLES } from "@deliberate/shared";
export const OPENAI_LLM_MODEL = CLOUD_MODEL_ROLES.reasoning;
export const OPENAI_FAST_MODEL = CLOUD_MODEL_ROLES.routine;

// Budgets include reasoning tokens. Failure never downgrades an evaluator.
export const CLOUD_LLM_POLICIES = {
  evaluation: {
    model: OPENAI_LLM_MODEL,
    reasoningEffort: "xhigh",
    maxOutputTokens: 16_384,
    timeoutMs: 180_000,
  },
  generation: {
    model: OPENAI_LLM_MODEL,
    reasoningEffort: "xhigh",
    maxOutputTokens: 24_576,
    timeoutMs: 180_000,
  },
  clinicalTranslation: {
    model: OPENAI_LLM_MODEL,
    reasoningEffort: "xhigh",
    maxOutputTokens: 16_384,
    timeoutMs: 180_000,
  },
  translation: {
    model: OPENAI_FAST_MODEL,
    reasoningEffort: "none",
    maxOutputTokens: 8_192,
    timeoutMs: 60_000,
  },
  segmentation: {
    model: OPENAI_FAST_MODEL,
    reasoningEffort: "none",
    maxOutputTokens: 8_192,
    timeoutMs: 60_000,
  },
} as const;
export const OPENAI_STT_MODEL = CLOUD_MODEL_ROLES.transcription;
export const OPENAI_TTS_MODEL = CLOUD_MODEL_ROLES.speech;
export const OPENAI_TTS_FORMAT = "mp3";
export const OPENAI_TTS_INSTRUCTIONS = "Talking to a friend"; //"Speak like a patient in a therapy session.";
