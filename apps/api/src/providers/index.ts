import type { LlmProvider, SttProvider } from "@deliberate/shared";
import type { LogFn } from "../utils/logger";
import { OpenAILlmProvider } from "./llm";
import { OpenAISttProvider } from "./stt";
import { OpenAITtsProvider, type TtsProvider, type TtsFormat } from "./tts";
import { assertOpenAiKey, type EffectiveAiConfig } from "./config";
import { ProviderConfigError } from "./providerErrors";

export type ProviderSelection<T> = {
  provider: T;
  health: {
    local: boolean;
    openai: boolean;
  };
};

export const selectSttProvider = async (
  config: EffectiveAiConfig,
  logger?: LogFn,
): Promise<ProviderSelection<SttProvider>> => {
  if (config.mode !== "openai_only") {
    throw new ProviderConfigError(
      "LOCAL_BROWSER_REQUIRED",
      "Local speech recognition runs directly between the browser and the desktop runtime.",
      409,
    );
  }
  assertOpenAiKey(config);
  const openaiProvider = config.openai.apiKey
    ? OpenAISttProvider({ apiKey: config.openai.apiKey }, logger)
    : null;
  const openaiOk = openaiProvider ? await openaiProvider.healthCheck() : false;
  logger?.("info", "stt.health", {
    local_ok: false,
    openai_ok: openaiOk,
    mode: config.mode,
  });
  if (!openaiOk) {
    throw new ProviderConfigError(
      "OPENAI_KEY_MISSING",
      "OpenAI STT is unavailable. Check your API key and try again.",
      400,
    );
  }
  return { provider: openaiProvider!, health: { local: false, openai: true } };
};

export const selectLlmProvider = async (
  config: EffectiveAiConfig,
  logger?: LogFn,
): Promise<ProviderSelection<LlmProvider>> => {
  if (config.mode !== "openai_only") {
    throw new ProviderConfigError(
      "LOCAL_BROWSER_REQUIRED",
      "Local evaluation runs directly between the browser and the desktop runtime.",
      409,
    );
  }
  assertOpenAiKey(config);
  const openaiProvider = config.openai.apiKey
    ? OpenAILlmProvider({ apiKey: config.openai.apiKey }, logger)
    : null;
  const openaiOk = openaiProvider ? await openaiProvider.healthCheck() : false;
  logger?.("info", "llm.health", {
    local_ok: false,
    openai_ok: openaiOk,
    mode: config.mode,
  });
  if (!openaiOk) {
    throw new ProviderConfigError(
      "OPENAI_KEY_MISSING",
      "OpenAI LLM is unavailable. Check your API key and try again.",
      400,
    );
  }
  return { provider: openaiProvider!, health: { local: false, openai: true } };
};

export const selectTtsProvider = async (
  config: EffectiveAiConfig,
  {
    openai,
  }: {
    openai: {
      model: string;
      voice: string;
      format: TtsFormat;
      instructions?: string;
    };
    local: { voice: string; format: TtsFormat };
  },
  logger?: LogFn,
): Promise<ProviderSelection<TtsProvider>> => {
  if (config.mode !== "openai_only") {
    throw new ProviderConfigError(
      "LOCAL_BROWSER_REQUIRED",
      "Local audio generation is not available through the hosted API.",
      409,
    );
  }
  assertOpenAiKey(config);
  const openaiProvider = config.openai.apiKey
    ? OpenAITtsProvider(
        {
          apiKey: config.openai.apiKey,
          model: openai.model,
          voice: openai.voice,
          format: openai.format,
          instructions: openai.instructions,
        },
        logger,
      )
    : null;
  const openaiOk = openaiProvider ? await openaiProvider.healthCheck() : false;
  logger?.("info", "tts.health", {
    local_ok: false,
    openai_ok: openaiOk,
    mode: config.mode,
  });
  if (!openaiOk) {
    throw new ProviderConfigError(
      "OPENAI_KEY_MISSING",
      "OpenAI TTS is unavailable. Check your API key and try again.",
      400,
    );
  }
  return { provider: openaiProvider!, health: { local: false, openai: true } };
};
