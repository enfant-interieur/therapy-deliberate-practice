import type { LlmProvider, SttProvider } from "@deliberate/shared";
import type { LogFn } from "../utils/logger";
import { LocalMlxLlmProvider, OpenAILlmProvider } from "./llm";
import { LocalWhisperSttProvider, OpenAISttProvider } from "./stt";
import { LocalTtsProvider, OpenAITtsProvider, type TtsProvider, type TtsFormat } from "./tts";
import { assertLocalBaseUrl, assertOpenAiKey, type EffectiveAiConfig } from "./config";
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
  logger?: LogFn
): Promise<ProviderSelection<SttProvider>> => {
  const sttUrl = config.local.baseUrl ?? config.local.sttUrl;
  const localProvider = sttUrl
    ? LocalWhisperSttProvider(sttUrl, logger)
    : null;
  const openaiProvider = config.openai.apiKey
    ? OpenAISttProvider({ apiKey: config.openai.apiKey }, logger)
    : null;
  const localOk = localProvider ? await localProvider.healthCheck() : false;
  const openaiOk = openaiProvider ? await openaiProvider.healthCheck() : false;
  logger?.("info", "stt.health", { local_ok: localOk, openai_ok: openaiOk, mode: config.mode });

  if (config.mode === "local_only") {
    assertLocalBaseUrl(config, sttUrl);
    if (!localOk) {
      throw new ProviderConfigError(
        "LOCAL_UNREACHABLE",
        "Local STT is unavailable. Check your local runtime and try again.",
        502
      );
    }
    return { provider: localProvider!, health: { local: localOk, openai: openaiOk } };
  }

  if (config.mode === "openai_only") {
    assertOpenAiKey(config);
    if (!openaiOk) {
      throw new ProviderConfigError(
        "OPENAI_KEY_MISSING",
        "OpenAI STT is unavailable. Check your API key and try again.",
        400
      );
    }
    return { provider: openaiProvider!, health: { local: localOk, openai: openaiOk } };
  }

  if (localOk) {
    return { provider: localProvider!, health: { local: localOk, openai: openaiOk } };
  }
  if (openaiOk) {
    return { provider: openaiProvider!, health: { local: localOk, openai: openaiOk } };
  }
  if (config.local.baseUrl) {
    throw new ProviderConfigError(
      "LOCAL_UNREACHABLE",
      "Local STT is unavailable and no OpenAI key is configured.",
      502
    );
  }
  throw new ProviderConfigError(
    "OPENAI_KEY_MISSING",
    "OpenAI mode requires an API key. Add one in Settings to continue.",
    400
  );
};

export const selectLlmProvider = async (
  config: EffectiveAiConfig,
  logger?: LogFn
): Promise<ProviderSelection<LlmProvider>> => {
  const llmUrl = config.local.baseUrl ?? config.local.llmUrl;
  const localProvider = llmUrl
    ? LocalMlxLlmProvider(llmUrl, logger)
    : null;
  const openaiProvider = config.openai.apiKey
    ? OpenAILlmProvider({ apiKey: config.openai.apiKey }, logger)
    : null;
  const localOk = localProvider ? await localProvider.healthCheck() : false;
  const openaiOk = openaiProvider ? await openaiProvider.healthCheck() : false;
  logger?.("info", "llm.health", { local_ok: localOk, openai_ok: openaiOk, mode: config.mode });

  if (config.mode === "local_only") {
    assertLocalBaseUrl(config, llmUrl);
    if (!localOk) {
      throw new ProviderConfigError(
        "LOCAL_UNREACHABLE",
        "Local LLM is unavailable. Check your local runtime and try again.",
        502
      );
    }
    return { provider: localProvider!, health: { local: localOk, openai: openaiOk } };
  }

  if (config.mode === "openai_only") {
    assertOpenAiKey(config);
    if (!openaiOk) {
      throw new ProviderConfigError(
        "OPENAI_KEY_MISSING",
        "OpenAI LLM is unavailable. Check your API key and try again.",
        400
      );
    }
    return { provider: openaiProvider!, health: { local: localOk, openai: openaiOk } };
  }

  if (localOk) {
    return { provider: localProvider!, health: { local: localOk, openai: openaiOk } };
  }
  if (openaiOk) {
    return { provider: openaiProvider!, health: { local: localOk, openai: openaiOk } };
  }
  if (config.local.baseUrl) {
    throw new ProviderConfigError(
      "LOCAL_UNREACHABLE",
      "Local LLM is unavailable and no OpenAI key is configured.",
      502
    );
  }
  throw new ProviderConfigError(
    "OPENAI_KEY_MISSING",
    "OpenAI mode requires an API key. Add one in Settings to continue.",
    400
  );
};

export const selectTtsProvider = async (
  config: EffectiveAiConfig,
  {
    openai,
    local
  }: {
    openai: {
      model: string;
      voice: string;
      format: TtsFormat;
      instructions?: string;
    };
    local: { voice: string; format: TtsFormat };
  },
  logger?: LogFn
): Promise<ProviderSelection<TtsProvider>> => {
  const localProvider = config.local.baseUrl
    ? LocalTtsProvider({ baseUrl: config.local.baseUrl, voice: local.voice, format: local.format }, logger)
    : null;
  const openaiProvider = config.openai.apiKey
    ? OpenAITtsProvider(
        {
          apiKey: config.openai.apiKey,
          model: openai.model,
          voice: openai.voice,
          format: openai.format,
          instructions: openai.instructions
        },
        logger
      )
    : null;
  const localOk = localProvider ? await localProvider.healthCheck() : false;
  const openaiOk = openaiProvider ? await openaiProvider.healthCheck() : false;
  logger?.("info", "tts.health", { local_ok: localOk, openai_ok: openaiOk, mode: config.mode });

  if (config.mode === "local_only") {
    assertLocalBaseUrl(config);
    if (!localOk) {
      throw new ProviderConfigError(
        "LOCAL_UNREACHABLE",
        "Local TTS is unavailable. Check your local runtime and try again.",
        502
      );
    }
    return { provider: localProvider!, health: { local: localOk, openai: openaiOk } };
  }

  if (config.mode === "openai_only") {
    assertOpenAiKey(config);
    if (!openaiOk) {
      throw new ProviderConfigError(
        "OPENAI_KEY_MISSING",
        "OpenAI TTS is unavailable. Check your API key and try again.",
        400
      );
    }
    return { provider: openaiProvider!, health: { local: localOk, openai: openaiOk } };
  }

  if (localOk) {
    return { provider: localProvider!, health: { local: localOk, openai: openaiOk } };
  }
  if (openaiOk) {
    return { provider: openaiProvider!, health: { local: localOk, openai: openaiOk } };
  }
  if (config.local.baseUrl) {
    throw new ProviderConfigError(
      "LOCAL_UNREACHABLE",
      "Local TTS is unavailable and no OpenAI key is configured.",
      502
    );
  }
  throw new ProviderConfigError(
    "OPENAI_KEY_MISSING",
    "OpenAI mode requires an API key. Add one in Settings to continue.",
    400
  );
};
