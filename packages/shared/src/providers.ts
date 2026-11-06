import type {
  DeliberatePracticeTaskV2,
  EvaluationResult,
  EvaluationInput,
  ParseMode,
} from "./types";
import type { LlmParseResult } from "./schemas";

export const CLOUD_MODEL_ROLES = {
  reasoning: "gpt-6.1-sol",
  routine: "gpt-6-luna",
  transcription: "gpt-transcribe",
  speech: "gpt-realtime-2.1-mini",
} as const;

// The requested successor is unavailable in the account/catalogue (2026-11-06).
// Keep the actual available routine model accurately named; never relabel or silently
// route a request for 6.1 Luna to another model.
export const REQUESTED_ROUTINE_MODEL = "gpt-6.1-luna";
export const REQUESTED_ROUTINE_MODEL_AVAILABLE = false;

export type TranscriptSegment = {
  text: string;
  [key: string]: unknown;
};

export type Transcript = {
  text: string;
  confidence?: number;
  words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
  segments?: TranscriptSegment[];
};

export type SttTranscribeOptions = {
  language?: string;
  mimeType?: string;
  model?:
    | "gpt-transcribe"
    | "gpt-4o-mini-transcribe"
    | "gpt-4o-transcribe"
    | "gpt-4o-transcribe-diarize"
    | "whisper-1";
  responseFormat?: "json" | "text" | "diarized_json";
  prompt?: string;
  chunkingStrategy?: "auto";
  knownSpeakerNames?: string[];
  knownSpeakerReferences?: string[];
};

export type SttProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  transcribe: (
    audio: string,
    opts?: SttTranscribeOptions,
  ) => Promise<Transcript>;
};

export type LlmProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  evaluateDeliberatePractice: (
    input: EvaluationInput,
  ) => Promise<EvaluationResult>;
  parseExercise: (input: {
    sourceText: string;
    parseMode?: ParseMode;
  }) => Promise<LlmParseResult>;
  translateTask: (input: {
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }) => Promise<DeliberatePracticeTaskV2>;
};
