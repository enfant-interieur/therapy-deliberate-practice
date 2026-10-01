import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import Database from "better-sqlite3";
import { ensureSchema } from "../src/db/init";

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../worker/migrations",
);

const migrationSql = (name: string) =>
  readFileSync(path.join(migrationsDirectory, name), "utf8");

const productionMigrations = [
  "0001_init_v2.sql",
  "0002_add_tts_assets.sql",
  "0003_add_task_language.sql",
  "0004_add_minigames.sql",
  "0005_add_task_interaction_examples.sql",
  "0006_add_user_profiles.sql",
  "0007_minigame_sessions_history_resume.sql",
  "0008_add_minigame_prompt_history.sql",
  "0009_add_local_base_url.sql",
  "0010_add_task_authors.sql",
  "0011_add_admin_batch_parse_jobs.sql",
  "0012_add_batch_parse_queue_support.sql",
  "0013_add_profile_privacy.sql",
] as const;

const portMigrations = [
  "0014_add_score_trust.sql",
  "0015_unique_minigame_round_player.sql",
  "0016_atomic_attempt_progress.sql",
  "0017_release_story_invariants.sql",
  "0018_minigame_submission_claims.sql",
  "0019_application_auth.sql",
] as const;

test("the data-bearing production schema upgrades through every port migration", () => {
  const sqlite = new Database(":memory:");
  try {
    for (const migration of productionMigrations) {
      sqlite.exec(migrationSql(migration));
    }
    sqlite.exec(`
      INSERT INTO users (
        id, email, display_name, bio, is_profile_public, created_at
      ) VALUES (
        'production-user', 'production@example.com', 'Production User',
        'Existing profile', 1, 1
      );
      INSERT INTO user_settings (
        user_id, ai_mode, local_base_url, local_stt_url, local_llm_url,
        store_audio, openai_key_ciphertext, openai_key_iv, openai_key_kid,
        updated_at, created_at
      ) VALUES (
        'production-user', 'openai_only', 'http://127.0.0.1:8484',
        NULL, NULL, 0, NULL, NULL, NULL, 1, 1
      );
      INSERT INTO tasks (
        id, slug, title, description, skill_domain, base_difficulty,
        general_objective, tags, authors, is_published, parent_task_id,
        created_at, updated_at, language
      ) VALUES (
        'production-task', 'production-task', 'Production task',
        'Existing task', 'test', 2, NULL, '["existing"]',
        '["Existing Author"]', 1, NULL, 1, 1, 'fr'
      );
      INSERT INTO task_examples (
        id, task_id, difficulty, severity_label, patient_text, meta,
        created_at, updated_at, language
      ) VALUES (
        'production-example', 'production-task', 2, NULL,
        'Existing patient prompt', NULL, 1, 1, 'fr'
      );
      INSERT INTO attempts (
        id, user_id, task_id, example_id, started_at, completed_at,
        transcript, evaluation, overall_pass, overall_score, model_info
      ) VALUES (
        'production-attempt', 'production-user', 'production-task',
        'production-example', 1, 2, 'Existing transcript', '{}', 1, 3.5,
        '{"provider":{"llm":{"kind":"openai","model":"gpt-test"}}}'
      );
      INSERT INTO minigame_sessions (
        id, user_id, game_type, visibility_mode, task_selection, settings,
        created_at, ended_at, last_active_at, current_round_id,
        current_player_id, deleted_at
      ) VALUES (
        'production-game', 'production-user', 'ffa', 'normal', '{}', '{}',
        1, 2, 2, NULL, NULL, NULL
      );
      INSERT INTO minigame_players (
        id, session_id, name, avatar, team_id, created_at
      ) VALUES (
        'production-player', 'production-game', 'Player', 'avatar', NULL, 1
      );
      INSERT INTO minigame_rounds (
        id, session_id, position, task_id, example_id, player_a_id,
        player_b_id, team_a_id, team_b_id, status, started_at, completed_at
      ) VALUES (
        'production-round', 'production-game', 0, 'production-task',
        'production-example', 'production-player', NULL, NULL, NULL,
        'completed', 1, 2
      );
      INSERT INTO minigame_round_results (
        id, round_id, player_id, attempt_id, overall_score, overall_pass,
        created_at
      ) VALUES
        (
          'production-result', 'production-round', 'production-player',
          'production-attempt', 3.5, 1, 2
        ),
        (
          'legacy-duplicate', 'production-round', 'production-player',
          'legacy-duplicate-attempt', 1.0, 0, 3
        );
    `);

    for (const migration of portMigrations) {
      sqlite.exec(migrationSql(migration));
    }

    assert.deepEqual(
      sqlite
        .prepare(
          `SELECT display_name, bio, is_profile_public
           FROM users WHERE id = 'production-user'`,
        )
        .get(),
      {
        display_name: "Production User",
        bio: "Existing profile",
        is_profile_public: 1,
      },
    );
    assert.deepEqual(
      sqlite
        .prepare(
          `SELECT language, authors, is_published
           FROM tasks WHERE id = 'production-task'`,
        )
        .get(),
      {
        language: "fr",
        authors: '["Existing Author"]',
        is_published: 1,
      },
    );
    assert.deepEqual(
      sqlite
        .prepare(
          `SELECT transcript, overall_score, score_trust
           FROM attempts WHERE id = 'production-attempt'`,
        )
        .get(),
      {
        transcript: "Existing transcript",
        overall_score: 3.5,
        score_trust: "cloud_trusted",
      },
    );
    assert.equal(
      sqlite
        .prepare(
          `SELECT COUNT(*) AS count FROM minigame_round_results
           WHERE round_id = 'production-round'
             AND player_id = 'production-player'`,
        )
        .get<{ count: number }>()?.count,
      1,
    );
    assert.deepEqual(
      sqlite
        .prepare(
          `SELECT round_id, player_id, attempt_id
           FROM minigame_submission_claims`,
        )
        .all(),
      [
        {
          round_id: "production-round",
          player_id: "production-player",
          attempt_id: "production-attempt",
        },
      ],
    );
    assert.equal(sqlite.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    sqlite.close();
  }
});

test("score trust migration promotes only positive hosted-provider provenance", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE attempts (
        id TEXT PRIMARY KEY,
        completed_at INTEGER,
        model_info TEXT
      );
    `);
    const insert = sqlite.prepare(
      "INSERT INTO attempts (id, completed_at, model_info) VALUES (?, ?, ?)",
    );
    insert.run(
      "openai",
      1,
      JSON.stringify({
        provider: { llm: { kind: "openai", model: "gpt-test" } },
      }),
    );
    insert.run(
      "local",
      1,
      JSON.stringify({
        provider: { llm: { kind: "local", model: "qwen-test" } },
      }),
    );
    insert.run("missing", 1, null);
    insert.run("malformed", 1, "{not-json");

    sqlite.exec(migrationSql("0014_add_score_trust.sql"));
    const rows = sqlite
      .prepare("SELECT id, score_trust FROM attempts ORDER BY id")
      .all() as Array<{ id: string; score_trust: string }>;
    assert.deepEqual(rows, [
      { id: "local", score_trust: "local_unverified" },
      { id: "malformed", score_trust: "local_unverified" },
      { id: "missing", score_trust: "local_unverified" },
      { id: "openai", score_trust: "cloud_trusted" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("minigame uniqueness migration reconciles legacy duplicates before indexing", () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE minigame_round_results (
        id TEXT PRIMARY KEY,
        round_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL
      );
      INSERT INTO minigame_round_results VALUES
        ('first-pair', 'round-1', 'player-1', 'attempt-1'),
        ('duplicate-pair', 'round-1', 'player-1', 'attempt-2'),
        ('duplicate-attempt', 'round-2', 'player-2', 'attempt-1'),
        ('unique', 'round-2', 'player-3', 'attempt-3');
    `);

    sqlite.exec(migrationSql("0015_unique_minigame_round_player.sql"));
    const rows = sqlite
      .prepare("SELECT id FROM minigame_round_results ORDER BY id")
      .all() as Array<{ id: string }>;
    assert.deepEqual(rows, [{ id: "first-pair" }, { id: "unique" }]);
    assert.throws(() =>
      sqlite
        .prepare("INSERT INTO minigame_round_results VALUES (?, ?, ?, ?)")
        .run("new-pair-duplicate", "round-1", "player-1", "attempt-4"),
    );
    assert.throws(() =>
      sqlite
        .prepare("INSERT INTO minigame_round_results VALUES (?, ?, ?, ?)")
        .run("new-attempt-duplicate", "round-3", "player-4", "attempt-1"),
    );
  } finally {
    sqlite.close();
  }
});

test("release invariants enforce database caps, round identity, and one active round", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "therapy-release-invariants-"),
  );
  const dbPath = path.join(directory, "test.sqlite");
  try {
    ensureSchema(dbPath);
    const sqlite = new Database(dbPath);
    try {
      const insertSession = sqlite.prepare(`
        INSERT INTO minigame_sessions (
          id, user_id, game_type, visibility_mode, task_selection, settings,
          created_at, ended_at, last_active_at, current_round_id,
          current_player_id, deleted_at
        ) VALUES (?, 'user', 'ffa', 'normal', '{}', '{}', 1, NULL, 1, NULL, NULL, NULL)
      `);
      insertSession.run("limits-session");
      insertSession.run("round-session");
      sqlite
        .prepare(
          `
          INSERT INTO tasks (
            id, slug, title, description, skill_domain, base_difficulty,
            general_objective, tags, is_published, parent_task_id,
            created_at, updated_at, language
          ) VALUES (
            'task', 'task', 'Task', 'Test', 'test', 1, NULL, '[]',
            1, NULL, 1, 1, 'en'
          )
        `,
        )
        .run();

      const insertTeam = sqlite.prepare(`
        INSERT INTO minigame_teams (id, session_id, name, color, created_at)
        VALUES (?, 'limits-session', ?, '#000', 1)
      `);
      for (let index = 0; index < 4; index += 1) {
        insertTeam.run(`team-${index}`, `Team ${index}`);
      }
      assert.throws(
        () => insertTeam.run("team-overflow", "Overflow"),
        /MINIGAME_TEAM_LIMIT/,
      );

      const insertPlayer = sqlite.prepare(`
        INSERT INTO minigame_players (
          id, session_id, name, avatar, team_id, created_at
        ) VALUES (?, 'limits-session', ?, 'avatar', NULL, 1)
      `);
      for (let index = 0; index < 16; index += 1) {
        insertPlayer.run(`player-${index}`, `Player ${index}`);
      }
      assert.throws(
        () => insertPlayer.run("player-overflow", "Overflow"),
        /MINIGAME_PLAYER_LIMIT/,
      );

      const insertRound = sqlite.prepare(`
        INSERT INTO minigame_rounds (
          id, session_id, position, task_id, example_id, player_a_id,
          player_b_id, team_a_id, team_b_id, status, started_at, completed_at
        ) VALUES (?, 'limits-session', ?, 'task', 'example', 'player-0',
          NULL, NULL, NULL, 'pending', NULL, NULL)
      `);
      for (let position = 0; position < 320; position += 1) {
        insertRound.run(`limit-round-${position}`, position);
      }
      assert.throws(
        () => insertRound.run("round-overflow", 320),
        /MINIGAME_ROUND_LIMIT/,
      );

      const insertIdentityRound = sqlite.prepare(`
        INSERT INTO minigame_rounds (
          id, session_id, position, task_id, example_id, player_a_id,
          player_b_id, team_a_id, team_b_id, status, started_at, completed_at
        ) VALUES (?, 'round-session', ?, 'task', 'example', 'player',
          NULL, NULL, NULL, ?, NULL, NULL)
      `);
      insertIdentityRound.run("pending-a", 0, "pending");
      assert.throws(
        () => insertIdentityRound.run("position-duplicate", 0, "pending"),
        /MINIGAME_POSITION_CONFLICT/,
      );
      insertIdentityRound.run("pending-b", 2, "pending");
      insertIdentityRound.run("active-a", 1, "active");
      insertIdentityRound.run("pending-after-active", 4, "pending");
      assert.throws(
        () => insertIdentityRound.run("active-b", 3, "active"),
        /MINIGAME_ACTIVE_ROUND/,
      );
      assert.throws(
        () =>
          sqlite
            .prepare(
              "UPDATE minigame_rounds SET status = 'active' WHERE id = 'pending-b'",
            )
            .run(),
        /MINIGAME_ACTIVE_ROUND/,
      );
      sqlite
        .prepare(
          "INSERT INTO minigame_round_start_claims VALUES ('pending-b', 'round-session', 1)",
        )
        .run();
      sqlite
        .prepare(
          "UPDATE minigame_rounds SET status = 'completed' WHERE id = 'pending-b'",
        )
        .run();
      assert.throws(
        () =>
          sqlite
            .prepare(
              `INSERT INTO minigame_round_start_claims
                 VALUES ('pending-b', 'round-session', 2)
               ON CONFLICT(round_id) DO UPDATE SET created_at = excluded.created_at`,
            )
            .run(),
        /MINIGAME_ROUND_START_NOT_PENDING/,
      );
      assert.throws(
        () =>
          sqlite
            .prepare(
              "INSERT INTO minigame_round_start_claims VALUES ('active-a', 'round-session', 1)",
            )
            .run(),
        /MINIGAME_ROUND_START_NOT_PENDING/,
      );
      sqlite
        .prepare(
          "INSERT INTO minigame_redraw_claims VALUES ('pending-a', 'replacement-a', 1)",
        )
        .run();
      assert.throws(
        () =>
          sqlite
            .prepare(
              "INSERT INTO minigame_redraw_claims VALUES ('active-a', 'replacement-b', 1)",
            )
            .run(),
        /MINIGAME_REDRAW_NOT_PENDING/,
      );

      sqlite
        .prepare(
          `
          INSERT INTO tasks (
            id, slug, title, description, skill_domain, base_difficulty,
            general_objective, tags, is_published, parent_task_id,
            created_at, updated_at, language
          ) VALUES (
            'selection-task', 'selection-task', 'Selection task', 'Test',
            'test', 1, NULL, '[]', 1, NULL, 1, 1, 'en'
          )
        `,
        )
        .run();
      assert.equal(
        sqlite
          .prepare(
            "SELECT COUNT(*) AS count FROM tasks WHERE id = 'selection-task'",
          )
          .get<{ count: number }>()?.count,
        1,
      );
      sqlite
        .prepare(
          "UPDATE tasks SET is_published = 0 WHERE id = 'selection-task'",
        )
        .run();
      assert.throws(
        () =>
          sqlite
            .prepare(
              `
              INSERT INTO minigame_sessions (
                id, user_id, game_type, visibility_mode, task_selection,
                settings, created_at, ended_at, last_active_at,
                current_round_id, current_player_id, deleted_at
              ) VALUES (
                'raced-unpublish', 'user', 'ffa', 'normal',
                '{"strategy":"manual","task_ids":["selection-task"]}',
                '{}', 1, NULL, 1, NULL, NULL, NULL
              )
            `,
            )
            .run(),
        /MINIGAME_TASK_SELECTION_INVALID/,
      );
      sqlite.prepare("DELETE FROM tasks WHERE id = 'selection-task'").run();
      assert.throws(
        () =>
          sqlite
            .prepare(
              `
              INSERT INTO minigame_sessions (
                id, user_id, game_type, visibility_mode, task_selection,
                settings, created_at, ended_at, last_active_at,
                current_round_id, current_player_id, deleted_at
              ) VALUES (
                'raced-selection', 'user', 'ffa', 'normal',
                '{"strategy":"manual","task_ids":["selection-task"]}',
                '{}', 1, NULL, 1, NULL, NULL, NULL
              )
            `,
            )
            .run(),
        /MINIGAME_TASK_SELECTION_INVALID/,
      );
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("minigame claims bind one live attempt and failed switches preserve the active round", () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), "therapy-minigame-claims-"),
  );
  const dbPath = path.join(directory, "test.sqlite");
  try {
    ensureSchema(dbPath);
    const sqlite = new Database(dbPath);
    try {
      sqlite.exec(`
        INSERT INTO users (id, email, created_at)
        VALUES ('user', 'user@example.com', 1);

        INSERT INTO tasks (
          id, slug, title, description, skill_domain, base_difficulty,
          general_objective, tags, is_published, parent_task_id,
          created_at, updated_at, language
        ) VALUES
          ('live-task', 'live-task', 'Live', 'Live task', 'test', 2,
            NULL, '[]', 1, NULL, 1, 1, 'en'),
          ('draft-task', 'draft-task', 'Draft', 'Draft task', 'test', 2,
            NULL, '[]', 0, NULL, 1, 1, 'en');

        INSERT INTO task_examples (
          id, task_id, difficulty, severity_label, patient_text, meta,
          created_at, updated_at
        ) VALUES
          ('live-example', 'live-task', 2, NULL, 'Live example', NULL, 1, 1),
          ('draft-example', 'draft-task', 2, NULL, 'Draft example', NULL, 1, 1);

        INSERT INTO minigame_sessions (
          id, user_id, game_type, visibility_mode, task_selection, settings,
          created_at, ended_at, last_active_at, current_round_id,
          current_player_id, deleted_at
        ) VALUES (
          'session', 'user', 'tdm', 'normal', '{}', '{}',
          1, NULL, 1, 'active-round', 'player-a', NULL
        );

        INSERT INTO minigame_players (
          id, session_id, name, avatar, team_id, created_at
        ) VALUES
          ('player-a', 'session', 'A', 'a', NULL, 1),
          ('player-b', 'session', 'B', 'b', NULL, 1);

        INSERT INTO minigame_rounds (
          id, session_id, position, task_id, example_id, player_a_id,
          player_b_id, team_a_id, team_b_id, status, started_at, completed_at
        ) VALUES
          ('active-round', 'session', 0, 'live-task', 'live-example',
            'player-a', 'player-b', NULL, NULL, 'active', 1, NULL),
          ('draft-target', 'session', 1, 'draft-task', 'draft-example',
            'player-a', NULL, NULL, NULL, 'pending', NULL, NULL);
      `);

      const switchTransaction = sqlite.transaction(() => {
        sqlite
          .prepare(
            "INSERT INTO minigame_round_start_claims VALUES ('draft-target', 'session', 2)",
          )
          .run();
        sqlite
          .prepare(
            "UPDATE minigame_rounds SET status = 'pending', started_at = NULL WHERE status = 'active'",
          )
          .run();
        sqlite
          .prepare(
            "UPDATE minigame_rounds SET status = 'active', started_at = 2 WHERE id = 'draft-target'",
          )
          .run();
      });
      assert.throws(switchTransaction, /MINIGAME_ROUND_START_NOT_PENDING/);
      assert.deepEqual(
        sqlite
          .prepare("SELECT id, status FROM minigame_rounds ORDER BY position")
          .all(),
        [
          { id: "active-round", status: "active" },
          { id: "draft-target", status: "pending" },
        ],
      );

      sqlite
        .prepare(
          `INSERT INTO minigame_submission_claims
             (round_id, player_id, attempt_id, created_at)
           VALUES ('active-round', 'player-a', 'claimed-attempt', 2)`,
        )
        .run();
      assert.throws(
        () =>
          sqlite
            .prepare(
              `INSERT INTO minigame_submission_claims
                 (round_id, player_id, attempt_id, created_at)
               VALUES ('active-round', 'player-a', 'other-attempt', 2)`,
            )
            .run(),
        /UNIQUE/,
      );
      assert.throws(
        () =>
          sqlite
            .prepare(
              "UPDATE minigame_submission_claims SET attempt_id = 'changed'",
            )
            .run(),
        /MINIGAME_SUBMISSION_CLAIM_IMMUTABLE/,
      );
      assert.throws(
        () => sqlite.prepare("DELETE FROM minigame_submission_claims").run(),
        /MINIGAME_SUBMISSION_CLAIM_IMMUTABLE/,
      );

      const insertAttempt = sqlite.prepare(`
        INSERT INTO attempts (
          id, user_id, session_id, session_item_id, task_id, example_id,
          started_at, completed_at, audio_ref, transcript, evaluation,
          overall_pass, overall_score, model_info, score_trust
        ) VALUES (?, 'user', NULL, NULL, 'live-task', 'live-example',
          2, NULL, NULL, 'Response', '{}', 0, 0, ?, 'cloud_trusted')
      `);
      insertAttempt.run(
        "claimed-attempt",
        JSON.stringify({
          practice: {
            scope: {
              kind: "minigame",
              session_id: "session",
              round_id: "active-round",
              player_id: "player-a",
            },
          },
        }),
      );
      insertAttempt.run(
        "ghost-attempt",
        JSON.stringify({
          practice: {
            scope: {
              kind: "minigame",
              session_id: "session",
              round_id: "active-round",
              player_id: "player-b",
            },
          },
        }),
      );
      assert.throws(
        () =>
          sqlite
            .prepare(
              `UPDATE attempts
               SET completed_at = 3, overall_pass = 1, overall_score = 4
               WHERE id = 'ghost-attempt'`,
            )
            .run(),
        /MINIGAME_ATTEMPT_CLAIM_INVALID/,
      );
      sqlite
        .prepare(
          `UPDATE attempts
           SET completed_at = 3, overall_pass = 1, overall_score = 4
           WHERE id = 'claimed-attempt'`,
        )
        .run();
      assert.equal(
        sqlite
          .prepare(
            "SELECT attempt_count AS count FROM user_task_progress WHERE user_id = 'user'",
          )
          .get(),
        undefined,
      );
      assert.throws(
        () =>
          sqlite
            .prepare(
              `INSERT INTO minigame_round_results
                 (id, round_id, player_id, attempt_id, overall_score,
                  overall_pass, created_at)
               VALUES ('ghost-result', 'active-round', 'player-b',
                 'ghost-attempt', 4, 1, 4)`,
            )
            .run(),
        /MINIGAME_RESULT_CLAIM_INVALID/,
      );
      sqlite
        .prepare(
          `INSERT INTO minigame_round_results
             (id, round_id, player_id, attempt_id, overall_score,
              overall_pass, created_at)
           VALUES ('claimed-result', 'active-round', 'player-a',
             'claimed-attempt', 3.5, 1, 4)`,
        )
        .run();
      assert.deepEqual(
        sqlite
          .prepare(
            `SELECT attempt_count, last_overall_score
             FROM user_task_progress
             WHERE user_id = 'user' AND task_id = 'live-task'`,
          )
          .get(),
        { attempt_count: 1, last_overall_score: 4 },
      );
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
