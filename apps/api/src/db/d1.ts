import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";
import * as schema from "./schema";
import type { ApiDatabase } from "./types";

export const createD1Db = (db: D1Database): ApiDatabase =>
  drizzle(db, { schema });
