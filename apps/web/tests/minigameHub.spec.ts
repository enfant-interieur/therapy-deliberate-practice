import { expect, test, type Page } from "@playwright/test";

type SessionSummary = {
  id: string;
  game_type: "ffa" | "tdm";
  created_at: number;
  ended_at: number | null;
  last_active_at: number | null;
  current_round_id: string | null;
  current_player_id: string | null;
  progress: { completed: number; total: number };
  players_count: number;
  teams_count: number;
  winner: { label: string; score: number } | null;
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

test.describe("minigame hub", () => {
  test("renders sessions, filters, and routes", async ({ page, baseURL }) => {
    await mockAuth(page);

    const activeSession: SessionSummary = {
      id: "session-active",
      game_type: "ffa",
      created_at: 10,
      ended_at: null,
      last_active_at: 20,
      current_round_id: null,
      current_player_id: null,
      progress: { completed: 1, total: 3 },
      players_count: 2,
      teams_count: 0,
      winner: null
    };
    const endedSession: SessionSummary = {
      id: "session-ended",
      game_type: "tdm",
      created_at: 5,
      ended_at: 15,
      last_active_at: 15,
      current_round_id: null,
      current_player_id: null,
      progress: { completed: 4, total: 4 },
      players_count: 4,
      teams_count: 2,
      winner: { label: "Team Nova", score: 4.2 }
    };
    let sessions = [activeSession, endedSession];

    await page.route("**/api/v1/minigames/sessions?*", async (route) => {
      const url = new URL(route.request().url());
      const status = url.searchParams.get("status");
      let payload = sessions;
      if (status === "active") {
        payload = sessions.filter((session) => !session.ended_at);
      } else if (status === "ended") {
        payload = sessions.filter((session) => Boolean(session.ended_at));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: payload })
      });
    });

    await page.route("**/api/v1/minigames/sessions/session-active/state", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: "session-active",
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
          players: [],
          rounds: [],
          results: []
        })
      });
    });

    await page.route("**/api/v1/minigames/sessions/session-ended", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: "session-ended",
            user_id: "user-1",
            game_type: "tdm",
            visibility_mode: "normal",
            task_selection: {},
            settings: {},
            created_at: 5,
            ended_at: 15,
            last_active_at: 15,
            current_round_id: null,
            current_player_id: null
          },
          teams: [{ id: "team-1", session_id: "session-ended", name: "Team Nova", color: "teal", created_at: 0 }],
          players: [
            {
              id: "player-1",
              session_id: "session-ended",
              name: "Ava",
              avatar: "astro",
              team_id: "team-1",
              created_at: 0
            }
          ],
          rounds: [
            {
              id: "round-1",
              session_id: "session-ended",
              position: 0,
              task_id: "task-1",
              example_id: "example-1",
              player_a_id: "player-1",
              player_b_id: null,
              team_a_id: "team-1",
              team_b_id: null,
              status: "completed",
              started_at: 0,
              completed_at: 0,
              patient_text: "Prompt"
            }
          ],
          results: [
            {
              id: "result-1",
              round_id: "round-1",
              player_id: "player-1",
              attempt_id: "attempt-1",
              overall_score: 4.2,
              overall_pass: true,
              created_at: 0,
              transcript: "Transcript",
              evaluation: null
            }
          ]
        })
      });
    });

    await page.route("**/api/v1/minigames/sessions/session-active", async (route) => {
      if (route.request().method() === "DELETE") {
        sessions = sessions.filter((session) => session.id !== "session-active");
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: "session-active",
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
          players: [],
          rounds: [],
          results: []
        })
      });
    });

    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames`);
    await expect(page.getByText("Minigame hub")).toBeVisible();
    await expect(page.getByText("Team Nova")).toBeVisible();

    await page.getByRole("button", { name: "Ended" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);

    await page.getByRole("button", { name: "Active" }).click();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page).toHaveURL(/minigames\/play\/session-active/);
    await expect(page.getByRole("heading", { name: "Choose your mode" })).toBeHidden();

    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames`);
    await page.getByRole("button", { name: "View" }).click();
    await expect(page).toHaveURL(/minigames\/session\/session-ended/);
    await expect(page.getByText("Leaderboard")).toBeVisible();

    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames`);
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete session" }).click();
    await expect(page.getByText("Team Nova")).toBeVisible();
  });

  test("mobile modal scrolls in new game flow", async ({ page, baseURL }) => {
    await mockAuth(page);
    await page.setViewportSize({ width: 375, height: 720 });

    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames/play`);
    const modalHeading = page.getByRole("heading", { name: "Choose your mode" });
    await expect(modalHeading).toBeVisible();

    const modalPanel = page.locator("div.max-h-\\[90dvh\\]").first();
    await expect(modalPanel).toHaveCSS("overflow-y", "auto");
  });
});
