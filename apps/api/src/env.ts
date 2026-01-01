export type ProviderMode = "local_prefer" | "openai_only" | "local_only";

export type EnvBindings = {
  AI_MODE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_KEY_ENCRYPTION_SECRET?: string;
  ADMIN_EMAILS?: string;
  ADMIN_GROUPS?: string;
  CF_ACCESS_AUD?: string;
  BYPASS_ADMIN_AUTH?: string;
  DEV_ADMIN_TOKEN?: string;
  ENV?: string;
  LOCAL_STT_URL?: string;
  LOCAL_LLM_URL?: string;
  LOCAL_LLM_MODEL?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_JWT_SECRET?: string;
  R2_BUCKET?: string;
  R2_PUBLIC_BASE_URL?: string;
};

export type RuntimeEnv = {
  aiMode: ProviderMode;
  openaiApiKey: string;
  openaiKeyEncryptionSecret: string;
  adminEmails: string[];
  adminGroups: string[];
  cfAccessAud: string;
  bypassAdminAuth: boolean;
  devAdminToken: string;
  environment: string;
  localSttUrl: string;
  localLlmUrl: string;
  localLlmModel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseJwtSecret: string;
  r2Bucket: string;
  r2PublicBaseUrl: string;
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
  openaiKeyEncryptionSecret: bindings.OPENAI_KEY_ENCRYPTION_SECRET ?? "",
  adminEmails: parseCsv(bindings.ADMIN_EMAILS),
  adminGroups: parseCsv(bindings.ADMIN_GROUPS),
  cfAccessAud: bindings.CF_ACCESS_AUD ?? "",
  bypassAdminAuth: bindings.BYPASS_ADMIN_AUTH === "true",
  devAdminToken: bindings.DEV_ADMIN_TOKEN ?? "",
  environment: bindings.ENV ?? "production",
  localSttUrl: bindings.LOCAL_STT_URL ?? "http://localhost:7001",
  localLlmUrl: bindings.LOCAL_LLM_URL ?? "http://localhost:7002",
  localLlmModel: bindings.LOCAL_LLM_MODEL ?? "mlx-community/Mistral-7B-Instruct-v0.2",
  supabaseUrl: bindings.SUPABASE_URL ?? "",
  supabaseAnonKey: bindings.SUPABASE_ANON_KEY ?? "",
  supabaseJwtSecret: bindings.SUPABASE_JWT_SECRET ?? "",
  r2Bucket: bindings.R2_BUCKET ?? "",
  r2PublicBaseUrl: bindings.R2_PUBLIC_BASE_URL ?? ""
});
