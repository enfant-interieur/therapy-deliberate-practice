import type { EvaluationResult, EvaluationInput, ParseMode } from "./types";
import type { LlmParseResult } from "./schemas";

export type Transcript = {
  text: string;
  confidence?: number;
  words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
};

export type SttProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  transcribe: (
    audio: string,
    opts?: { language?: string; mimeType?: string }
  ) => Promise<Transcript>;
};

export type LlmProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  evaluateDeliberatePractice: (input: EvaluationInput) => Promise<EvaluationResult>;
  parseExercise: (input: { sourceText: string; parseMode?: ParseMode }) => Promise<LlmParseResult>;
};
