import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeEnv } from "../src/env";
import { assertLocalBaseUrl, assertOpenAiKey, resolveEffectiveAiConfig } from "../src/providers/config";
import { ProviderConfigError } from "../src/providers/providerErrors";

const createEnv = (overrides: Partial<RuntimeEnv> = {}): RuntimeEnv => ({
  aiMode: "local_prefer",
  openaiApiKey: "",
  openaiKeyEncryptionSecret: "",
  adminEmails: [],
  adminGroups: [],
  cfAccessAud: "",
  bypassAdminAuth: false,
  devAdminToken: "",
  environment: "test",
  localSttUrl: "http://localhost:7001",
  localLlmUrl: "http://localhost:7002",
  localLlmModel: "test-llm",
  localTtsUrl: "http://localhost:7003",
  localTtsModel: "test-tts",
  localTtsVoice: "marin",
  localTtsFormat: "mp3",
  openaiTtsModel: "gpt-4o-mini-tts",
  openaiTtsVoice: "marin",
  openaiTtsFormat: "mp3",
  openaiTtsInstructions: "Speak like a patient.",
  supabaseUrl: "",
  supabaseAnonKey: "",
  supabaseJwtSecret: "test-secret",
  r2Bucket: "tts-bucket",
  r2PublicBaseUrl: "",
  ...overrides
});

test("assertOpenAiKey throws when openai_only has no key", async () => {
  const env = createEnv();
  const config = await resolveEffectiveAiConfig({
    env,
    settings: { ai_mode: "openai_only" }
  });

  assert.throws(
    () => assertOpenAiKey(config),
    (error) =>
      error instanceof ProviderConfigError &&
      error.code === "OPENAI_KEY_MISSING"
  );
});

test("local_only defaults to the local suite base URL when none is set", async () => {
  const env = createEnv({ openaiApiKey: "server-key" });
  const config = await resolveEffectiveAiConfig({
    env,
    settings: { ai_mode: "local_only" }
  });

  assert.equal(config.local.baseUrl, "http://127.0.0.1:8484");
  assert.doesNotThrow(() => assertLocalBaseUrl(config));
});

test("local_prefer falls back to env OpenAI key when local base URL missing", async () => {
  const env = createEnv({ openaiApiKey: "server-key" });
  const config = await resolveEffectiveAiConfig({
    env,
    settings: { ai_mode: "local_prefer", local_stt_url: null, local_llm_url: null }
  });

  assert.equal(config.mode, "local_prefer");
  assert.equal(config.openai.apiKey, "server-key");
  assert.equal(config.local.baseUrl, "http://127.0.0.1:8484");
  assert.equal(config.resolvedFrom.openaiKey, "env");
});
