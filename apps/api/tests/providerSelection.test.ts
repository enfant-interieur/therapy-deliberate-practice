import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { selectSttProvider } from "../src/providers";
import type { EffectiveAiConfig } from "../src/providers/config";
import { ProviderConfigError } from "../src/providers/providerErrors";

const baseConfig: EffectiveAiConfig = {
  mode: "local_prefer",
  openai: { apiKey: "server-key" },
  local: { baseUrl: "http://local-ai", sttUrl: null, llmUrl: null, apiPrefix: "/v1" },
  resolvedFrom: { openaiKey: "env", localBaseUrl: "user" }
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = async () => ({ ok: true }) as Response;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("selectSttProvider prefers local when healthy", async () => {
  const selection = await selectSttProvider(baseConfig);
  assert.equal(selection.provider.kind, "local");
});

test("selectSttProvider falls back to OpenAI when local unhealthy", async () => {
  globalThis.fetch = async () => ({ ok: false }) as Response;
  const selection = await selectSttProvider(baseConfig);
  assert.equal(selection.provider.kind, "openai");
});

test("selectSttProvider throws when local_only missing base URL", async () => {
  const config: EffectiveAiConfig = {
    ...baseConfig,
    mode: "local_only",
    local: { baseUrl: null, sttUrl: null, llmUrl: null, apiPrefix: "/v1" }
  };

  await assert.rejects(
    () => selectSttProvider(config),
    (error) =>
      error instanceof ProviderConfigError &&
      error.code === "LOCAL_BASE_URL_MISSING"
  );
});

test("selectSttProvider throws when local_only is unreachable", async () => {
  const config: EffectiveAiConfig = {
    ...baseConfig,
    mode: "local_only"
  };
  globalThis.fetch = async () => ({ ok: false }) as Response;

  await assert.rejects(
    () => selectSttProvider(config),
    (error) =>
      error instanceof ProviderConfigError &&
      error.code === "LOCAL_UNREACHABLE"
  );
});
