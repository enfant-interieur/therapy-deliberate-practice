export type ProviderMode = "local_prefer" | "openai_only" | "local_only";

export type EnvBindings = {
  AI_MODE?: string;
  OPENAI_API_KEY?: string;
  ADMIN_TOKEN?: string;
  LOCAL_STT_URL?: string;
  LOCAL_LLM_URL?: string;
  LOCAL_LLM_MODEL?: string;
};

export type RuntimeEnv = {
  aiMode: ProviderMode;
  openaiApiKey: string;
  adminToken: string;
  localSttUrl: string;
  localLlmUrl: string;
  localLlmModel: string;
};

export type NodeRuntimeEnv = RuntimeEnv & {
  dbPath: string;
};

const normalizeMode = (value?: string): ProviderMode => {
  if (value === "openai_only" || value === "local_only") {
    return value;
  }
  return "local_prefer";
};

export const resolveEnv = (bindings: EnvBindings): RuntimeEnv => ({
  aiMode: normalizeMode(bindings.AI_MODE),
  openaiApiKey: bindings.OPENAI_API_KEY ?? "",
  adminToken: bindings.ADMIN_TOKEN ?? "",
  localSttUrl: bindings.LOCAL_STT_URL ?? "http://localhost:7001",
  localLlmUrl: bindings.LOCAL_LLM_URL ?? "http://localhost:7002",
  localLlmModel:
    bindings.LOCAL_LLM_MODEL ?? "mlx-community/Mistral-7B-Instruct-v0.2"
});

export const resolveNodeEnv = (): NodeRuntimeEnv => ({
  ...resolveEnv({
    AI_MODE: process.env.AI_MODE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ADMIN_TOKEN: process.env.ADMIN_TOKEN,
    LOCAL_STT_URL: process.env.LOCAL_STT_URL,
    LOCAL_LLM_URL: process.env.LOCAL_LLM_URL,
    LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL
  }),
  dbPath: process.env.DB_PATH ?? "./infra/local.db"
});
