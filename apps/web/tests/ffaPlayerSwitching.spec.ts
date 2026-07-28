import type { Page } from "@playwright/test";
import {
  expect,
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  test,
} from "./fixtures";

const minigameTask = {
  id: "task-1",
  slug: "player-switching-task",
  title: "Player switching task",
  description: "A deterministic minigame task.",
  skill_domain: "reflection",
  base_difficulty: 2,
  general_objective: "Reflect the concern.",
  tags: ["test"],
  language: "en",
  is_published: true,
  parent_task_id: null,
  created_at: 1,
  updated_at: 1,
  criteria: [
    {
      id: "criterion-1",
      task_id: "task-1",
      label: "Reflect",
      description: "Reflect the concern.",
      rubric: null,
      sort_order: 0,
    },
  ],
};

const mockAuth = async (page: Page) => {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-1",
        email: "dev@example.com",
        display_name: "Dev User",
        bio: null,
        created_at: null,
        hasOpenAiKey: false,
      }),
    });
  });
  await page.route("**/api/v1/me/settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        aiMode: "openai_only",
        localAiBaseUrl: "http://127.0.0.1:8484",
        localSttUrl: null,
        localLlmUrl: null,
        storeAudio: false,
        hasOpenAiKey: false,
      }),
    });
  });
  await page.route("**/api/v1/admin/whoami", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        isAuthenticated: true,
        isAdmin: false,
        email: "dev@example.com",
      }),
    });
  });
  await page.route("**/api/v1/tasks?*", (route) =>
    fulfillJson(route, [minigameTask]),
  );
  await page.route("**/api/v1/tasks/task-1*", (route) =>
    fulfillJson(route, minigameTask),
  );
  await page.route(
    "**/api/v1/minigames/sessions/*/rounds/*/start",
    (route) => fulfillJson(route, { ok: true }),
  );
  await page.route(
    "**/api/v1/practice/patient-audio/prefetch-batch",
    (route) =>
      fulfillJson(route, {
        items: [
          {
            statement_id: "example-1",
            cache_key: "player-switching-audio",
            status: "ready",
            audio_url: "/api/v1/tts/player-switching-audio",
          },
        ],
        ready_count: 1,
        total_count: 1,
      }),
  );
  await page.route(
    "**/api/v1/practice/patient-audio/prefetch",
    (route) =>
      fulfillJson(route, {
        cache_key: "player-switching-audio",
        status: "ready",
        audio_url: "/api/v1/tts/player-switching-audio",
      }),
  );
  await page.route("**/api/v1/tts/player-switching-audio", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: "RIFF-test-audio",
    }),
  );
};

test.describe("ffa player switching", () => {
  test("players panel uses cards and opens the switch dialog", async ({
    page,
    baseURL,
  }) => {
    await mockAuth(page);
    await page.setViewportSize({ width: 768, height: 720 });

    await page.route(
      "**/api/v1/minigames/sessions/session-ffa/state",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            session: {
              id: "session-ffa",
              user_id: "user-1",
              game_type: "ffa",
              visibility_mode: "normal",
              task_selection: {},
              settings: {},
              created_at: 10,
              ended_at: null,
              last_active_at: 20,
              current_round_id: "round-1",
              current_player_id: "player-1",
            },
            teams: [],
            players: [
              {
                id: "player-1",
                session_id: "session-ffa",
                name: "Nova",
                avatar: "nova",
                team_id: null,
                created_at: 0,
              },
              {
                id: "player-2",
                session_id: "session-ffa",
                name: "Ember",
                avatar: "ember",
                team_id: null,
                created_at: 0,
              },
            ],
            rounds: [
              {
                id: "round-1",
                session_id: "session-ffa",
                position: 0,
                task_id: "task-1",
                example_id: "example-1",
                player_a_id: "player-1",
                player_b_id: null,
                team_a_id: null,
                team_b_id: null,
                status: "active",
                started_at: 10,
                completed_at: null,
                patient_text: "I feel stuck.",
              },
            ],
            results: [],
          }),
        });
      },
    );

    await page.route(
      "**/api/v1/minigames/sessions/session-ffa/resume",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      },
    );

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/minigames/play/session-ffa`,
    );

    await expect(page.getByRole("main").locator("select")).toHaveCount(0);

    await page.getByRole("button", { name: "Players" }).click();
    const playerCard = page.getByRole("button", { name: /ember/i });
    await playerCard.click();

    const switchDialog = page.getByRole("dialog", { name: "Switch turn?" });
    await expect(switchDialog).toBeVisible();
    await expect(
      switchDialog.getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await expectNoSeriousAccessibilityViolations(page);
    const dialogBox = await switchDialog.boundingBox();
    expect(dialogBox?.height ?? Infinity).toBeLessThanOrEqual(688);
    await page.keyboard.press("Escape");
    await expect(switchDialog).toBeHidden();
    await expect(playerCard).toBeFocused();
  });

  test("live TDM results remain bound to the player who earned each score", async ({
    page,
    baseURL,
  }) => {
    await mockAuth(page);
    await page.route(
      "**/api/v1/minigames/sessions/session-tdm/state",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            session: {
              id: "session-tdm",
              user_id: "user-1",
              game_type: "tdm",
              visibility_mode: "normal",
              task_selection: {},
              settings: {},
              created_at: 10,
              ended_at: null,
              last_active_at: 20,
              current_round_id: "round-tdm",
              current_player_id: "player-blue",
            },
            teams: [
              {
                id: "team-blue",
                session_id: "session-tdm",
                name: "Blue",
                color: "teal",
                created_at: 0,
              },
              {
                id: "team-red",
                session_id: "session-tdm",
                name: "Red",
                color: "rose",
                created_at: 0,
              },
            ],
            players: [
              {
                id: "player-blue",
                session_id: "session-tdm",
                name: "Blue scorer",
                avatar: "nova",
                team_id: "team-blue",
                created_at: 0,
              },
              {
                id: "player-red",
                session_id: "session-tdm",
                name: "Red scorer",
                avatar: "ember",
                team_id: "team-red",
                created_at: 0,
              },
            ],
            rounds: [
              {
                id: "round-tdm",
                session_id: "session-tdm",
                position: 0,
                task_id: "task-1",
                example_id: "example-1",
                player_a_id: "player-blue",
                player_b_id: "player-red",
                team_a_id: "team-blue",
                team_b_id: "team-red",
                status: "active",
                started_at: 10,
                completed_at: null,
                patient_text: "I feel stuck.",
              },
            ],
            results: [
              {
                id: "result-blue",
                round_id: "round-tdm",
                player_id: "player-blue",
                attempt_id: "attempt-blue",
                overall_score: 1,
                overall_pass: false,
                created_at: 15,
                score_trust: "cloud_trusted",
              },
              {
                id: "result-red",
                round_id: "round-tdm",
                player_id: "player-red",
                attempt_id: "attempt-red",
                overall_score: 4.5,
                overall_pass: true,
                created_at: 16,
                score_trust: "cloud_trusted",
              },
            ],
          }),
        });
      },
    );
    await page.route(
      "**/api/v1/minigames/sessions/session-tdm/resume",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      },
    );
    await page.route(
      "**/api/v1/minigames/sessions/session-tdm/rounds/round-tdm/start",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      },
    );
    await page.route(
      "**/api/v1/practice/patient-audio/prefetch-batch",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            items: [
              {
                statement_id: "example-1",
                cache_key: "tdm-score-binding-audio",
                status: "ready",
                audio_url: "/api/v1/tts/tdm-score-binding-audio",
              },
            ],
            ready_count: 1,
            total_count: 1,
          }),
        });
      },
    );
    await page.route(
      "**/api/v1/practice/patient-audio/prefetch",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            cache_key: "tdm-score-binding-audio",
            status: "ready",
            audio_url: "/api/v1/tts/tdm-score-binding-audio",
          }),
        });
      },
    );
    await page.route(
      "**/api/v1/tts/tdm-score-binding-audio",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "audio/wav",
          body: "RIFF-test-audio",
        });
      },
    );

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/minigames/play/session-tdm`,
    );
    const versusIntro = page.locator("div.fixed.inset-0.z-30");
    await expect(versusIntro).toBeVisible();
    await page.waitForTimeout(1_250);
    await versusIntro.click();
    await expect(versusIntro).toBeHidden();
    await page.getByRole("button", { name: "Players" }).click();

    await expect(
      page.getByRole("button", {
        name: /Blue scorer.*Score 1\.0/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Red scorer.*Score 4\.5/i,
      }),
    ).toBeVisible();
  });
});
