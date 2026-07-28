import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import path from "node:path";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { userSettings } from "../src/db/schema";
import { createSqliteDb } from "../src/db/sqlite";
import { resolveEnv } from "../src/env";
import { decryptOpenAiKey } from "../src/utils/crypto";

const jwtSecret = "openai-key-route-test-secret";
const encryptionSecret = "openai-key-encryption-test-secret";
const fakeOpenAiKey = (label: string) => `sk-${label}-${"test-only".repeat(4)}`;
const ownerKey = fakeOpenAiKey("owner");
const otherKey = fakeOpenAiKey("other");
const testStorage = {
  headObject: async () => ({ exists: false }),
  putObject: async () => ({}),
  getObject: async () => ({
    body: new Uint8Array(),
    contentType: "audio/mpeg",
  }),
};

const activeTempDirectories = new Set<string>();

after(async () => {
  await Promise.all(
    [...activeTempDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  activeTempDirectories.clear();
});

const createHarness = async (secret = encryptionSecret) => {
  const tempDirectory = await mkdtemp(
    path.join(tmpdir(), "therapy-openai-key-routes-"),
  );
  activeTempDirectories.add(tempDirectory);
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const env = resolveEnv({
    ENV: "test",
    SUPABASE_JWT_SECRET: jwtSecret,
    OPENAI_KEY_ENCRYPTION_SECRET: secret,
  });
  const app = createApiApp({ env, db, tts: { storage: testStorage } });

  return {
    app,
    db,
    env,
    cleanup: async () => {
      try {
        await rm(tempDirectory, { recursive: true, force: true });
      } finally {
        activeTempDirectories.delete(tempDirectory);
      }
    },
  };
};

const authHeaders = async (userId: string) => {
  const token = await new SignJWT({ email: `${userId}@example.com` })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(jwtSecret));
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
};

const saveKey = async (
  app: ReturnType<typeof createApiApp>,
  userId: string,
  openaiApiKey: string,
) =>
  app.request("/api/v1/me/openai-key", {
    method: "PUT",
    headers: await authHeaders(userId),
    body: JSON.stringify({ openaiApiKey }),
  });

test("OpenAI keys are encrypted, owner-scoped, omitted from reads, and removable", async () => {
  const { app, db, cleanup } = await createHarness();
  try {
    const ownerSave = await saveKey(app, "key-owner", ownerKey);
    assert.equal(ownerSave.status, 200);
    const ownerSavePayload = await ownerSave.json();
    assert.deepEqual(ownerSavePayload, { ok: true, hasOpenAiKey: true });
    assert.equal(JSON.stringify(ownerSavePayload).includes(ownerKey), false);

    const otherSave = await saveKey(app, "key-other", otherKey);
    assert.equal(otherSave.status, 200);

    const [ownerSettings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, "key-owner"));
    const [otherSettings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, "key-other"));

    assert.ok(ownerSettings?.openai_key_ciphertext);
    assert.ok(ownerSettings.openai_key_iv);
    assert.equal(ownerSettings.openai_key_kid, "v1");
    assert.equal(ownerSettings.openai_key_ciphertext.includes(ownerKey), false);
    assert.equal(
      await decryptOpenAiKey(encryptionSecret, {
        ciphertextB64: ownerSettings.openai_key_ciphertext,
        ivB64: ownerSettings.openai_key_iv,
      }),
      ownerKey,
    );
    assert.ok(otherSettings?.openai_key_ciphertext);

    for (const endpoint of ["/api/v1/me", "/api/v1/me/settings"]) {
      const response = await app.request(endpoint, {
        headers: await authHeaders("key-owner"),
      });
      assert.equal(response.status, 200);
      const serialized = JSON.stringify(await response.json());
      assert.equal(serialized.includes(ownerKey), false);
      assert.equal(serialized.includes("openai_key_ciphertext"), false);
      assert.equal(serialized.includes("openai_key_iv"), false);
    }

    const removeResponse = await app.request("/api/v1/me/openai-key", {
      method: "DELETE",
      headers: await authHeaders("key-owner"),
    });
    assert.equal(removeResponse.status, 200);
    assert.deepEqual(await removeResponse.json(), {
      ok: true,
      hasOpenAiKey: false,
    });

    const [removedOwnerSettings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, "key-owner"));
    const [preservedOtherSettings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, "key-other"));
    assert.equal(removedOwnerSettings?.openai_key_ciphertext, null);
    assert.equal(removedOwnerSettings?.openai_key_iv, null);
    assert.equal(removedOwnerSettings?.openai_key_kid, null);
    assert.equal(
      preservedOtherSettings?.openai_key_ciphertext,
      otherSettings.openai_key_ciphertext,
    );
  } finally {
    await cleanup();
  }
});

test("invalid or unencryptable key updates fail closed without replacing the stored key", async () => {
  const { app, db, env, cleanup } = await createHarness();
  try {
    assert.equal((await saveKey(app, "rollback-owner", ownerKey)).status, 200);
    const readStored = async () =>
      (
        await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.user_id, "rollback-owner"))
      )[0];
    const before = await readStored();

    const invalidKey = await saveKey(app, "rollback-owner", "not-a-key");
    assert.equal(invalidKey.status, 400);
    assert.deepEqual(await invalidKey.json(), { error: "Invalid OpenAI key" });
    assert.deepEqual(await readStored(), before);

    const invalidJson = await app.request("/api/v1/me/openai-key", {
      method: "PUT",
      headers: await authHeaders("rollback-owner"),
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.deepEqual(await invalidJson.json(), { error: "Invalid JSON body" });
    assert.deepEqual(await readStored(), before);

    const oversized = await saveKey(
      app,
      "rollback-owner",
      `sk-${"x".repeat(20_000)}`,
    );
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), {
      error: "OpenAI key payload is too large",
    });
    assert.deepEqual(await readStored(), before);

    const misconfiguredApp = createApiApp({
      env: { ...env, openaiKeyEncryptionSecret: "" },
      db,
      tts: { storage: testStorage },
    });
    const missingSecret = await saveKey(
      misconfiguredApp,
      "rollback-owner",
      otherKey,
    );
    assert.equal(missingSecret.status, 500);
    assert.equal(
      JSON.stringify(await missingSecret.json()).includes(otherKey),
      false,
    );
    assert.deepEqual(await readStored(), before);
  } finally {
    await cleanup();
  }
});

test("OpenAI validation is destination-bound, failure-safe, and rate limited before transmission", async () => {
  const { app, db, cleanup } = await createHarness();
  const originalFetch = globalThis.fetch;
  try {
    assert.equal(
      (await saveKey(app, "validation-owner", ownerKey)).status,
      200,
    );
    const [storedBefore] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, "validation-owner"));

    const outbound: Array<{
      url: string;
      method: string | undefined;
      authorization: string | null;
      body: BodyInit | null | undefined;
    }> = [];
    globalThis.fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      outbound.push({
        url: String(input),
        method: init?.method,
        authorization: headers.get("authorization"),
        body: init?.body,
      });
      const authorization = headers.get("authorization");
      return new Response(null, {
        status: authorization === `Bearer ${ownerKey}` ? 200 : 401,
      });
    };

    const storedValidation = await app.request(
      "/api/v1/me/openai-key/validate",
      {
        method: "POST",
        headers: await authHeaders("validation-owner"),
        body: JSON.stringify({}),
      },
    );
    assert.equal(storedValidation.status, 200);
    const validationPayload = await storedValidation.json();
    assert.deepEqual(validationPayload, { ok: true });
    assert.equal(JSON.stringify(validationPayload).includes(ownerKey), false);
    assert.deepEqual(outbound, [
      {
        url: "https://api.openai.com/v1/models",
        method: "GET",
        authorization: `Bearer ${ownerKey}`,
        body: undefined,
      },
    ]);

    const malformedValidation = await app.request(
      "/api/v1/me/openai-key/validate",
      {
        method: "POST",
        headers: await authHeaders("validation-owner"),
        body: "{",
      },
    );
    assert.equal(malformedValidation.status, 400);
    assert.deepEqual(await malformedValidation.json(), {
      ok: false,
      error: "Invalid JSON body",
    });
    assert.equal(outbound.length, 1);

    const invalidShapeValidation = await app.request(
      "/api/v1/me/openai-key/validate",
      {
        method: "POST",
        headers: await authHeaders("validation-owner"),
        body: JSON.stringify({ openaiApiKey: 42 }),
      },
    );
    assert.equal(invalidShapeValidation.status, 400);
    assert.deepEqual(await invalidShapeValidation.json(), {
      ok: false,
      error: "Invalid OpenAI key payload",
    });
    assert.equal(outbound.length, 1);

    const rejectedKey = fakeOpenAiKey("rejected");
    const rejectedValidation = await app.request(
      "/api/v1/me/openai-key/validate",
      {
        method: "POST",
        headers: await authHeaders("validation-owner"),
        body: JSON.stringify({ openaiApiKey: rejectedKey }),
      },
    );
    assert.equal(rejectedValidation.status, 400);
    const rejectedPayload = await rejectedValidation.json();
    assert.deepEqual(rejectedPayload, {
      ok: false,
      error: "OpenAI rejected this key (401).",
    });
    assert.equal(JSON.stringify(rejectedPayload).includes(rejectedKey), false);
    const [storedAfter] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.user_id, "validation-owner"));
    assert.deepEqual(storedAfter, storedBefore);

    const rateLimitUser = "key-rate-limit-user";
    const rateLimitHeaders = await authHeaders(rateLimitUser);
    const rateLimitKey = fakeOpenAiKey("rate-limit");
    const outboundBeforeRateLimit = outbound.length;
    for (let index = 0; index < 10; index += 1) {
      const response = await app.request("/api/v1/me/openai-key/validate", {
        method: "POST",
        headers: rateLimitHeaders,
        body: JSON.stringify({ openaiApiKey: rateLimitKey }),
      });
      assert.equal(response.status, 400);
    }
    const blocked = await app.request("/api/v1/me/openai-key/validate", {
      method: "POST",
      headers: rateLimitHeaders,
      body: JSON.stringify({ openaiApiKey: rateLimitKey }),
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), {
      ok: false,
      error: "Too many validation attempts. Try again shortly.",
    });
    assert.equal(outbound.length - outboundBeforeRateLimit, 10);
    assert.ok(
      outbound.every(
        ({ url, body }) =>
          url === "https://api.openai.com/v1/models" && body === undefined,
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    await cleanup();
  }
});
