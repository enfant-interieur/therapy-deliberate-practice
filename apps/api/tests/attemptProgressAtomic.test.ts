import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { ensureSchema } from "../src/db/init";

test("attempt completion and adaptive progress update are one atomic, retry-safe mutation", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-attempt-progress-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const sqlite = new Database(dbPath);

  try {
    const now = Date.now();
    sqlite
      .prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("learner-1", "learner@example.com", "Learner", now);
    sqlite
      .prepare(
        "INSERT INTO users (id, email, display_name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run("learner-failure", "failure@example.com", "Failure", now);
    sqlite
      .prepare(
        `INSERT INTO tasks (
          id, slug, title, description, skill_domain, base_difficulty,
          general_objective, tags, language, is_published, parent_task_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, NULL, ?, ?)`,
      )
      .run(
        "task-1",
        "task-1",
        "Task",
        "Description",
        "validation",
        2,
        "[]",
        "en",
        now,
        now,
      );
    const insertExample = sqlite.prepare(
      `INSERT INTO task_examples (
        id, task_id, difficulty, severity_label, patient_text, language,
        meta, created_at, updated_at
      ) VALUES (?, 'task-1', 2, NULL, ?, 'en', NULL, ?, ?)`,
    );
    for (const id of ["example-1", "example-2", "example-3"]) {
      insertExample.run(id, id, now, now);
    }

    const insertAttempt = sqlite.prepare(
      `INSERT INTO attempts (
        id, user_id, task_id, example_id, started_at, completed_at,
        transcript, evaluation, overall_pass, overall_score, score_trust
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    insertAttempt.run(
      "attempt-1",
      "learner-1",
      "task-1",
      "example-1",
      now,
      "Response",
      "{}",
      1,
      3.8,
      "cloud",
    );
    insertAttempt.run(
      "attempt-2",
      "learner-1",
      "task-1",
      "example-2",
      now + 1,
      "Response",
      "{}",
      1,
      3.6,
      "cloud",
    );

    const complete = sqlite.prepare(
      "UPDATE attempts SET completed_at = ? WHERE id = ? AND completed_at IS NULL",
    );
    assert.equal(complete.run(now + 10, "attempt-1").changes, 1);
    assert.equal(complete.run(now + 11, "attempt-2").changes, 1);
    assert.equal(complete.run(now + 12, "attempt-2").changes, 0);

    const progress = sqlite
      .prepare(
        `SELECT current_difficulty, streak, attempt_count
         FROM user_task_progress
         WHERE user_id = ? AND task_id = ?`,
      )
      .get("learner-1", "task-1") as {
      current_difficulty: number;
      streak: number;
      attempt_count: number;
    };
    assert.deepEqual(progress, {
      current_difficulty: 4,
      streak: 2,
      attempt_count: 2,
    });

    insertAttempt.run(
      "attempt-failure",
      "learner-failure",
      "task-1",
      "example-3",
      now + 2,
      "Response",
      "{}",
      1,
      4,
      "cloud",
    );
    sqlite.exec(`
      CREATE TRIGGER reject_failure_progress
      BEFORE INSERT ON user_task_progress
      WHEN NEW.user_id = 'learner-failure'
      BEGIN
        SELECT RAISE(ABORT, 'forced progress failure');
      END;
    `);

    assert.throws(
      () => complete.run(now + 20, "attempt-failure"),
      /forced progress failure/,
    );
    const failedAttempt = sqlite
      .prepare("SELECT completed_at FROM attempts WHERE id = ?")
      .get("attempt-failure") as { completed_at: number | null };
    assert.equal(failedAttempt.completed_at, null);
    const failedProgress = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM user_task_progress WHERE user_id = ?",
      )
      .get("learner-failure") as { count: number };
    assert.equal(failedProgress.count, 0);
  } finally {
    sqlite.close();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
