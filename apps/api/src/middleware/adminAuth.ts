import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { RuntimeEnv } from "../env";
import { logServerError } from "../utils/logger";
import type { ApiHonoEnv } from "../httpTypes";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type AccessIdentity = {
  isAuthenticated: boolean;
  email: string | null;
  groups: string[];
  verifiedAccessJwt: boolean;
};

type AccessResolution =
  | { ok: true; identity: AccessIdentity }
  | { ok: false; status: number; message: string };

type AdminResolution =
  | {
      ok: true;
      identity: AccessIdentity;
      isAdmin: boolean;
      devBypass?: boolean;
    }
  | { ok: false; status: number; message: string };

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<
  string,
  { jwks: ReturnType<typeof createRemoteJWKSet>; expiresAt: number }
>();

const getCachedJwks = (issuer: string) => {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }
  const jwksUrl = new URL("/cdn-cgi/access/certs", issuer);
  const jwks = createRemoteJWKSet(jwksUrl, { cacheMaxAge: JWKS_TTL_MS });
  jwksCache.set(issuer, { jwks, expiresAt: Date.now() + JWKS_TTL_MS });
  return jwks;
};

export const isCloudflareAccessIssuer = (issuer: string) => {
  try {
    const url = new URL(issuer);
    return (
      url.protocol === "https:" &&
      url.hostname.endsWith(".cloudflareaccess.com") &&
      url.hostname.length > ".cloudflareaccess.com".length &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.pathname === "" || url.pathname === "/") &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
};

const normalizeEmail = (email?: string | null) =>
  email?.trim().toLowerCase() ?? null;

const extractGroups = (payload: Record<string, unknown>) => {
  const groupsClaim =
    payload.groups ?? payload["https://schemas.cloudflareaccess.com/groups"];
  if (!Array.isArray(groupsClaim)) return [];
  return groupsClaim.filter(
    (group): group is string => typeof group === "string",
  );
};

const resolveAccessIdentity = async (
  env: RuntimeEnv,
  headers: { get: (name: string) => string | null },
  options: { requireAccessJwt?: boolean } = {},
): Promise<AccessResolution> => {
  const token = headers.get("cf-access-jwt-assertion");
  const emailHeader = headers.get("cf-access-authenticated-user-email");

  if (!token) {
    if (options.requireAccessJwt) {
      return {
        ok: true,
        identity: {
          isAuthenticated: false,
          email: null,
          groups: [],
          verifiedAccessJwt: false,
        },
      };
    }
    if (!emailHeader) {
      return {
        ok: true,
        identity: {
          isAuthenticated: false,
          email: null,
          groups: [],
          verifiedAccessJwt: false,
        },
      };
    }
    return {
      ok: true,
      identity: {
        isAuthenticated: true,
        email: normalizeEmail(emailHeader),
        groups: [],
        verifiedAccessJwt: false,
      },
    };
  }

  if (!env.cfAccessAud) {
    return {
      ok: false,
      status: 500,
      message: "CF_ACCESS_AUD is not configured",
    };
  }
  if (!env.cfAccessIssuer || !isCloudflareAccessIssuer(env.cfAccessIssuer)) {
    return {
      ok: false,
      status: 500,
      message: "CF_ACCESS_ISSUER is not configured correctly",
    };
  }

  try {
    const decoded = decodeJwt(token);
    const issuer = typeof decoded.iss === "string" ? decoded.iss : null;
    if (issuer !== env.cfAccessIssuer) {
      return { ok: false, status: 401, message: "Invalid Access issuer" };
    }
    const jwks = getCachedJwks(env.cfAccessIssuer);
    const { payload } = await jwtVerify(token, jwks, {
      audience: env.cfAccessAud,
      issuer: env.cfAccessIssuer,
    });
    const record = payload as Record<string, unknown>;
    const email = normalizeEmail(
      (record.email as string | undefined) ?? emailHeader,
    );
    const groups = extractGroups(record);
    return {
      ok: true,
      identity: {
        isAuthenticated: true,
        email,
        groups,
        verifiedAccessJwt: true,
      },
    };
  } catch (error) {
    console.warn("Access JWT verification failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return { ok: false, status: 401, message: "Invalid Access token" };
  }
};

export const isAdminAllowed = (
  env: RuntimeEnv,
  email: string | null,
  groups: string[],
) => {
  const emailAllowlist = new Set(
    env.adminEmails.map((item) => item.toLowerCase()),
  );
  const groupAllowlist = new Set(env.adminGroups);
  const normalizedEmail = normalizeEmail(email);
  const emailAllowed = normalizedEmail
    ? emailAllowlist.has(normalizedEmail)
    : false;
  const groupAllowed = groups.some((group) => groupAllowlist.has(group));
  return emailAllowed || groupAllowed;
};

export const hasAdminAllowlist = (env: RuntimeEnv) =>
  env.adminEmails.length > 0 || env.adminGroups.length > 0;

const isDevBypassEnabled = (env: RuntimeEnv) =>
  env.environment === "development" && env.bypassAdminAuth;

export const resolveAdminStatus = async (
  env: RuntimeEnv,
  headers: { get: (name: string) => string | null },
): Promise<AdminResolution> => {
  if (isDevBypassEnabled(env)) {
    const devToken = headers.get("x-dev-admin-token");
    const devTokenRequired = Boolean(env.devAdminToken);
    const devTokenValid = devTokenRequired
      ? devToken === env.devAdminToken
      : true;
    if (devTokenValid) {
      return {
        ok: true,
        identity: {
          isAuthenticated: true,
          email: "dev-admin",
          groups: [],
          verifiedAccessJwt: true,
        },
        isAdmin: true,
        devBypass: true,
      };
    }
  }

  const result = await resolveAccessIdentity(env, headers, {
    requireAccessJwt: true,
  });
  if (!result.ok) {
    return result;
  }
  const identity = result.identity;
  const isAdmin =
    identity.isAuthenticated &&
    identity.verifiedAccessJwt &&
    hasAdminAllowlist(env) &&
    isAdminAllowed(env, identity.email, identity.groups);
  return { ok: true as const, identity, isAdmin };
};

export const createAdminAuth = (
  env: RuntimeEnv,
): MiddlewareHandler<ApiHonoEnv> => {
  return async (c, next) => {
    const result = await resolveAdminStatus(env, c.req.raw.headers);
    if (!result.ok) {
      if (result.status >= 500) {
        logServerError("admin.auth.error", new Error(result.message), {
          requestId: c.get("requestId"),
          status: result.status,
        });
      }
      return c.json(
        { error: result.message },
        result.status as ContentfulStatusCode,
      );
    }
    if (result.devBypass) {
      c.set("adminEmail", result.identity.email);
      c.set("isAdmin", true);
      await next();
      return;
    }
    if (!result.identity.isAuthenticated) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    if (!result.isAdmin) {
      return c.json({ error: "Forbidden" }, 403);
    }

    c.set("adminEmail", result.identity.email);
    c.set("isAdmin", true);
    await next();
  };
};
