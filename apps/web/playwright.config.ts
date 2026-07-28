import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const localBaseUrl = "http://127.0.0.1:5174";
const viteCli = fileURLToPath(
  new URL("../../node_modules/vite/bin/vite.js", import.meta.url),
);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 7_500,
  },
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    ignoreHTTPSErrors: Boolean(process.env.REAL_HTTPS_APP_URL),
    trace: "retain-on-failure",
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `"${process.execPath}" "${viteCli}" --host 127.0.0.1 --port 5174 --strictPort`,
        url: localBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          VITE_SUPABASE_URL:
            process.env.VITE_SUPABASE_URL ?? "https://test.supabase.co",
          VITE_SUPABASE_ANON_KEY:
            process.env.VITE_SUPABASE_ANON_KEY ?? "test-anon-key",
        },
      },
});
