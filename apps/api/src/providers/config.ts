import type { RuntimeEnv, ProviderMode } from "../env";
import { ProviderConfigError } from "./providerErrors";

export type AiMode = ProviderMode;

export type EffectiveAiConfig = {
  mode: AiMode;
  openai: {
    apiKey: string | null;
  };
  local: {
    baseUrl: string | null;
    sttUrl: string | null;
    llmUrl: string | null;
    apiPrefix: string;
  };
  resolvedFrom: {
    openaiKey: "user" | "env" | "none";
    localBaseUrl: "user" | "none";
  };
};

export type UserSettingsInput = {
  ai_mode?: ProviderMode | null;
  local_base_url?: string | null;
  local_stt_url?: string | null;
  local_llm_url?: string | null;
  openai_key_ciphertext?: string | null;
  openai_key_iv?: string | null;
};

type ResolveConfigInput = {
  env: RuntimeEnv;
  settings: UserSettingsInput;
  decryptOpenAiKey?: (
    secret: string,
    input: { ciphertextB64: string; ivB64: string }
  ) => Promise<string>;
};

const normalizeUrl = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const getOrigin = (value?: string | null) => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const deriveLocalBaseUrl = (localLlmUrl?: string | null, localSttUrl?: string | null) => {
  const llmOrigin = getOrigin(localLlmUrl);
  const sttOrigin = getOrigin(localSttUrl);
  if (llmOrigin && sttOrigin && llmOrigin !== sttOrigin) {
    return null;
  }
  return llmOrigin ?? sttOrigin ?? null;
};

export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8484";

export const resolveEffectiveAiConfig = async ({
  env,
  settings,
  decryptOpenAiKey
}: ResolveConfigInput): Promise<EffectiveAiConfig> => {
  const mode = (settings.ai_mode ?? env.aiMode) as AiMode;
  const localBaseSetting = normalizeUrl(settings.local_base_url);
  const localSttUrl = normalizeUrl(settings.local_stt_url);
  const localLlmUrl = normalizeUrl(settings.local_llm_url);
  const derivedBaseUrl = deriveLocalBaseUrl(localLlmUrl, localSttUrl);
  const localBaseUrl = localBaseSetting ?? derivedBaseUrl ?? DEFAULT_LOCAL_BASE_URL;

  let openaiKey: string | null = null;
  let openaiKeySource: EffectiveAiConfig["resolvedFrom"]["openaiKey"] = "none";
  if (settings.openai_key_ciphertext && settings.openai_key_iv) {
    if (!env.openaiKeyEncryptionSecret) {
      throw new ProviderConfigError(
        "OPENAI_KEY_SECRET_MISSING",
        "OPENAI_KEY_ENCRYPTION_SECRET is not configured.",
        500
      );
    }
    if (!decryptOpenAiKey) {
      throw new ProviderConfigError(
        "OPENAI_KEY_SECRET_MISSING",
        "OpenAI key decryptor is not configured.",
        500
      );
    }
    openaiKey = await decryptOpenAiKey(env.openaiKeyEncryptionSecret, {
      ciphertextB64: settings.openai_key_ciphertext,
      ivB64: settings.openai_key_iv
    });
    openaiKeySource = "user";
  } else if (env.openaiApiKey) {
    openaiKey = env.openaiApiKey;
    openaiKeySource = "env";
  }

  return {
    mode,
    openai: { apiKey: openaiKey },
    local: {
      baseUrl: localBaseUrl,
      sttUrl: localSttUrl,
      llmUrl: localLlmUrl,
      apiPrefix: "/v1"
    },
    resolvedFrom: {
      openaiKey: openaiKeySource,
      localBaseUrl: localBaseSetting ? "user" : "none"
    }
  };
};

export const assertOpenAiKey = (config: EffectiveAiConfig) => {
  if (config.mode === "openai_only" && !config.openai.apiKey) {
    throw new ProviderConfigError(
      "OPENAI_KEY_MISSING",
      "OpenAI mode requires an API key. Add one in Settings to continue.",
      400
    );
  }
};

export const assertLocalBaseUrl = (config: EffectiveAiConfig, overrideUrl?: string | null) => {
  const resolved = overrideUrl ?? config.local.baseUrl;
  if (config.mode === "local_only" && !resolved) {
    throw new ProviderConfigError(
      "LOCAL_BASE_URL_MISSING",
      "Local AI mode requires a local base URL. Update your Settings to continue.",
      400
    );
  }
};

export const buildEnvAiConfig = (env: RuntimeEnv, mode: AiMode = env.aiMode): EffectiveAiConfig => ({
  mode,
  openai: { apiKey: env.openaiApiKey || null },
  local: { baseUrl: DEFAULT_LOCAL_BASE_URL, sttUrl: null, llmUrl: null, apiPrefix: "/v1" },
  resolvedFrom: {
    openaiKey: env.openaiApiKey ? "env" : "none",
    localBaseUrl: "none"
  }
});
