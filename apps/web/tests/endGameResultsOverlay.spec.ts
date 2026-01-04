import { expect, test } from "@playwright/test";

test.describe("end game results overlay", () => {
  test("shows winner and allows scrolling results", async ({ page, baseURL }) => {
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "https://test.supabase.co";
    const projectRef = supabaseUrl.split("//")[1]?.split(".")[0] ?? "test";
    const sessionId = "session-1";
    const players = [
      {
        id: "player-1",
        session_id: sessionId,
        name: "Ava",
        avatar: "astro",
        team_id: null,
        created_at: 0
      },
      {
        id: "player-2",
        session_id: sessionId,
        name: "Ben",
        avatar: "nova",
        team_id: null,
        created_at: 0
      }
    ];

    const rounds = Array.from({ length: 12 }, (_, index) => ({
      id: `round-${index + 1}`,
      session_id: sessionId,
      position: index,
      task_id: `task-${index + 1}`,
      example_id: `example-${index + 1}`,
      player_a_id: players[index % 2].id,
      player_b_id: null,
      team_a_id: null,
      team_b_id: null,
      status: "completed" as const,
      started_at: 0,
      completed_at: 0
    }));

    const results = rounds.flatMap((round, index) => [
      {
        id: `result-${index + 1}-a`,
        round_id: round.id,
        player_id: players[0].id,
        attempt_id: `attempt-${index + 1}-a`,
        overall_score: 4 + (index % 3),
        overall_pass: true,
        created_at: 0,
        transcript: "Sample transcript",
        evaluation: null,
        client_penalty: null
      },
      {
        id: `result-${index + 1}-b`,
        round_id: round.id,
        player_id: players[1].id,
        attempt_id: `attempt-${index + 1}-b`,
        overall_score: 2 + (index % 2),
        overall_pass: true,
        created_at: 0,
        transcript: "Sample transcript",
        evaluation: null,
        client_penalty: null
      }
    ]);

    await page.route("**/api/v1/tasks?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          { id: "task-1", title: "Task One", tags: [], skill_domain: "general" }
        ])
      });
    });
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
          hasOpenAiKey: false
        })
      });
    });
    await page.route("**/api/v1/me/settings", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          aiMode: "openai_only",
          localAiBaseUrl: null,
          localSttUrl: "",
          localLlmUrl: "",
          storeAudio: false,
          hasOpenAiKey: false
        })
      });
    });
    await page.route("**/api/v1/admin/whoami", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ isAuthenticated: true, isAdmin: false, email: "dev@example.com" })
      });
    });

    await page.route("**/api/v1/minigames/sessions", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session_id: sessionId })
      });
    });

    await page.route(`**/api/v1/minigames/sessions/${sessionId}/players`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ players })
      });
    });

    await page.route(`**/api/v1/minigames/sessions/${sessionId}/rounds/generate`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ round_count: rounds.length })
      });
    });

    await page.route(`**/api/v1/minigames/sessions/${sessionId}/state`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: sessionId,
            user_id: "user-1",
            game_type: "ffa",
            visibility_mode: "normal",
            task_selection: {},
            settings: {},
            created_at: 0,
            ended_at: null
          },
          teams: [],
          players,
          rounds,
          results
        })
      });
    });

    await page.route(`**/api/v1/minigames/sessions/${sessionId}/end`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true })
      });
    });

    await page.addInitScript(
      ({ key }) => {
        const session = {
          access_token: "test-token",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: "refresh-token",
          user: { id: "user-1", email: "dev@example.com" }
        };
        window.localStorage.setItem(key, JSON.stringify(session));
      },
      { key: `sb-${projectRef}-auth-token` }
    );

    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames`);

    await expect(page.getByRole("heading", { name: /choose your mode/i })).toBeVisible();
    const ffaCard = page.getByRole("heading", { name: /free for all/i }).locator("..").locator("..");
    await ffaCard.getByRole("button", { name: /start setup/i }).click();

    await page.getByRole("button", { name: /next/i }).click();
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByRole("button", { name: /next/i }).click();

    await page.getByRole("button", { name: /add player/i }).click();
    await page.getByRole("button", { name: /add player/i }).click();

    await page.getByRole("button", { name: /next/i }).click();
    await page.getByRole("button", { name: /start game/i }).click();

    const endGameButton = page.getByRole("button", { name: /end game/i });
    await expect(endGameButton).toBeVisible();
    await endGameButton.click();

    await expect(page.getByRole("heading", { name: /wins/i })).toBeVisible();
    const scrollArea = page.getByTestId("endgame-results-scroll");
    await expect(scrollArea).toBeVisible();

    const beforeScroll = await scrollArea.evaluate((element) => element.scrollTop);
    await scrollArea.evaluate((element) => {
      element.scrollTop = 200;
    });
    const afterScroll = await scrollArea.evaluate((element) => element.scrollTop);

    expect(afterScroll).toBeGreaterThan(beforeScroll);
  });
});
