import assert from "node:assert/strict";
import { test } from "node:test";
import Database from "better-sqlite3";
import { drizzle as drizzleBetterSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { runAtomicMutation } from "../src/db/atomic";
import { tasks } from "../src/db/schema";
import type { ApiDatabase } from "../src/db/types";

const taskTableSql = `
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    skill_domain TEXT NOT NULL,
    base_difficulty INTEGER NOT NULL,
    general_objective TEXT,
    tags TEXT NOT NULL,
    authors TEXT NOT NULL DEFAULT '[]',
    language TEXT NOT NULL,
    is_published INTEGER NOT NULL,
    parent_task_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const taskValue = (id: string, slug = id) => ({
  id,
  slug,
  title: id,
  description: "Description",
  skill_domain: "validation",
  base_difficulty: 2,
  general_objective: null,
  tags: [],
  authors: [],
  language: "en",
  is_published: true,
  parent_task_id: null,
  created_at: 1,
  updated_at: 1,
});

const exerciseAtomicContract = async (db: ApiDatabase) => {
  await runAtomicMutation(db, (executor) => [
    executor.insert(tasks).values(taskValue("task-a")),
    executor.insert(tasks).values(taskValue("task-b")),
  ]);
  assert.equal((await db.select().from(tasks)).length, 2);

  await assert.rejects(() =>
    runAtomicMutation(db, (executor) => [
      executor.insert(tasks).values(taskValue("must-rollback")),
      executor.insert(tasks).values(taskValue("duplicate", "task-a")),
    ]),
  );
  assert.equal(
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.id, "must-rollback"))
    ).length,
    0,
  );
};

test("atomic mutation uses the real better-sqlite3 transaction boundary", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(taskTableSql);
    const db = drizzleBetterSqlite(sqlite) as unknown as ApiDatabase;
    await exerciseAtomicContract(db);
  } finally {
    sqlite.close();
  }
});

test("atomic mutation uses the real workerd D1 batch transaction boundary", async () => {
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('ok'); } }",
      d1Databases: { DB: "atomic-contract-test" },
    }),
  );
  try {
    const binding = await miniflare.getD1Database("DB");
    await binding.prepare(taskTableSql).run();
    const db = drizzleD1(binding);
    await exerciseAtomicContract(db);
  } finally {
    await miniflare.dispose();
  }
});
