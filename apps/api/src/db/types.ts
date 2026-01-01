import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export type ApiDatabase = DrizzleD1Database | BetterSQLite3Database;
