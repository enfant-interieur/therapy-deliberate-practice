import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import type { ApiDatabase } from "./types";

export const createSqliteDb = (dbPath: string): ApiDatabase => {
  const sqlite = new Database(dbPath);
  return drizzle(sqlite, { schema }) as unknown as ApiDatabase;
};
