import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

export const createSqliteDb = (dbPath: string): BetterSQLite3Database => {
  const sqlite = new Database(dbPath);
  return drizzle(sqlite);
};
