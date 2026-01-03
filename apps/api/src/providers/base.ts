import type { LogFields, LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import type {
  DeliberatePracticeTaskV2,
  EvaluationInput,
  EvaluationResult,
  LlmParseResult,
  ParseMode,
  SttProvider,
  LlmProvider,
  SttTranscribeOptions,
  Transcript
} from "@deliberate/shared";
import type { TtsProvider } from "./tts";
import { getErrorLogFields, getErrorRequestId } from "./providerErrors";

export type ProviderKind = "local" | "openai";

type TelemetryResult<T> = {
  value: T;
  requestId?: string;
  log?: LogFields;
};

type TelemetryOptions = {
  provider?: { kind: ProviderKind; model?: string };
  startFields?: LogFields;
};

export abstract class BaseProvider {
  protected readonly kind: ProviderKind;
  protected readonly model?: string;
  protected readonly logger?: LogFn;

  protected constructor(kind: ProviderKind, model?: string, logger?: LogFn) {
    this.kind = kind;
    this.model = model;
    this.logger = logger;
  }

  protected providerMeta(override?: { kind: ProviderKind; model?: string }) {
    return override ?? { kind: this.kind, ...(this.model ? { model: this.model } : {}) };
  }

  protected async runWithTelemetry<T>(
    opName: string,
    fn: () => Promise<TelemetryResult<T>>,
    options: TelemetryOptions = {}
  ): Promise<T> {
    const provider = this.providerMeta(options.provider);
    const startFields = options.startFields ?? {};
    const start = Date.now();

    this.logger?.("info", `${opName}.http_start`, {
      provider,
      ...startFields
    });

    try {
      const result = await fn();
      this.logger?.("info", `${opName}.http_ok`, {
        provider,
        duration_ms: Date.now() - start,
        ...(result.requestId ? { request_id: result.requestId } : {}),
        ...(result.log ?? {})
      });
      return result.value;
    } catch (error) {
      const requestId = getErrorRequestId(error);
      const logFields = getErrorLogFields(error);
      this.logger?.("error", `${opName}.http_error`, {
        provider,
        duration_ms: Date.now() - start,
        ...startFields,
        ...(requestId ? { request_id: requestId } : {}),
        ...(logFields ?? {}),
        error: safeTruncate(String(error), 200)
      });
      throw error;
    }
  }
}

export abstract class BaseSttProvider extends BaseProvider implements SttProvider {
  abstract healthCheck(): Promise<boolean>;
  async transcribe(audio: string, opts?: SttTranscribeOptions): Promise<Transcript> {
    return this.runWithTelemetry("stt.transcribe", () => this.doTranscribe(audio, opts), {
      startFields: this.getStartFields(opts),
      provider: this.getProviderOverride(opts)
    });
  }

  protected getProviderOverride(_opts?: SttTranscribeOptions):
    | { kind: ProviderKind; model?: string }
    | undefined {
    return undefined;
  }

  protected getStartFields(_opts?: SttTranscribeOptions): LogFields | undefined {
    return undefined;
  }

  protected abstract doTranscribe(
    audio: string,
    opts?: SttTranscribeOptions
  ): Promise<TelemetryResult<Transcript>>;
}

export abstract class BaseTtsProvider extends BaseProvider implements TtsProvider {
  abstract healthCheck(): Promise<boolean>;
  abstract voice: string;
  abstract format: TtsProvider["format"];

  async synthesize(input: { text: string }) {
    return this.runWithTelemetry("tts.synthesize", () => this.doSynthesize(input), {
      startFields: {
        text_length: input.text.length
      }
    });
  }

  protected abstract doSynthesize(input: {
    text: string;
  }): Promise<TelemetryResult<{ bytes: Uint8Array; contentType: string }>>;
}

export abstract class BaseLlmProvider extends BaseProvider implements LlmProvider {
  abstract healthCheck(): Promise<boolean>;

  async evaluateDeliberatePractice(input: EvaluationInput): Promise<EvaluationResult> {
    return this.runWithTelemetry("llm.evaluate", () => this.doEvaluateDeliberatePractice(input));
  }

  async parseExercise(input: { sourceText: string; parseMode?: ParseMode }): Promise<LlmParseResult> {
    return this.runWithTelemetry("llm.parse", () => this.doParseExercise(input));
  }

  async translateTask(input: {
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }): Promise<DeliberatePracticeTaskV2> {
    return this.runWithTelemetry("llm.translate", () => this.doTranslateTask(input), {
      startFields: { target_language: input.targetLanguage }
    });
  }

  protected abstract doEvaluateDeliberatePractice(
    input: EvaluationInput
  ): Promise<TelemetryResult<EvaluationResult>>;
  protected abstract doParseExercise(input: {
    sourceText: string;
    parseMode?: ParseMode;
  }): Promise<TelemetryResult<LlmParseResult>>;
  protected abstract doTranslateTask(input: {
    source: DeliberatePracticeTaskV2;
    targetLanguage: string;
  }): Promise<TelemetryResult<DeliberatePracticeTaskV2>>;
}
