import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { hashSync } from "bcryptjs";
import { generateKeyPair, exportPKCS8, jwtVerify } from "jose";
import { createApiApp } from "../src/app";
import * as schema from "../src/db/schema";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "../src/auth/schema";
import {
  appleClientSecret,
  applicationOrigins,
  createApplicationAuth,
} from "../src/auth/service";
import { hashPassword, verifyPassword } from "../src/auth/password";
import type { ApiDatabase } from "../src/db/types";
import type { AuthEmail } from "../src/auth/email";
import { createAuthTestEnv, createManagedSession } from "./authFixture";
import { prepareMigration } from "../../../scripts/auth/prepare-migration.mjs";

function harness(
  overrides: Parameters<typeof createAuthTestEnv>[0] = {},
  emailEnabled = true,
) {
  const sqlite = new Database(":memory:");
  const directory = new URL("../../worker/migrations/", import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  const db = drizzle(sqlite, { schema }) as unknown as ApiDatabase;
  const env = createAuthTestEnv(overrides);
  const messages: AuthEmail[] = [];
  const storage = {
    headObject: async () => ({ exists: false }),
    getObject: async () => ({
      body: new Uint8Array(),
      contentType: "audio/mpeg",
    }),
    putObject: async () => ({}),
  };
  const app = createApiApp({
    db,
    env,
    tts: { storage },
    sendAuthEmail: emailEnabled
      ? async (message) => {
          messages.push(message);
        }
      : undefined,
  });
  const call = (
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`http://localhost${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "http://localhost",
        "x-test-client-ip": "127.0.0.1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const emailURL = () => {
    const match = messages.at(-1)?.text.match(/https?:\/\/\S+/);
    assert.ok(match);
    return new URL(match[0]);
  };
  return { sqlite, db, env, messages, app, call, emailURL };
}
const password = "a unique synthetic passphrase";
const signupBody = {
  email: "learner@example.com",
  password,
  name: "Learner",
  callbackURL: "http://localhost/login?verified=1",
};
const cookieFrom = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

test("complete verified-email signup, uniform duplicates/resend/reset, password reset and session revocation", async () => {
  const h = harness();
  try {
    const signup = await h.call("/api/auth/sign-up/email", signupBody);
    assert.equal(signup.status, 200);
    const account = await signup.json();
    assert.equal(account.token, null);
    assert.equal(account.user.emailVerified, false);
    const beforeVerification = await h.call("/api/auth/sign-in/email", {
      email: signupBody.email,
      password,
    });
    assert.equal(beforeVerification.status, 403);
    const verify = await h.app.request(h.emailURL().href);
    assert.equal(verify.status, 302);
    assert.match(verify.headers.get("location") ?? "", /verified=1/);
    const duplicate = await h.call("/api/auth/sign-up/email", signupBody);
    assert.equal(duplicate.status, 200);
    const duplicateBody = await duplicate.json();
    assert.equal(duplicateBody.token, null);
    assert.equal(duplicateBody.user.emailVerified, false);
    const resendExisting = await h.call("/api/auth/send-verification-email", {
      email: signupBody.email,
    });
    const resendMissing = await h.call("/api/auth/send-verification-email", {
      email: "missing@example.com",
    });
    assert.equal(resendExisting.status, resendMissing.status);
    assert.deepEqual(await resendExisting.json(), await resendMissing.json());
    const signIn = await h.call("/api/auth/sign-in/email", {
      email: signupBody.email,
      password,
    });
    assert.equal(signIn.status, 200);
    const cookie = cookieFrom(signIn);
    assert.match(signIn.headers.getSetCookie()[0], /HttpOnly/i);
    assert.match(signIn.headers.getSetCookie()[0], /SameSite=Lax/i);
    assert.equal(
      (await h.call("/api/v1/me", undefined, { Cookie: cookie })).status,
      200,
    );
    const resetExisting = await h.call("/api/auth/request-password-reset", {
      email: signupBody.email,
      redirectTo: "http://localhost/reset-password",
    });
    const resetURL = h.emailURL();
    const resetMissing = await h.call("/api/auth/request-password-reset", {
      email: "missing@example.com",
      redirectTo: "http://localhost/reset-password",
    });
    assert.equal(resetExisting.status, resetMissing.status);
    assert.deepEqual(await resetExisting.json(), await resetMissing.json());
    const redirect = await h.app.request(resetURL.href);
    assert.equal(redirect.status, 302);
    const token = new URL(redirect.headers.get("location")!).searchParams.get(
      "token",
    );
    assert.ok(token);
    const newPassword = "a different unique passphrase";
    const reset = await h.call("/api/auth/reset-password", {
      token,
      newPassword,
    });
    assert.equal(reset.status, 200);
    assert.equal(
      (await h.call("/api/auth/reset-password", { token, newPassword })).status,
      400,
    );
    assert.equal(
      (await h.call("/api/v1/me", undefined, { Cookie: cookie })).status,
      401,
    );
    assert.equal(
      (
        await h.call("/api/auth/sign-in/email", {
          email: signupBody.email,
          password,
        })
      ).status,
      401,
    );
    const newSignIn = await h.call("/api/auth/sign-in/email", {
      email: signupBody.email,
      password: newPassword,
    });
    assert.equal(newSignIn.status, 200);
    const newCookie = cookieFrom(newSignIn);
    assert.equal(
      (await h.call("/api/auth/sign-out", {}, { Cookie: newCookie })).status,
      200,
    );
    assert.equal(
      (await h.call("/api/v1/me", undefined, { Cookie: newCookie })).status,
      401,
    );
    assert.equal(
      h.sqlite.prepare("SELECT count(*) AS n FROM auth_session").get().n,
      0,
    );
    const stored = h.sqlite
      .prepare(
        "SELECT password FROM auth_account WHERE provider_id='credential'",
      )
      .get().password;
    assert.match(stored, /^pbkdf2-sha256\$v1\$600000\$/);
    assert.equal(stored.includes(newPassword), false);
  } finally {
    h.sqlite.close();
  }
});

test("expiry, forged cookies, CSRF, all-session revocation, freshness, and account ownership", async () => {
  const h = harness();
  try {
    const one = await createManagedSession(h.db, h.env, "owner-one");
    const two = await createManagedSession(h.db, h.env, "owner-two");
    const old = await createManagedSession(h.db, h.env, "owner-one", {
      createdAt: new Date(Date.now() - 301_000),
    });
    const expired = await createManagedSession(h.db, h.env, "expired", {
      expiresAt: new Date(Date.now() - 1000),
    });
    assert.equal(
      (await h.call("/api/v1/me", undefined, expired.headers)).status,
      401,
    );
    assert.equal(
      (await h.call("/api/v1/me", undefined, { Cookie: `${one.cookie}forged` }))
        .status,
      401,
    );
    assert.equal(
      (
        await h.call("/api/v1/me", undefined, {
          Authorization: "Bearer obsolete.jwt.token",
        })
      ).status,
      401,
    );
    for (const origin of ["https://attacker.example", "", "null"]) {
      assert.equal(
        (
          await h.call(
            "/api/v1/me/profile",
            { displayName: "wrong" },
            { Cookie: one.cookie, Origin: origin },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await h.call(
            "/api/auth/sign-out",
            {},
            { Cookie: one.cookie, Origin: origin },
          )
        ).status,
        403,
      );
    }
    assert.equal(
      (await h.call("/api/auth/revoke-sessions", {}, old.headers)).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          "/api/auth/link-social",
          { provider: "google", callbackURL: "http://localhost/profile" },
          old.headers,
        )
      ).status,
      401,
    );
    const time = new Date();
    await h.db.insert(authAccounts).values([
      {
        id: "method-one",
        accountId: "subject-one",
        providerId: "google",
        userId: "owner-one",
        createdAt: time,
        updatedAt: time,
      },
      {
        id: "method-two",
        accountId: "subject-two",
        providerId: "github",
        userId: "owner-two",
        createdAt: time,
        updatedAt: time,
      },
    ]);
    assert.equal(
      (
        await h.call(
          "/api/auth/unlink-account",
          { accountId: "method-one" },
          one.headers,
        )
      ).status,
      400,
    );
    await h.db.insert(authAccounts).values({
      id: "second-one",
      accountId: "second-subject",
      providerId: "github",
      userId: "owner-one",
      createdAt: time,
      updatedAt: time,
    });
    assert.equal(
      (
        await h.call(
          "/api/auth/unlink-account",
          { accountId: "method-two" },
          one.headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await h.call(
          "/api/auth/unlink-account",
          { accountId: "second-one" },
          one.headers,
        )
      ).status,
      200,
    );
    assert.equal(
      (await h.call("/api/auth/revoke-sessions", {}, one.headers)).status,
      200,
    );
    assert.equal(
      (await h.call("/api/v1/me", undefined, one.headers)).status,
      401,
    );
    const meTwo = await h.call("/api/v1/me", undefined, two.headers);
    assert.equal(meTwo.status, 200);
    assert.equal((await meTwo.json()).id, "owner-two");
  } finally {
    h.sqlite.close();
  }
});

test("one-use reset tokens are consumed atomically and expired reset tokens fail", async () => {
  const h = harness();
  try {
    const session = await createManagedSession(h.db, h.env, "reset-user");
    await h.call("/api/auth/request-password-reset", {
      email: session.user.email,
      redirectTo: "http://localhost/reset-password",
    });
    const redirect = await h.app.request(h.emailURL().href);
    const token = new URL(redirect.headers.get("location")!).searchParams.get(
      "token",
    )!;
    const concurrent = await Promise.all([
      h.call("/api/auth/reset-password", { token, newPassword: password }),
      h.call("/api/auth/reset-password", { token, newPassword: password }),
    ]);
    assert.deepEqual(
      concurrent.map((response) => response.status).sort(),
      [200, 400],
    );
    await h.call("/api/auth/request-password-reset", {
      email: session.user.email,
      redirectTo: "http://localhost/reset-password",
    });
    const expiredURL = h.emailURL();
    await h.db
      .update(authVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    const expired = await h.app.request(expiredURL.href);
    assert.equal(expired.status, 302);
    assert.match(expired.headers.get("location") ?? "", /INVALID_TOKEN/);
  } finally {
    h.sqlite.close();
  }
});

test("new password format is bounded, salted, and permits long Unicode without bcrypt reinterpretation", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword({ hash: first, password }), true);
  assert.equal(await verifyPassword({ hash: first, password: "wrong" }), false);
  const unicode = "🌱".repeat(48);
  const hash = await hashPassword(unicode);
  assert.equal(await verifyPassword({ hash, password: unicode }), true);
  assert.equal(
    await verifyPassword({
      hash: first.replace("600000", "999999999"),
      password,
    }),
    false,
  );
  assert.equal(
    await verifyPassword({ hash: "$2b$31$" + "a".repeat(53), password }),
    false,
  );
  await assert.rejects(hashPassword("x".repeat(129)));
  assert.equal(
    await verifyPassword({ hash: first, password: "x".repeat(129) }),
    false,
  );
});

test("missing configuration, provider origin/state, body limits, metadata-only errors, and durable rate limits", async () => {
  const h = harness({
    googleClientId: "synthetic-google-client",
    googleClientSecret: "synthetic-google-secret",
  });
  const missing = harness({ authSecret: "" }, false);
  const delivery = harness({}, false);
  try {
    assert.deepEqual(
      (await (await h.call("/api/auth/config")).json()).providers,
      { google: true, github: false, apple: false },
    );
    assert.equal((await missing.call("/api/v1/me")).status, 503);
    assert.equal(
      (
        await missing.call("/api/auth/sign-in/email", {
          email: signupBody.email,
          password,
        })
      ).status,
      503,
    );
    assert.equal(
      (await delivery.call("/api/auth/sign-up/email", signupBody)).status,
      503,
    );
    assert.equal(
      (await delivery.call("/api/auth/config")).headers.get("cache-control"),
      "no-store",
    );
    assert.equal(
      (
        await h.call("/api/auth/sign-up/email", {
          ...signupBody,
          name: "x".repeat(20_000),
        })
      ).status,
      413,
    );
    const badCallback = await h.call("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "https://attacker.example",
    });
    assert.equal(badCallback.status, 403);
    const start = await h.call("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "http://localhost/login",
    });
    assert.equal(start.status, 200);
    const authorization = new URL((await start.json()).url);
    assert.ok(authorization.searchParams.get("state"));
    assert.equal(authorization.hostname, "accounts.google.com");
    const invalidState = await h.call(
      "/api/auth/callback/google?state=forged&code=forged",
    );
    assert.equal(invalidState.status, 302);
    assert.match(invalidState.headers.get("location") ?? "", /error=/);
    const auth = createApplicationAuth(h.env, h.db)!;
    assert.equal(
      auth.options.account?.accountLinking?.disableImplicitLinking,
      true,
    );
    assert.equal(auth.options.account?.encryptOAuthTokens, true);
    assert.throws(() =>
      applicationOrigins({ ...h.env, environment: "production" }),
    );
    const first = await h.call(
      "/api/auth/sign-in/email",
      { email: "unknown@example.com", password },
      { "x-test-client-ip": "rate-only" },
    );
    assert.equal(first.status, 401);
    for (let i = 0; i < 9; i++)
      assert.equal(
        (
          await h.call(
            "/api/auth/sign-in/email",
            { email: "unknown@example.com", password },
            { "x-test-client-ip": "rate-only" },
          )
        ).status,
        401,
      );
    const anotherApp = createApiApp({
      env: h.env,
      db: h.db,
      tts: {
        storage: {
          headObject: async () => ({ exists: false }),
          getObject: async () => ({
            body: new Uint8Array(),
            contentType: "audio/mpeg",
          }),
          putObject: async () => ({}),
        },
      },
    });
    const limited = await anotherApp.request(
      "http://localhost/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "x-test-client-ip": "rate-only",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "unknown@example.com", password }),
      },
    );
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("x-retry-after"));
    const warnings: string[] = [];
    const original = console.warn;
    const originalError = console.error;
    const loggingSession = await createManagedSession(
      h.db,
      h.env,
      "logging-user",
      { token: "sensitive-cookie" },
    );
    try {
      console.warn = (...args) => {
        warnings.push(args.join(" "));
      };
      console.error = (...args) => {
        warnings.push(args.join(" "));
      };
      h.sqlite.exec("DROP TABLE auth_session");
      await h.call("/api/v1/me", undefined, loggingSession.headers);
      assert.ok(warnings.length > 0);
      assert.ok(
        warnings.every(
          (warning) =>
            !warning.includes("sensitive-cookie") &&
            !warning.includes(signupBody.email) &&
            !warning.includes(password),
        ),
      );
    } finally {
      console.warn = original;
      console.error = originalError;
    }
  } finally {
    h.sqlite.close();
    missing.sqlite.close();
    delivery.sqlite.close();
  }
});

test("Apple ES256 client secrets carry the Service ID, team, key and bounded expiry", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const env = createAuthTestEnv({
    appleClientId: "app.service",
    appleTeamId: "TEAM",
    appleKeyId: "KEY",
    applePrivateKey: await exportPKCS8(privateKey),
  });
  const { payload, protectedHeader } = await jwtVerify(
    await appleClientSecret(env),
    publicKey,
    { issuer: "TEAM", audience: "https://appleid.apple.com" },
  );
  assert.equal(protectedHeader.alg, "ES256");
  assert.equal(protectedHeader.kid, "KEY");
  assert.equal(payload.sub, "app.service");
  assert.equal(payload.exp! - payload.iat!, 3600);
});

test("imported bcrypt accounts preserve original UUID, profile, settings and history on real password sign-in", async () => {
  const h = harness();
  try {
    const id = "10000000-0000-4000-8000-000000000001";
    const oldPassword = "oldpwd";
    h.sqlite
      .prepare(
        "INSERT INTO users (id,email,display_name,bio,is_profile_public,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(id, "imported@example.com", "Existing name", "Existing bio", 0, 1);
    h.sqlite
      .prepare(
        "INSERT INTO user_settings(user_id,ai_mode,store_audio,created_at,updated_at) VALUES (?,?,?,?,?)",
      )
      .run(id, "local_only", 0, 1, 1);
    h.sqlite
      .exec(`INSERT INTO tasks (id,slug,title,description,skill_domain,base_difficulty,tags,is_published,created_at,updated_at) VALUES ('t','t','Existing task','Description','test',2,'[]',1,1,1);
      INSERT INTO task_examples (id,task_id,difficulty,patient_text,created_at,updated_at) VALUES ('e','t',2,'Synthetic prompt',1,1);
      INSERT INTO attempts (id,user_id,task_id,example_id,started_at,completed_at,transcript,evaluation,overall_pass,overall_score) VALUES ('a','${id}','t','e',1,2,'Synthetic history','{}',0,1);`);
    const source = {
      schemaVersion: 1,
      source: {
        projectRef: "synthetic",
        exportedAt: "2026-10-01T00:00:00Z",
        frozen: true,
        expectedUserCount: 1,
        expectedIdentityCount: 1,
      },
      mfaFactors: [],
      users: [
        {
          id,
          email: "imported@example.com",
          encrypted_password: hashSync(oldPassword, 10),
          email_confirmed_at: "2026-09-01T00:00:00Z",
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
          is_anonymous: false,
          is_sso_user: false,
          banned_until: null,
          deleted_at: null,
          phone: null,
          phone_confirmed_at: null,
        },
      ],
      identities: [
        {
          id: "source-row",
          user_id: id,
          provider: "email",
          provider_id: id,
          created_at: "2026-09-01T00:00:00Z",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
    };
    const prepared = prepareMigration(source, h.sqlite);
    h.sqlite.exec(prepared.sql);
    h.sqlite.exec(prepared.sql);
    assert.equal(
      prepareMigration(source, h.sqlite).receipt.counts.alreadyImportedUsers,
      1,
    );
    const login = await h.call("/api/auth/sign-in/email", {
      email: "imported@example.com",
      password: oldPassword,
    });
    assert.equal(login.status, 200);
    const cookie = cookieFrom(login);
    const me = await (
      await h.call("/api/v1/me", undefined, { Cookie: cookie })
    ).json();
    assert.equal(me.id, id);
    assert.equal(me.display_name, "Existing name");
    assert.equal(me.bio, "Existing bio");
    assert.equal(me.is_profile_public, false);
    assert.equal(
      (
        await (
          await h.call("/api/v1/me/settings", undefined, { Cookie: cookie })
        ).json()
      ).aiMode,
      "local_only",
    );
    assert.equal(
      h.sqlite.prepare("SELECT user_id FROM attempts WHERE id='a'").get()
        .user_id,
      id,
    );
    assert.equal(
      h.sqlite.prepare("SELECT count(*) AS n FROM auth_user").get().n,
      1,
    );
  } finally {
    h.sqlite.close();
  }
});

test("legacy mixed-case email reservations stay private and database guards prevent identity races", async () => {
  const h = harness();
  try {
    h.sqlite
      .prepare(
        "INSERT INTO users (id,email,display_name,bio,is_profile_public,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        "legacy-id",
        "LEARNER@example.com",
        "Legacy learner",
        "Existing",
        0,
        1,
      );
    const reserved = await h.call("/api/auth/sign-up/email", signupBody);
    assert.equal(reserved.status, 200);
    const response = await reserved.json();
    assert.equal(response.token, null);
    assert.equal(response.user.emailVerified, false);
    assert.equal(
      h.sqlite.prepare("SELECT count(*) AS n FROM auth_user").get().n,
      0,
    );
    assert.equal(h.messages.length, 0);
    assert.throws(
      () =>
        h.sqlite
          .prepare(
            "INSERT INTO auth_user(id,name,email,email_verified,created_at,updated_at) VALUES (?,?,?,?,?,?)",
          )
          .run("another-id", "Wrong", "learner@example.com", 1, 1, 1),
      /AUTH_EMAIL_RESERVATION_CONFLICT/,
    );
    assert.throws(
      () =>
        h.sqlite
          .prepare(
            "INSERT INTO users(id,email,display_name,is_profile_public,created_at) VALUES (?,?,?,?,?)",
          )
          .run("another-id", "learner@example.com", "Wrong", 0, 1),
      /UNIQUE/,
    );
    await createManagedSession(h.db, h.env, "future-owner", {
      email: "future@example.com",
    });
    assert.throws(
      () =>
        h.sqlite
          .prepare(
            "INSERT INTO users(id,email,display_name,is_profile_public,created_at) VALUES (?,?,?,?,?)",
          )
          .run("wrong-owner", "FUTURE@example.com", "Wrong", 0, 1),
      /AUTH_EMAIL_RESERVATION_CONFLICT/,
    );
    const unverified = await createManagedSession(
      h.db,
      h.env,
      "unverified-account",
      { emailVerified: false },
    );
    assert.equal(
      (await h.call("/api/v1/me", undefined, unverified.headers)).status,
      401,
    );
    assert.equal(
      (
        await h.call(
          "/api/auth/link-social",
          { provider: "google" },
          unverified.headers,
        )
      ).status,
      401,
    );
  } finally {
    h.sqlite.close();
  }
});

test("production session cookies are secure and expired update-age sessions renew through the learner API", async () => {
  const h = harness({
    environment: "production",
    authBaseUrl: "https://therapy-deliberate-practice.com",
  });
  try {
    const old = await createManagedSession(h.db, h.env, "renewed-user", {
      createdAt: new Date(Date.now() - 86401_000),
    });
    assert.match(old.cookie, /^__Secure-therapy\.session_token=/);
    const response = await h.app.request(
      "https://therapy-deliberate-practice.com/api/v1/me",
      { headers: old.headers },
    );
    assert.equal(response.status, 200);
    const setCookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-therapy.session_token="));
    assert.ok(setCookie);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/i);
    const [renewed] = await h.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, old.session.id));
    assert.ok(renewed.updatedAt.getTime() > old.session.updatedAt.getTime());
  } finally {
    h.sqlite.close();
  }
});

test("auth request logs redact reset tokens in paths and callback query credentials", async () => {
  const h = harness();
  const logs: string[] = [];
  const original = console.log;
  try {
    console.log = (...args) => {
      logs.push(args.join(" "));
    };
    await h.call(
      "/api/auth/reset-password/sensitive-reset-token?callbackURL=http%3A%2F%2Flocalhost%2Freset-password",
    );
    await h.call(
      "/api/auth/callback/google?code=sensitive-provider-code&state=sensitive-state",
    );
    assert.ok(logs.some((value) => value.includes("[redacted]")));
    assert.ok(
      logs.every(
        (value) =>
          !value.includes("sensitive-reset-token") &&
          !value.includes("sensitive-provider-code") &&
          !value.includes("sensitive-state"),
      ),
    );
  } finally {
    console.log = original;
    h.sqlite.close();
  }
});
