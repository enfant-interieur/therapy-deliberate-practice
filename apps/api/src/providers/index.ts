import type { LlmProvider, SttProvider } from "@deliberate/shared";
import type { ProviderMode, RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { LocalMlxLlmProvider, OpenAILlmProvider } from "./llm";
import { LocalWhisperSttProvider, OpenAISttProvider } from "./stt";
import { LocalTtsProvider, OpenAITtsProvider, type TtsProvider } from "./tts";

export type ProviderSelection<T> = {
  provider: T;
  health: {
    local: boolean;
    openai: boolean;
  };
};

export const selectSttProvider = async (
  mode: ProviderMode,
  env: RuntimeEnv,
  openaiApiKey: string,
  logger?: LogFn
): Promise<ProviderSelection<SttProvider>> => {
  const local = LocalWhisperSttProvider(env, logger);
  const cloud = OpenAISttProvider({ apiKey: openaiApiKey }, logger);
  const localOk = await local.healthCheck();
  const openaiOk = await cloud.healthCheck();
  logger?.("info", "stt.health", { local_ok: localOk, openai_ok: openaiOk, mode });

  if (mode === "local_only") {
    if (!localOk) {
      throw new Error("Local STT unavailable");
    }
    return { provider: local, health: { local: localOk, openai: openaiOk } };
  }

  if (mode === "openai_only") {
    if (!openaiOk) {
      throw new Error("OpenAI STT unavailable");
    }
    return { provider: cloud, health: { local: localOk, openai: openaiOk } };
  }

  if (localOk) {
    return { provider: local, health: { local: localOk, openai: openaiOk } };
  }
  if (openaiOk) {
    return { provider: cloud, health: { local: localOk, openai: openaiOk } };
  }
  throw new Error("No STT provider available");
};

export const selectLlmProvider = async (
  mode: ProviderMode,
  env: RuntimeEnv,
  openaiApiKey: string,
  logger?: LogFn
): Promise<ProviderSelection<LlmProvider>> => {
  const local = LocalMlxLlmProvider(env, logger);
  const cloud = OpenAILlmProvider({ apiKey: openaiApiKey }, logger);
  const localOk = await local.healthCheck();
  const openaiOk = await cloud.healthCheck();
  logger?.("info", "llm.health", { local_ok: localOk, openai_ok: openaiOk, mode });

  if (mode === "local_only") {
    if (!localOk) {
      throw new Error("Local LLM unavailable");
    }
    return { provider: local, health: { local: localOk, openai: openaiOk } };
  }

  if (mode === "openai_only") {
    if (!openaiOk) {
      throw new Error("OpenAI LLM unavailable");
    }
    return { provider: cloud, health: { local: localOk, openai: openaiOk } };
  }

  if (localOk) {
    return { provider: local, health: { local: localOk, openai: openaiOk } };
  }
  if (openaiOk) {
    return { provider: cloud, health: { local: localOk, openai: openaiOk } };
  }
  throw new Error("No LLM provider available");
};

export const selectTtsProvider = async (
  mode: ProviderMode,
  env: RuntimeEnv,
  openaiApiKey: string,
  logger?: LogFn
): Promise<ProviderSelection<TtsProvider>> => {
  const local = LocalTtsProvider(env, logger);
  const cloud = OpenAITtsProvider(
    {
      apiKey: openaiApiKey,
      model: env.openaiTtsModel,
      voice: env.openaiTtsVoice,
      format: env.openaiTtsFormat,
      instructions: env.openaiTtsInstructions
    },
    logger
  );
  const localOk = await local.healthCheck();
  const openaiOk = await cloud.healthCheck();
  logger?.("info", "tts.health", { local_ok: localOk, openai_ok: openaiOk, mode });

  if (mode === "local_only") {
    if (!localOk) {
      throw new Error("Local TTS unavailable");
    }
    return { provider: local, health: { local: localOk, openai: openaiOk } };
  }

  if (mode === "openai_only") {
    if (!openaiOk) {
      throw new Error("OpenAI TTS unavailable");
    }
    return { provider: cloud, health: { local: localOk, openai: openaiOk } };
  }

  if (localOk) {
    return { provider: local, health: { local: localOk, openai: openaiOk } };
  }
  if (openaiOk) {
    return { provider: cloud, health: { local: localOk, openai: openaiOk } };
  }
  throw new Error("No TTS provider available");
};
