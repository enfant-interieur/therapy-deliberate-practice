import type { SttProvider, SttTranscribeOptions } from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { LOCAL_STT_MODEL, OPENAI_STT_MODEL } from "./models";
import { BaseSttProvider } from "./base";
import { transcribeWithOpenAI } from "./openaiStt";

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

class LocalWhisperSttProviderImpl extends BaseSttProvider {
  constructor(private env: RuntimeEnv, logger?: LogFn) {
    super("local", LOCAL_STT_MODEL, logger);
  }

  healthCheck() {
    return healthCheck(this.env.localSttUrl);
  }

  protected async doTranscribe(audio: string) {
    const response = await fetch(`${this.env.localSttUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio })
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      throw new Error(`Local STT failed (${response.status}): ${body}`);
    }
    return { value: await response.json() };
  }
}

const resolveResponseFormat = (opts?: SttTranscribeOptions, model?: string) => {
  const resolvedModel = model ?? OPENAI_STT_MODEL;
  const isDiarize = resolvedModel === "gpt-4o-transcribe-diarize";
  return opts?.responseFormat ?? (isDiarize ? "diarized_json" : undefined);
};

class OpenAISttProviderImpl extends BaseSttProvider {
  constructor(private apiKey: string, logger?: LogFn) {
    super("openai", OPENAI_STT_MODEL, logger);
  }

  healthCheck() {
    return Promise.resolve(Boolean(this.apiKey));
  }

  protected getProviderOverride(opts?: SttTranscribeOptions) {
    const model = opts?.model ?? OPENAI_STT_MODEL;
    return { kind: "openai", model };
  }

  protected getStartFields(opts?: SttTranscribeOptions) {
    const responseFormat = resolveResponseFormat(opts, opts?.model);
    const fields = {
      ...(opts?.model ? { model_override: opts.model } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {})
    };
    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  protected async doTranscribe(audio: string, opts?: SttTranscribeOptions) {
    const result = await transcribeWithOpenAI({
      apiKey: this.apiKey,
      audioBase64: audio,
      opts
    });
    return { value: result.transcript, requestId: result.requestId };
  }
}

export const LocalWhisperSttProvider = (env: RuntimeEnv, logger?: LogFn): SttProvider =>
  new LocalWhisperSttProviderImpl(env, logger);

export const OpenAISttProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn
): SttProvider => new OpenAISttProviderImpl(apiKey, logger);
