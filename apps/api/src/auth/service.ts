import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { sql } from "drizzle-orm";
import { importPKCS8, SignJWT } from "jose";
import type { ApiDatabase } from "../db/types";
import { users } from "../db/schema";
import type { RuntimeEnv } from "../env";
import { authSchema } from "./schema";
import { authEmail, type AuthEmailSender } from "./email";
import {
  hashPassword,
  verifyPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from "./password";

export type ApplicationAuth = ReturnType<typeof betterAuth>;
const FRESH_SESSION_SECONDS = 300;
const ACCOUNT_CHANGE_PATHS = new Set([
  "/link-social",
  "/unlink-account",
  "/change-password",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
]);

export const getProviderAvailability = (env: RuntimeEnv) => ({
  google: Boolean(env.googleClientId && env.googleClientSecret),
  github: Boolean(env.githubClientId && env.githubClientSecret),
  apple: Boolean(
    env.appleClientId &&
    env.appleTeamId &&
    env.appleKeyId &&
    env.applePrivateKey,
  ),
});

export function applicationOrigins(env: RuntimeEnv): string[] {
  const origins = [env.authBaseUrl, ...env.authTrustedOrigins].map((value) => {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          env.environment !== "production" &&
          local &&
          url.protocol === "http:"
        ))
    ) {
      throw new Error("Authentication requires an exact secure origin");
    }
    return url.origin;
  });
  return [...new Set(origins)];
}

export async function appleClientSecret(env: RuntimeEnv): Promise<string> {
  const key = await importPKCS8(
    env.applePrivateKey.replace(/\\n/g, "\n"),
    "ES256",
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: env.appleKeyId })
    .setIssuer(env.appleTeamId)
    .setSubject(env.appleClientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

export function createApplicationAuth(
  env: RuntimeEnv,
  db: ApiDatabase,
  sendEmail?: AuthEmailSender,
): ApplicationAuth | null {
  if (env.authSecret.length < 32) return null;
  const trustedOrigins = applicationOrigins(env);
  const availability = getProviderAvailability(env);
  const socialProviders: BetterAuthOptions["socialProviders"] = {};
  if (availability.google)
    socialProviders.google = {
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
    };
  if (availability.github)
    socialProviders.github = {
      clientId: env.githubClientId,
      clientSecret: env.githubClientSecret,
    };
  if (availability.apple)
    socialProviders.apple = async () => ({
      clientId: env.appleClientId,
      clientSecret: await appleClientSecret(env),
    });
  const deliver = async (
    to: string,
    url: string,
    kind: "verification" | "reset",
    request?: Request,
  ) => {
    if (!sendEmail)
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: "EMAIL_DELIVERY_UNAVAILABLE",
        message: "Email delivery is temporarily unavailable.",
      });
    const language = request?.headers
      .get("accept-language")
      ?.toLowerCase()
      .startsWith("fr")
      ? "fr"
      : "en";
    await sendEmail(authEmail(to, url, kind, language));
  };
  let auth: ApplicationAuth;
  const options: BetterAuthOptions = {
    appName: "Therapy Studio",
    secret: env.authSecret,
    baseURL: env.authBaseUrl,
    basePath: "/api/auth",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
      transaction: false,
    }),
    trustedOrigins: availability.apple
      ? [...trustedOrigins, "https://appleid.apple.com"]
      : trustedOrigins,
    socialProviders,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }, request) =>
        deliver(user.email, url, "reset", request),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: ({ user, url }, request) =>
        deliver(user.email, url, "verification", request),
    },
    session: {
      expiresIn: 7 * 86400,
      updateAge: 86400,
      freshAge: FRESH_SESSION_SECONDS,
      cookieCache: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
      storeAccountCookie: false,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    verification: { storeIdentifier: "hashed" },
    advanced: {
      cookiePrefix: "therapy",
      useSecureCookies: env.environment === "production",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.environment === "production",
        path: "/",
      },
      ipAddress: {
        ipAddressHeaders:
          env.environment === "production"
            ? ["cf-connecting-ip"]
            : ["x-test-client-ip"],
      },
      database: { generateId: () => crypto.randomUUID() },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 5 },
      },
    },
    logger: {
      level: "error",
      log: () => {
        console.warn(JSON.stringify({ event: "auth.library.error" }));
      },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const [profile] = await db
              .select({ id: users.id })
              .from(users)
              .where(
                sql`lower(trim(${users.email})) = ${user.email.trim().toLowerCase()}`,
              )
              .limit(1);
            if (profile && profile.id !== user.id)
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_MIGRATION_REQUIRED",
                message: "This account requires its existing sign-in method.",
              });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ACCOUNT_CHANGE_PATHS.has(ctx.path)) return;
        const session = await auth.api.getSession({
          headers: ctx.headers ?? new Headers(),
        });
        if (
          !session?.user.emailVerified ||
          Date.now() - new Date(session.session.createdAt).getTime() >
            FRESH_SESSION_SECONDS * 1000
        ) {
          throw new APIError("UNAUTHORIZED", {
            code: "FRESH_SESSION_REQUIRED",
            message: "Sign in again before changing your account.",
          });
        }
      }),
    },
  };
  auth = betterAuth(options);
  return auth;
}
