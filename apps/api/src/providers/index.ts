import type { LlmProvider, SttProvider } from "@deliberate/shared";
import type { ProviderMode, RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { LocalMlxLlmProvider, OpenAILlmProvider } from "./llm";
import { LocalWhisperSttProvider, OpenAISttProvider } from "./stt";

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
