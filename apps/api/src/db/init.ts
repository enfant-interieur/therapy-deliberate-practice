import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const ensureSchema = (dbPath: string) => {
  const sqlite = new Database(dbPath);
  const migrationPath = path.resolve(process.cwd(), "infra/migrations/0001_init.sql");
  const sql = fs.readFileSync(migrationPath, "utf8");
  sqlite.exec(sql);
  sqlite.close();
};
