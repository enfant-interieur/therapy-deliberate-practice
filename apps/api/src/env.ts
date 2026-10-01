export type ProviderMode = "local_prefer" | "openai_only" | "local_only";

export type EnvBindings = {
  AI_MODE?: string;
  OPENAI_API_KEY?: string;
  OPENAI_KEY_ENCRYPTION_SECRET?: string;
  ADMIN_EMAILS?: string;
  ADMIN_GROUPS?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_ISSUER?: string;
  BYPASS_ADMIN_AUTH?: string;
  DEV_ADMIN_TOKEN?: string;
  ENV?: string;
  LOCAL_STT_URL?: string;
  LOCAL_LLM_URL?: string;
  LOCAL_LLM_MODEL?: string;
  LOCAL_TTS_URL?: string;
  LOCAL_TTS_MODEL?: string;
  LOCAL_TTS_VOICE?: string;
  LOCAL_TTS_FORMAT?: string;
  OPENAI_TTS_MODEL?: string;
  OPENAI_TTS_VOICE?: string;
  OPENAI_TTS_FORMAT?: string;
  OPENAI_TTS_INSTRUCTIONS?: string;
  AUTH_SECRET?: string;
  AUTH_BASE_URL?: string;
  AUTH_TRUSTED_ORIGINS?: string;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_ENABLED?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
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
  cfAccessIssuer: string;
  bypassAdminAuth: boolean;
  devAdminToken: string;
  environment: string;
  localSttUrl: string;
  localLlmUrl: string;
  localLlmModel: string;
  localTtsUrl: string;
  localTtsModel: string;
  localTtsVoice: string;
  localTtsFormat: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  openaiTtsModel: string;
  openaiTtsVoice: string;
  openaiTtsFormat: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
  openaiTtsInstructions: string;
  authSecret: string;
  authBaseUrl: string;
  authTrustedOrigins: string[];
  authEmailFrom: string;
  authEmailEnabled: boolean;
  googleClientId: string;
  googleClientSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  appleClientId: string;
  appleTeamId: string;
  appleKeyId: string;
  applePrivateKey: string;
  r2Bucket: string;
  r2PublicBaseUrl: string;
};

const ttsFormats = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;
const normalizeTtsFormat = (
  value: string | undefined,
  fallback: RuntimeEnv["localTtsFormat"],
): RuntimeEnv["localTtsFormat"] =>
  ttsFormats.includes(value as RuntimeEnv["localTtsFormat"])
    ? (value as RuntimeEnv["localTtsFormat"])
    : fallback;

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
  cfAccessIssuer: bindings.CF_ACCESS_ISSUER ?? "",
  bypassAdminAuth: bindings.BYPASS_ADMIN_AUTH === "true",
  devAdminToken: bindings.DEV_ADMIN_TOKEN ?? "",
  environment: bindings.ENV ?? "production",
  localSttUrl: bindings.LOCAL_STT_URL ?? "http://localhost:7001",
  localLlmUrl: bindings.LOCAL_LLM_URL ?? "http://localhost:7002",
  localLlmModel:
    bindings.LOCAL_LLM_MODEL ?? "mlx-community/Mistral-7B-Instruct-v0.2",
  localTtsUrl: bindings.LOCAL_TTS_URL ?? "http://localhost:7003",
  localTtsModel: bindings.LOCAL_TTS_MODEL ?? "mlx-community/Kokoro-82M-bf16",
  localTtsVoice: bindings.LOCAL_TTS_VOICE ?? "af_bella",
  localTtsFormat: normalizeTtsFormat(bindings.LOCAL_TTS_FORMAT, "mp3"),
  openaiTtsModel: bindings.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
  openaiTtsVoice: bindings.OPENAI_TTS_VOICE ?? "sage",
  openaiTtsFormat: normalizeTtsFormat(bindings.OPENAI_TTS_FORMAT, "mp3"),
  openaiTtsInstructions:
    bindings.OPENAI_TTS_INSTRUCTIONS ?? "Speaking to a friend.",
  authSecret: bindings.AUTH_SECRET ?? "",
  authBaseUrl:
    bindings.AUTH_BASE_URL ??
    (bindings.ENV === "test"
      ? "http://localhost"
      : "https://therapy-deliberate-practice.com"),
  authTrustedOrigins: parseCsv(bindings.AUTH_TRUSTED_ORIGINS),
  authEmailFrom: bindings.AUTH_EMAIL_FROM ?? "",
  authEmailEnabled: bindings.AUTH_EMAIL_ENABLED === "true",
  googleClientId: bindings.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: bindings.GOOGLE_CLIENT_SECRET ?? "",
  githubClientId: bindings.GITHUB_CLIENT_ID ?? "",
  githubClientSecret: bindings.GITHUB_CLIENT_SECRET ?? "",
  appleClientId: bindings.APPLE_CLIENT_ID ?? "",
  appleTeamId: bindings.APPLE_TEAM_ID ?? "",
  appleKeyId: bindings.APPLE_KEY_ID ?? "",
  applePrivateKey: bindings.APPLE_PRIVATE_KEY ?? "",
  r2Bucket: bindings.R2_BUCKET ?? "",
  r2PublicBaseUrl: bindings.R2_PUBLIC_BASE_URL ?? "",
});
