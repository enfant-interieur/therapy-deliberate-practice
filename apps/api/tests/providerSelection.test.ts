import assert from "node:assert/strict";
import { test } from "node:test";
import { selectSttProvider } from "../src/providers";
import type { EffectiveAiConfig } from "../src/providers/config";
import { ProviderConfigError } from "../src/providers/providerErrors";

const baseConfig: EffectiveAiConfig = {
  mode: "local_prefer",
  openai: { apiKey: "server-key" },
  local: {
    baseUrl: "http://local-ai",
    sttUrl: null,
    llmUrl: null,
    apiPrefix: "/v1",
  },
  resolvedFrom: { openaiKey: "env", localBaseUrl: "user" },
};

test("selectSttProvider never resolves a user local URL from the hosted API", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Hosted API must not fetch a local URL.");
  };
  try {
    await assert.rejects(
      () => selectSttProvider(baseConfig),
      (error) =>
        error instanceof ProviderConfigError &&
        error.code === "LOCAL_BROWSER_REQUIRED",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("selectSttProvider selects OpenAI without probing local URLs", async () => {
  const config: EffectiveAiConfig = {
    ...baseConfig,
    mode: "openai_only",
  };
  const selection = await selectSttProvider(config);
  assert.equal(selection.provider.kind, "openai");
  assert.deepEqual(selection.health, { local: false, openai: true });
});

test("selectSttProvider makes local-only execution explicitly browser-owned", async () => {
  const config: EffectiveAiConfig = {
    ...baseConfig,
    mode: "local_only",
  };

  await assert.rejects(
    () => selectSttProvider(config),
    (error) =>
      error instanceof ProviderConfigError &&
      error.code === "LOCAL_BROWSER_REQUIRED",
  );
});
