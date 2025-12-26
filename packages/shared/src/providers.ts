import { EvaluationResult, EvaluationInput } from "./types";

export type Transcript = {
  text: string;
  confidence?: number;
  words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
};

export type SttProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  transcribe: (audio: string, opts?: { language?: string }) => Promise<Transcript>;
};

export type LlmProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  evaluateDeliberatePractice: (input: EvaluationInput) => Promise<EvaluationResult>;
};
