import { serve } from "@hono/node-server";
import { createApiApp, resolveNodeEnv } from "./index";
import { ensureSchema } from "./db/init";
import { createSqliteDb } from "./db/sqlite";
import { seedDatabase } from "./seed";
import { createR2Client } from "./utils/r2S3";

const runtimeEnv = resolveNodeEnv();
ensureSchema(runtimeEnv.dbPath);
const db = createSqliteDb(runtimeEnv.dbPath);
await seedDatabase(runtimeEnv.dbPath);

const storage = createR2Client(runtimeEnv);
const app = createApiApp({ env: runtimeEnv, db, tts: { storage } });

serve({
  fetch: app.fetch,
  port: 8787
});
