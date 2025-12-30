import type { D1Database } from "@cloudflare/workers-types";
import { createApiApp } from "../../api/src/app";
import { createD1Db } from "../../api/src/db/d1";
import { resolveEnv, type EnvBindings } from "../../api/src/env";

export type WorkerEnv = EnvBindings & {
  DB: D1Database;
  ASSETS: Fetcher;
};

let cachedApp: ReturnType<typeof createApiApp> | null = null;

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    if (!cachedApp) {
      cachedApp = createApiApp({
        env: resolveEnv(env),
        db: createD1Db(env.DB)
      });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return cachedApp.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  }
};
