import { serve } from "@hono/node-server";
import { createApiApp, resolveNodeEnv } from "./index";
import { ensureSchema } from "./db/init";
import { createSqliteDb } from "./db/sqlite";
import { seedExercises } from "./seed";

const runtimeEnv = resolveNodeEnv();
ensureSchema(runtimeEnv.dbPath);
const db = createSqliteDb(runtimeEnv.dbPath);
await seedExercises(db);

const app = createApiApp({ env: runtimeEnv, db });

serve({
  fetch: app.fetch,
  port: 8787
});
