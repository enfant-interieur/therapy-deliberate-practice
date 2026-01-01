import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const ensureSchema = (dbPath: string) => {
  const sqlite = new Database(dbPath);
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"
  );
  const migrationCandidates = [
    path.resolve(process.cwd(), "apps/worker/migrations"),
    path.resolve(process.cwd(), "../worker/migrations")
  ];
  const migrationDir =
    migrationCandidates.find((candidate) => fs.existsSync(candidate)) ??
    path.resolve(process.cwd(), "apps/worker/migrations");
  const migrations = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
  for (const migration of migrations) {
    const applied = sqlite.prepare("SELECT name FROM _migrations WHERE name = ?").get(migration);
    if (applied) continue;
    const migrationPath = path.join(migrationDir, migration);
    const sql = fs.readFileSync(migrationPath, "utf8");
    sqlite.exec(sql);
    sqlite
      .prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)")
      .run(migration, Date.now());
  }
  sqlite.close();
};
