import { expect, test, type Page } from "@playwright/test";

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
        localAiBaseUrl: "http://127.0.0.1:8484",
        localSttUrl: null,
        localLlmUrl: null,
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
};

test.describe("ffa player switching", () => {
  test("players panel uses cards and opens the switch dialog", async ({ page, baseURL }) => {
    await mockAuth(page);

    await page.route("**/api/v1/minigames/sessions/session-ffa/state", async (route) => {
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
            current_round_id: null,
            current_player_id: null
          },
          teams: [],
          players: [
            {
              id: "player-1",
              session_id: "session-ffa",
              name: "Nova",
              avatar: "nova",
              team_id: null,
              created_at: 0
            },
            {
              id: "player-2",
              session_id: "session-ffa",
              name: "Ember",
              avatar: "ember",
              team_id: null,
              created_at: 0
            }
          ],
          rounds: [],
          results: []
        })
      });
    });

    await page.route("**/api/v1/minigames/sessions/session-ffa/resume", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });

    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames/play/session-ffa`);

    await expect(page.locator("select")).toHaveCount(0);

    const playerCard = page.getByRole("button", { name: /nova/i });
    await playerCard.click();

    await expect(page.getByText("Switch turn?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Switch turn?")).toBeHidden();
  });
});
