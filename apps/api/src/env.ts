export type ProviderMode = "local_prefer" | "openai_only" | "local_only";

export type EnvBindings = {
  AI_MODE?: string;
  OPENAI_API_KEY?: string;
  ADMIN_EMAILS?: string;
  ADMIN_GROUPS?: string;
  CF_ACCESS_AUD?: string;
  BYPASS_ADMIN_AUTH?: string;
  DEV_ADMIN_TOKEN?: string;
  ENV?: string;
  LOCAL_STT_URL?: string;
  LOCAL_LLM_URL?: string;
  LOCAL_LLM_MODEL?: string;
};

export type RuntimeEnv = {
  aiMode: ProviderMode;
  openaiApiKey: string;
  adminEmails: string[];
  adminGroups: string[];
  cfAccessAud: string;
  bypassAdminAuth: boolean;
  devAdminToken: string;
  environment: string;
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

const parseCsv = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const resolveEnv = (bindings: EnvBindings): RuntimeEnv => ({
  aiMode: normalizeMode(bindings.AI_MODE),
  openaiApiKey: bindings.OPENAI_API_KEY ?? "",
  adminEmails: parseCsv(bindings.ADMIN_EMAILS),
  adminGroups: parseCsv(bindings.ADMIN_GROUPS),
  cfAccessAud: bindings.CF_ACCESS_AUD ?? "",
  bypassAdminAuth: bindings.BYPASS_ADMIN_AUTH === "true",
  devAdminToken: bindings.DEV_ADMIN_TOKEN ?? "",
  environment: bindings.ENV ?? "production",
  localSttUrl: bindings.LOCAL_STT_URL ?? "http://localhost:7001",
  localLlmUrl: bindings.LOCAL_LLM_URL ?? "http://localhost:7002",
  localLlmModel:
    bindings.LOCAL_LLM_MODEL ?? "mlx-community/Mistral-7B-Instruct-v0.2"
});

export const resolveNodeEnv = (): NodeRuntimeEnv => ({
  ...resolveEnv({
    AI_MODE: process.env.AI_MODE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_GROUPS: process.env.ADMIN_GROUPS,
    CF_ACCESS_AUD: process.env.CF_ACCESS_AUD,
    BYPASS_ADMIN_AUTH: process.env.BYPASS_ADMIN_AUTH,
    DEV_ADMIN_TOKEN: process.env.DEV_ADMIN_TOKEN,
    ENV: process.env.ENV,
    LOCAL_STT_URL: process.env.LOCAL_STT_URL,
    LOCAL_LLM_URL: process.env.LOCAL_LLM_URL,
    LOCAL_LLM_MODEL: process.env.LOCAL_LLM_MODEL
  }),
  dbPath: process.env.DB_PATH ?? "./infra/local.db"
});
