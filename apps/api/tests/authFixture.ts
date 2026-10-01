import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { makeSignature } from "better-auth/crypto";
import { authUsers, authSessions } from "../src/auth/schema";
import { createApplicationAuth } from "../src/auth/service";
import { users } from "../src/db/schema";
import type { ApiDatabase } from "../src/db/types";
import { resolveEnv, type RuntimeEnv } from "../src/env";

export const TEST_AUTH_SECRET =
  "therapy-managed-auth-test-secret-0123456789abcdef";

export const authTestBindings = {
  ENV: "test",
  AUTH_SECRET: TEST_AUTH_SECRET,
  AUTH_BASE_URL: "http://localhost",
};

export const createAuthTestEnv = (
  overrides: Partial<RuntimeEnv> = {},
): RuntimeEnv => ({
  ...resolveEnv(authTestBindings),
  ...overrides,
});

export function applyAuthTestMigration(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(
    readFileSync(
      new URL(
        "../../worker/migrations/0019_application_auth.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

type FixtureDatabase = ApiDatabase | BetterSQLite3Database;

export type ManagedSessionOptions = {
  email?: string;
  emailVerified?: boolean;
  name?: string;
  createdAt?: Date;
  expiresAt?: Date;
  token?: string;
  sessionId?: string;
};

export async function createManagedSession(
  db: FixtureDatabase,
  env: RuntimeEnv,
  userId: string,
  options: ManagedSessionOptions = {},
) {
  // The synchronous SQLite fixture shares the awaitable application query surface.
  const database = db as ApiDatabase;
  const createdAt = options.createdAt ?? new Date();
  const [profile] = await database
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const email = options.email ?? profile?.email ?? `${userId}@example.com`;
  await database
    .insert(authUsers)
    .values({
      id: userId,
      email,
      name: options.name ?? `Test ${userId}`,
      emailVerified: options.emailVerified ?? true,
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing();
  const [user] = await database
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  if (!user || user.email !== email) {
    throw new Error(
      "Managed-session fixture identity conflicts with an existing user",
    );
  }

  const session = {
    id: options.sessionId ?? crypto.randomUUID(),
    token: options.token ?? crypto.randomUUID(),
    userId,
    expiresAt: options.expiresAt ?? new Date(Date.now() + 2 * 60 * 60 * 1000),
    createdAt,
    updatedAt: createdAt,
    ipAddress: "127.0.0.1",
    userAgent: "managed-session-test",
  };
  await database.insert(authSessions).values(session);
  const auth = createApplicationAuth(env, database);
  if (!auth)
    throw new Error(
      "Managed-session fixture requires a configured auth secret",
    );
  const context = await auth.$context;
  const signature = await makeSignature(session.token, context.secret);
  const cookie = `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`;
  const headers = {
    Cookie: cookie,
    Origin: new URL(env.authBaseUrl).origin,
  };
  return { headers, cookie, user, session };
}

export async function createManagedSessionHeaders(
  db: FixtureDatabase,
  env: RuntimeEnv,
  userId: string,
  options: ManagedSessionOptions = {},
) {
  return (await createManagedSession(db, env, userId, options)).headers;
}
