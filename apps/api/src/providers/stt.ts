import type { SttProvider, SttTranscribeOptions } from "@deliberate/shared";
import type { LogFn } from "../utils/logger";
import { OPENAI_STT_MODEL } from "./models";
import { BaseSttProvider } from "./base";
import { transcribeWithOpenAI } from "./openaiStt";

const resolveResponseFormat = (opts?: SttTranscribeOptions, model?: string) => {
  const resolvedModel = model ?? OPENAI_STT_MODEL;
  const isDiarize = resolvedModel === "gpt-4o-transcribe-diarize";
  return opts?.responseFormat ?? (isDiarize ? "diarized_json" : undefined);
};

class OpenAISttProviderImpl extends BaseSttProvider {
  constructor(
    private apiKey: string,
    logger?: LogFn,
  ) {
    super("openai", OPENAI_STT_MODEL, logger);
  }

  healthCheck() {
    return Promise.resolve(Boolean(this.apiKey));
  }

  protected getProviderOverride(opts?: SttTranscribeOptions) {
    const model = opts?.model ?? OPENAI_STT_MODEL;
    return { kind: "openai" as const, model };
  }

  protected getStartFields(opts?: SttTranscribeOptions) {
    const responseFormat = resolveResponseFormat(opts, opts?.model);
    const fields = {
      ...(opts?.model ? { model_override: opts.model } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  protected async doTranscribe(audio: string, opts?: SttTranscribeOptions) {
    const result = await transcribeWithOpenAI({
      apiKey: this.apiKey,
      audioBase64: audio,
      opts,
    });
    return { value: result.transcript, requestId: result.requestId };
  }
}

export const OpenAISttProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn,
): SttProvider => new OpenAISttProviderImpl(apiKey, logger);
