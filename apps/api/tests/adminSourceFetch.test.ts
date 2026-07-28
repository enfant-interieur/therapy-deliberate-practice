import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { createSqliteDb } from "../src/db/sqlite";
import { resolveEnv } from "../src/env";
import {
  AdminSourceFetchError,
  fetchAdminSourceText,
  isPublicSourceAddress,
  type AdminSourceFetchDependencies,
} from "../src/services/adminSourceFetch";

const publicAddresses = new Map<string, string[]>([
  ["public.example", ["93.184.216.34"]],
  ["redirect.example", ["203.0.114.10"]],
]);

const resolver = async (hostname: string) => {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (literal.includes(":") || /^\d+(?:\.\d+){3}$/.test(literal)) {
    return [literal];
  }
  return publicAddresses.get(hostname) ?? [];
};

const expectCode = async (
  promise: Promise<unknown>,
  code: AdminSourceFetchError["code"],
) => {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof AdminSourceFetchError && error.code === code,
  );
};

test("public address classification rejects private, loopback, link-local, metadata, and mapped forms", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "2001:db8::1",
    "2002:7f00:1::",
  ]) {
    assert.equal(isPublicSourceAddress(address), false, address);
  }
  assert.equal(isPublicSourceAddress("93.184.216.34"), true);
  assert.equal(
    isPublicSourceAddress("2606:2800:220:1:248:1893:25c8:1946"),
    true,
  );
});

test("source fetching rejects schemes, credentials, literal forbidden hosts, and mixed DNS answers before transport", async () => {
  let transportCalls = 0;
  const dependencies: AdminSourceFetchDependencies = {
    resolveHostname: async (hostname) =>
      hostname === "mixed.example"
        ? ["93.184.216.34", "127.0.0.1"]
        : resolver(hostname),
    fetchValidated: async () => {
      transportCalls += 1;
      return new Response("unreachable");
    },
  };

  await expectCode(
    fetchAdminSourceText("file:///etc/passwd", dependencies),
    "invalid_url",
  );
  await expectCode(
    fetchAdminSourceText("ftp://public.example/file", dependencies),
    "invalid_url",
  );
  await expectCode(
    fetchAdminSourceText("https://user:password@public.example", dependencies),
    "invalid_url",
  );
  await expectCode(
    fetchAdminSourceText("http://127.0.0.1/admin", dependencies),
    "forbidden_destination",
  );
  await expectCode(
    fetchAdminSourceText(
      "http://169.254.169.254/latest/meta-data",
      dependencies,
    ),
    "forbidden_destination",
  );
  await expectCode(
    fetchAdminSourceText("http://[::ffff:127.0.0.1]/", dependencies),
    "forbidden_destination",
  );
  await expectCode(
    fetchAdminSourceText("https://mixed.example/", dependencies),
    "forbidden_destination",
  );
  assert.equal(transportCalls, 0);
});

test("every redirect is revalidated and forbidden redirects stop before a second request", async () => {
  const calls: string[] = [];
  const dependencies: AdminSourceFetchDependencies = {
    resolveHostname: resolver,
    fetchValidated: async ({ url }) => {
      calls.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      });
    },
  };

  await expectCode(
    fetchAdminSourceText("https://public.example/start", dependencies),
    "forbidden_destination",
  );
  assert.deepEqual(calls, ["https://public.example/start"]);
});

test("source fetching follows bounded public redirects with pinned resolved addresses", async () => {
  const calls: Array<{ url: string; addresses: readonly string[] }> = [];
  const dependencies: AdminSourceFetchDependencies = {
    resolveHostname: resolver,
    fetchValidated: async ({ url, validatedAddresses }) => {
      calls.push({ url, addresses: validatedAddresses });
      if (url === "https://public.example/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://redirect.example/final" },
        });
      }
      return new Response("<main>Safe text</main>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };

  const text = await fetchAdminSourceText(
    "https://public.example/start",
    dependencies,
  );
  assert.equal(text, "<main>Safe text</main>");
  assert.deepEqual(calls, [
    {
      url: "https://public.example/start",
      addresses: ["93.184.216.34"],
    },
    {
      url: "https://redirect.example/final",
      addresses: ["203.0.114.10"],
    },
  ]);
});

test("source fetching enforces redirect, timeout, content-type, and byte bounds without body leakage", async () => {
  const base = {
    resolveHostname: resolver,
  };

  await expectCode(
    fetchAdminSourceText(
      "https://public.example/start",
      {
        ...base,
        fetchValidated: async () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://public.example/again" },
          }),
      },
      { maxRedirects: 1 },
    ),
    "redirect_limit",
  );

  await expectCode(
    fetchAdminSourceText(
      "https://public.example/slow",
      {
        ...base,
        fetchValidated: async () => new Promise<Response>(() => undefined),
      },
      { timeoutMs: 10 },
    ),
    "timeout",
  );

  await expectCode(
    fetchAdminSourceText("https://public.example/binary", {
      ...base,
      fetchValidated: async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "application/octet-stream" },
        }),
    }),
    "unsupported_content_type",
  );

  await expectCode(
    fetchAdminSourceText(
      "https://public.example/large",
      {
        ...base,
        fetchValidated: async () =>
          new Response("0123456789", {
            headers: { "content-type": "text/plain" },
          }),
      },
      { maxBytes: 5 },
    ),
    "source_too_large",
  );

  try {
    await fetchAdminSourceText("https://public.example/error", {
      ...base,
      fetchValidated: async () =>
        new Response("PRIVATE RESPONSE BODY", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    });
    assert.fail("Expected source fetch to fail.");
  } catch (error) {
    assert.ok(error instanceof AdminSourceFetchError);
    assert.equal(error.code, "bad_status");
    assert.equal(error.message.includes("PRIVATE RESPONSE BODY"), false);
  }
});

test("administrator URL parsing fails closed without a pinned transport while pasted text still parses", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-admin-source-route-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const app = createApiApp({
    env: resolveEnv({
      ENV: "development",
      BYPASS_ADMIN_AUTH: "true",
      OPENAI_API_KEY: "test-openai-key",
    }),
    db,
    tts: {
      storage: {
        headObject: async () => ({ exists: false }),
        putObject: async () => ({}),
        getObject: async () => ({
          body: new Uint8Array(),
          contentType: "audio/mpeg",
        }),
      },
    },
  });
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  try {
    globalThis.fetch = async () => {
      providerCalls += 1;
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    version: "2.1",
                    task: {
                      title: "Pasted source task",
                      description: "Created from pasted source text.",
                      skill_domain: "validation",
                      base_difficulty: 2,
                      general_objective: null,
                      tags: ["pasted"],
                      language: "en",
                    },
                    criteria: [
                      {
                        id: "c1",
                        label: "Reflect",
                        description: "Reflect the concern.",
                      },
                    ],
                    examples: [
                      {
                        id: "ex1",
                        difficulty: 2,
                        severity_label: null,
                        patient_text: "I am concerned.",
                        language: "en",
                        meta: null,
                      },
                    ],
                    interaction_examples: [],
                  }),
                },
              ],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    };

    const urlResponse = await app.request("/api/v1/admin/parse-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_url: "https://public.example/private-body",
        parse_mode: "exact",
      }),
    });
    assert.equal(urlResponse.status, 400);
    const urlPayload = (await urlResponse.json()) as { error: string };
    assert.equal(urlPayload.error.includes("public.example"), false);
    assert.equal(providerCalls, 0);

    const pastedResponse = await app.request("/api/v1/admin/parse-task", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        free_text:
          "Practice reflecting a patient's concern and inviting them to continue.",
        parse_mode: "exact",
      }),
    });
    assert.equal(pastedResponse.status, 200);
    const pasted = (await pastedResponse.json()) as {
      task: { title: string };
    };
    assert.equal(pasted.task.title, "Pasted source task");
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
