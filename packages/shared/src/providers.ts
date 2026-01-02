import type { DeliberatePracticeTaskV2, EvaluationResult, EvaluationInput, ParseMode } from "./types";
import type { LlmParseResult } from "./schemas";

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
  model?: "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" | "gpt-4o-transcribe-diarize" | "whisper-1";
  responseFormat?: "json" | "text" | "diarized_json";
  prompt?: string;
  chunkingStrategy?: "auto" | string;
  knownSpeakerNames?: string[];
  knownSpeakerReferences?: string[];
};

export type SttProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  transcribe: (audio: string, opts?: SttTranscribeOptions) => Promise<Transcript>;
};

export type LlmProvider = {
  kind: "local" | "openai";
  model?: string;
  healthCheck: () => Promise<boolean>;
  evaluateDeliberatePractice: (input: EvaluationInput) => Promise<EvaluationResult>;
  parseExercise: (input: { sourceText: string; parseMode?: ParseMode }) => Promise<LlmParseResult>;
  translateTask: (input: {
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }) => Promise<DeliberatePracticeTaskV2>;
};
