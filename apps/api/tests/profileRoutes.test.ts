import {
  TEST_AUTH_SECRET,
  createAuthTestEnv,
  createManagedSessionHeaders,
} from "./authFixture";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { users } from "../src/db/schema";
import { createSqliteDb } from "../src/db/sqlite";
import { resolveEnv } from "../src/env";

const authHeaders = async (
  db: Parameters<typeof createManagedSessionHeaders>[0],
  userId: string,
) => ({
  ...(await createManagedSessionHeaders(db, createAuthTestEnv(), userId)),
  "Content-Type": "application/json",
});

test("profile routes enforce ownership and validation and persist a save across reload", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-profile-routes-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const db = createSqliteDb(dbPath);
  const app = createApiApp({
    env: resolveEnv({
      ENV: "test",
      AUTH_SECRET: TEST_AUTH_SECRET,
      AUTH_BASE_URL: "http://localhost",
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

  try {
    const now = Date.now();
    await db.insert(users).values([
      {
        id: "profile-owner",
        email: "profile-owner@example.com",
        display_name: "Original owner",
        bio: "Original biography.",
        created_at: now,
      },
      {
        id: "other-user",
        email: "other-user@example.com",
        display_name: "Other user",
        bio: "Must remain unchanged.",
        created_at: now + 1,
      },
    ]);

    const unauthenticated = await app.request("/api/v1/me/profile", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        displayName: "Unauthorized edit",
        bio: null,
      }),
    });
    assert.equal(unauthenticated.status, 401);

    const ownerHeaders = await authHeaders(db, "profile-owner");
    const invalidDisplayName = await app.request("/api/v1/me/profile", {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ displayName: "x", bio: "Valid biography." }),
    });
    assert.equal(invalidDisplayName.status, 400);

    const invalidBio = await app.request("/api/v1/me/profile", {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({
        displayName: "Valid owner",
        bio: "a".repeat(161),
      }),
    });
    assert.equal(invalidBio.status, 400);

    const afterInvalid = await db
      .select()
      .from(users)
      .where(eq(users.id, "profile-owner"));
    assert.equal(afterInvalid[0]?.display_name, "Original owner");
    assert.equal(afterInvalid[0]?.bio, "Original biography.");

    const saved = await app.request("/api/v1/me/profile", {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({
        id: "other-user",
        displayName: "  Updated owner  ",
        bio: "  Practising deliberate reflection.  ",
      }),
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), {
      ok: true,
      display_name: "Updated owner",
      bio: "Practising deliberate reflection.",
      is_profile_public: false,
    });

    const reloaded = await app.request("/api/v1/me", {
      headers: ownerHeaders,
    });
    assert.equal(reloaded.status, 200);
    const reloadedBody = await reloaded.json();
    assert.deepEqual(
      {
        display_name: reloadedBody.display_name,
        bio: reloadedBody.bio,
      },
      {
        display_name: "Updated owner",
        bio: "Practising deliberate reflection.",
      },
    );

    const other = await db
      .select()
      .from(users)
      .where(eq(users.id, "other-user"));
    assert.equal(other[0]?.display_name, "Other user");
    assert.equal(other[0]?.bio, "Must remain unchanged.");
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
