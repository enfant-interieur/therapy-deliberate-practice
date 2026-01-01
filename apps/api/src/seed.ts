import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const seedDatabase = async (dbPath: string) => {
  const sqlite = new Database(dbPath);
  const tableExists = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
    .get();
  if (!tableExists) {
    sqlite.close();
    return;
  }
  const existing = sqlite.prepare("SELECT id FROM tasks LIMIT 1").get();
  if (existing) {
    sqlite.close();
    return;
  }
  const seedPathCandidates = [
    path.resolve(process.cwd(), "apps/api/infra/seed.sql"),
    path.resolve(process.cwd(), "infra/seed.sql")
  ];
  const seedPath =
    seedPathCandidates.find((candidate) => fs.existsSync(candidate)) ?? seedPathCandidates[0];
  const seedSql = fs.readFileSync(seedPath, "utf8");
  sqlite.exec(seedSql);
  sqlite.close();
};
