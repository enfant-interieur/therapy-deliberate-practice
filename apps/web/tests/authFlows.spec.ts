import { expect, test } from "@playwright/test";
import { fulfillJson, installAuthenticatedBrowser } from "./fixtures";

const authenticatedSession = {
  access_token: "signed-in-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: "signed-in-refresh-token",
  user: {
    id: "user-signed-in",
    aud: "authenticated",
    role: "authenticated",
    email: "learner@example.com",
  },
};

test("email sign-in succeeds and returns to the protected destination", async ({
  page,
}) => {
  await page.route("**/auth/v1/token?grant_type=password", (route) =>
    fulfillJson(route, authenticatedSession),
  );
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, {
      isAuthenticated: true,
      isAdmin: false,
      email: "learner@example.com",
    }),
  );
  await page.route("**/api/v1/me", (route) =>
    fulfillJson(route, {
      id: "user-signed-in",
      email: "learner@example.com",
      display_name: "Signed-in learner",
      bio: null,
      created_at: null,
      hasOpenAiKey: false,
    }),
  );
  await page.route("**/api/v1/me/settings", (route) =>
    fulfillJson(route, {
      aiMode: "openai_only",
      localAiBaseUrl: "http://127.0.0.1:8484",
      localSttUrl: null,
      localLlmUrl: null,
      storeAudio: false,
      hasOpenAiKey: false,
    }),
  );
  await page.route("**/api/v1/attempts?*", (route) => fulfillJson(route, []));

  await page.goto("/login?returnTo=%2Fhistory");
  await page.getByPlaceholder("Email").fill("learner@example.com");
  await page.getByPlaceholder("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in with email" }).click();

  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page.getByRole("heading", { name: "Practice history" }),
  ).toBeVisible();
});

test("callback errors are shown on login and preserve a safe return destination", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, {
      isAuthenticated: false,
      isAdmin: false,
      email: null,
    }),
  );

  await page.goto("/?error_description=Access%20denied&returnTo=%2Fhistory");

  await expect(page).toHaveURL(/\/login\?returnTo=%2Fhistory$/);
  await expect(page.getByText("Access denied")).toBeVisible();
  await expect(page.getByText(/redirected back to \/history/i)).toBeVisible();
});

test("logout clears the session and returns to login", async ({ page }) => {
  await installAuthenticatedBrowser(page);
  await page.route("**/auth/v1/logout*", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/v1/tasks/languages", (route) =>
    fulfillJson(route, { languages: [] }),
  );
  await page.route("**/api/v1/tasks/tags", (route) =>
    fulfillJson(route, { tags: [] }),
  );
  await page.route("**/api/v1/tasks/skill-domains", (route) =>
    fulfillJson(route, { skill_domains: [] }),
  );
  await page.route("**/api/v1/tasks?*", (route) => fulfillJson(route, []));

  await page.goto("/");
  await page.getByRole("button", { name: "Profile" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();

  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).some(
        (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
      ),
    ),
  ).toBe(false);
});
