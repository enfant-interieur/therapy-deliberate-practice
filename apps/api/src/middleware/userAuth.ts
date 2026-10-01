import type { MiddlewareHandler } from "hono";
import type { ApiDatabase } from "../db/types";
import type { RuntimeEnv } from "../env";
import { users, userSettings } from "../db/schema";
import { applicationOrigins, type ApplicationAuth } from "../auth/service";
import { DEFAULT_LOCAL_BASE_URL } from "../providers/config";
import type { ApiHonoEnv, UserIdentity } from "../httpTypes";

export type { UserIdentity } from "../httpTypes";

const buildAnonymousDisplayName = (userId: string) => {
  const fallback =
    userId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase() || "PLAYER";
  const suffix = fallback.slice(0, 6).padEnd(6, "X");
  return `Player ${suffix}`;
};

export const ensureUserRecords = async (
  db: ApiDatabase,
  identity: UserIdentity,
) => {
  const now = Date.now();
  const defaultDisplayName = buildAnonymousDisplayName(identity.id);
  if (identity.email) {
    await db
      .insert(users)
      .values({
        id: identity.id,
        email: identity.email,
        display_name: defaultDisplayName,
        is_profile_public: true,
        created_at: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: identity.email },
      });
  } else {
    await db
      .insert(users)
      .values({
        id: identity.id,
        email: `user-${identity.id}@example.invalid`,
        display_name: defaultDisplayName,
        is_profile_public: true,
        created_at: now,
      })
      .onConflictDoNothing();
  }

  await db
    .insert(userSettings)
    .values({
      user_id: identity.id,
      ai_mode: "local_prefer",
      local_base_url: DEFAULT_LOCAL_BASE_URL,
      local_stt_url: null,
      local_llm_url: null,
      store_audio: false,
      openai_key_ciphertext: null,
      openai_key_iv: null,
      openai_key_kid: null,
      created_at: now,
      updated_at: now,
    })
    .onConflictDoNothing();
};

export const createUserAuth = (
  env: RuntimeEnv,
  db: ApiDatabase,
  auth: ApplicationAuth | null,
): MiddlewareHandler<ApiHonoEnv> => {
  return async (c, next) => {
    if (!auth)
      return c.json(
        { error: "Authentication is temporarily unavailable" },
        503,
      );
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("Origin");
      if (!origin || !applicationOrigins(env).includes(origin)) {
        return c.json({ error: "Request origin is not allowed" }, 403);
      }
    }
    try {
      const { response: session, headers } = await auth.api.getSession({
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      if (!session?.user.emailVerified)
        return c.json({ error: "Unauthorized" }, 401);
      const identity: UserIdentity = {
        id: session.user.id,
        email: session.user.email,
      };
      await ensureUserRecords(db, identity);
      for (const cookie of headers.getSetCookie())
        c.header("Set-Cookie", cookie, { append: true });
      c.header("Cache-Control", "no-store");
      c.set("user", identity);
    } catch {
      console.warn(
        JSON.stringify({
          event: "auth.session.unavailable",
          requestId: c.get("requestId"),
        }),
      );
      return c.json(
        { error: "Authentication is temporarily unavailable" },
        503,
      );
    }
    await next();
  };
};
