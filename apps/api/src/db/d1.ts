import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { D1Database } from "@cloudflare/workers-types";

export const createD1Db = (db: D1Database): DrizzleD1Database => drizzle(db);
