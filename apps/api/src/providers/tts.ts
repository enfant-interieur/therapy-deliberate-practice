import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { OPENAI_TTS_FORMAT, OPENAI_TTS_MODEL } from "./models";
import { BaseTtsProvider } from "./base";
import { synthesizeWithOpenAI } from "./openaiTts";

export type TtsFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";

export type TtsProvider = {
  kind: "local" | "openai";
  model: string;
  voice: string;
  format: TtsFormat;
  healthCheck: () => Promise<boolean>;
  synthesize: (input: { text: string }) => Promise<{ bytes: Uint8Array; contentType: string }>;
};

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const formatContentType: Record<TtsFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm"
};

class LocalTtsProviderImpl extends BaseTtsProvider {
  readonly voice: string;
  readonly format: TtsFormat;

  constructor(private env: RuntimeEnv, logger?: LogFn) {
    super("local", env.localTtsModel, logger);
    this.voice = env.localTtsVoice;
    this.format = env.localTtsFormat;
  }

  healthCheck() {
    return healthCheck(this.env.localTtsUrl);
  }

  protected async doSynthesize(input: { text: string }) {
    const response = await fetch(`${this.env.localTtsUrl}/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        model: this.env.localTtsModel,
        voice: this.env.localTtsVoice,
        format: this.env.localTtsFormat
      })
    });

    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      throw new Error(`Local TTS failed (${response.status}): ${body}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? formatContentType[this.format];
    return { value: { bytes, contentType }, log: { bytes: bytes.length } };
  }
}

class OpenAITtsProviderImpl extends BaseTtsProvider {
  readonly voice: string;
  readonly format: TtsFormat;
  private readonly instructions?: string;

  constructor(
    private apiKey: string,
    config: { model?: string; voice?: string; format?: TtsFormat; instructions?: string } = {},
    logger?: LogFn
  ) {
    super("openai", config.model ?? OPENAI_TTS_MODEL, logger);
    this.voice = config.voice ?? "marin";
    this.format = config.format ?? OPENAI_TTS_FORMAT;
    this.instructions = config.instructions;
  }

  healthCheck() {
    return Promise.resolve(Boolean(this.apiKey));
  }

  async synthesize(input: { text: string }) {
    return this.runWithTelemetry("tts.synthesize", () => this.doSynthesize(input), {
      startFields: {
        text_length: input.text.length,
        ...(this.instructions ? { instructions_length: this.instructions.length } : {})
      }
    });
  }

  protected async doSynthesize(input: { text: string }) {
    const result = await synthesizeWithOpenAI({
      apiKey: this.apiKey,
      model: this.model ?? OPENAI_TTS_MODEL,
      voice: this.voice,
      format: this.format,
      text: input.text,
      ...(this.instructions ? { instructions: this.instructions } : {})
    });
    return {
      value: { bytes: result.bytes, contentType: result.contentType },
      requestId: result.requestId,
      log: { bytes: result.bytes.length }
    };
  }
}

export const LocalTtsProvider = (env: RuntimeEnv, logger?: LogFn): TtsProvider =>
  new LocalTtsProviderImpl(env, logger);

export const OpenAITtsProvider = (
  {
    apiKey,
    model = OPENAI_TTS_MODEL,
    voice = "marin",
    format = OPENAI_TTS_FORMAT,
    instructions
  }: { apiKey: string; model?: string; voice?: string; format?: TtsFormat; instructions?: string },
  logger?: LogFn
): TtsProvider => new OpenAITtsProviderImpl(apiKey, { model, voice, format, instructions }, logger);
