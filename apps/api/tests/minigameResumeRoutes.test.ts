import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { SignJWT } from "jose";
import { createApiApp } from "../src/app";
import { ensureSchema } from "../src/db/init";
import { resolveEnv } from "../src/env";
import {
  minigamePlayers,
  minigameRounds,
  minigameSessions,
  tasks,
  users,
} from "../src/db/schema";

const jwtSecret = "minigame-resume-route-secret";

test("resume rejects unassigned FFA and TDM players as invalid round-player pairs", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const tempDirectory = await mkdtemp(
    path.join(testDirectory, "tmp-minigame-resume-routes-"),
  );
  const dbPath = path.join(tempDirectory, "test.sqlite");
  ensureSchema(dbPath);
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  try {
    const app = createApiApp({
      env: resolveEnv({
        ENV: "test",
        SUPABASE_JWT_SECRET: jwtSecret,
      }),
      db,
      tts: {
        storage: {
          headObject: async () => ({ exists: false }),
          putObject: async () => ({}),
          getObject: async () => ({
            body: new Uint8Array(),
            contentType: "audio/mpeg",
          }),
        },
      },
    });
    const now = Date.now();
    await db.insert(users).values({
      id: "learner",
      email: "learner@example.com",
      display_name: "Learner",
      bio: null,
      created_at: now,
    });
    await db.insert(tasks).values({
      id: "task",
      slug: "task",
      title: "Task",
      description: "Description",
      skill_domain: "validation",
      base_difficulty: 2,
      general_objective: null,
      tags: [],
      language: "en",
      is_published: true,
      parent_task_id: null,
      created_at: now,
      updated_at: now,
    });
    await db.insert(minigameSessions).values([
      {
        id: "ffa",
        user_id: "learner",
        game_type: "ffa",
        visibility_mode: "normal",
        task_selection: {},
        settings: {},
        created_at: now,
        ended_at: null,
        last_active_at: now,
        current_round_id: null,
        current_player_id: null,
        deleted_at: null,
      },
      {
        id: "tdm",
        user_id: "learner",
        game_type: "tdm",
        visibility_mode: "normal",
        task_selection: {},
        settings: {},
        created_at: now,
        ended_at: null,
        last_active_at: now,
        current_round_id: null,
        current_player_id: null,
        deleted_at: null,
      },
    ]);
    await db.insert(minigamePlayers).values([
      {
        id: "ffa-assigned",
        session_id: "ffa",
        name: "Assigned",
        avatar: "a",
        team_id: null,
        created_at: now,
      },
      {
        id: "ffa-unassigned",
        session_id: "ffa",
        name: "Unassigned",
        avatar: "b",
        team_id: null,
        created_at: now,
      },
      {
        id: "tdm-a",
        session_id: "tdm",
        name: "A",
        avatar: "a",
        team_id: "red",
        created_at: now,
      },
      {
        id: "tdm-b",
        session_id: "tdm",
        name: "B",
        avatar: "b",
        team_id: "blue",
        created_at: now,
      },
      {
        id: "tdm-unassigned",
        session_id: "tdm",
        name: "Unassigned",
        avatar: "c",
        team_id: "blue",
        created_at: now,
      },
    ]);
    await db.insert(minigameRounds).values([
      {
        id: "ffa-round",
        session_id: "ffa",
        position: 0,
        task_id: "task",
        example_id: "example",
        player_a_id: "ffa-assigned",
        player_b_id: null,
        team_a_id: null,
        team_b_id: null,
        status: "pending",
        started_at: null,
        completed_at: null,
      },
      {
        id: "tdm-round",
        session_id: "tdm",
        position: 0,
        task_id: "task",
        example_id: "example",
        player_a_id: "tdm-a",
        player_b_id: "tdm-b",
        team_a_id: "red",
        team_b_id: "blue",
        status: "pending",
        started_at: null,
        completed_at: null,
      },
    ]);
    const token = await new SignJWT({ email: "learner@example.com" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("learner")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(new TextEncoder().encode(jwtSecret));
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const resume = (sessionId: string, body: Record<string, unknown>) =>
      app.request(`/api/v1/minigames/sessions/${sessionId}/resume`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(body),
      });

    assert.equal(
      (
        await resume("ffa", {
          current_round_id: "ffa-round",
          current_player_id: "ffa-unassigned",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await resume("tdm", {
          current_round_id: "tdm-round",
          current_player_id: "tdm-unassigned",
        })
      ).status,
      409,
    );
    assert.equal(
      (await resume("ffa", { current_round_id: "ffa-round" })).status,
      400,
    );
    assert.equal(
      (
        await resume("tdm", {
          current_round_id: "tdm-round",
          current_player_id: "tdm-b",
        })
      ).status,
      200,
    );
  } finally {
    sqlite.close();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
