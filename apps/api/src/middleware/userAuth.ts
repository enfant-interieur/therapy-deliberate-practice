import { jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { ApiDatabase } from "../db/types";
import type { RuntimeEnv } from "../env";
import { users, userSettings } from "../db/schema";

export type UserIdentity = {
  id: string;
  email: string | null;
};

const ensureUserRecords = async (db: ApiDatabase, identity: UserIdentity) => {
  const now = Date.now();
  if (identity.email) {
    await db
      .insert(users)
      .values({ id: identity.id, email: identity.email, created_at: now })
      .onConflictDoUpdate({
        target: users.id,
        set: { email: identity.email }
      });
  } else {
    await db
      .insert(users)
      .values({ id: identity.id, email: `user-${identity.id}@example.invalid`, created_at: now })
      .onConflictDoNothing();
  }

  await db
    .insert(userSettings)
    .values({
      user_id: identity.id,
      ai_mode: "local_prefer",
      local_stt_url: null,
      local_llm_url: null,
      store_audio: false,
      openai_key_ciphertext: null,
      openai_key_iv: null,
      openai_key_kid: null,
      created_at: now,
      updated_at: now
    })
    .onConflictDoNothing();
};

export const createUserAuth = (env: RuntimeEnv, db: ApiDatabase): MiddlewareHandler => {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!env.supabaseJwtSecret) {
      return c.json({ error: "SUPABASE_JWT_SECRET is not configured" }, 500);
    }

    const token = authHeader.replace("Bearer ", "").trim();

    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(env.supabaseJwtSecret), {
        algorithms: ["HS256"]
      });
      const sub = typeof payload.sub === "string" ? payload.sub : null;
      const email = typeof payload.email === "string" ? payload.email : null;

      if (!sub) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const identity: UserIdentity = { id: sub, email };
      await ensureUserRecords(db, identity);
      c.set("user", identity);
      await next();
    } catch (error) {
      console.error("Supabase JWT verification failed", error);
      return c.json({ error: "Unauthorized" }, 401);
    }
  };
};
