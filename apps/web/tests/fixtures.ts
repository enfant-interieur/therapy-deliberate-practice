import { expect, test as base, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export const DEFAULT_GATEWAY_ORIGIN = "http://127.0.0.1:8484";

export type AuthenticatedBrowserOptions = {
  aiMode?: "openai_only" | "local_only" | "local_prefer";
  hasOpenAiKey?: boolean;
  dismissAiSetup?: boolean;
};

export const fulfillJson = async (
  route: Route,
  body: unknown,
  status = 200,
) => {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": route.request().headers().origin ?? "*",
      "Access-Control-Allow-Private-Network": "true",
    },
    body: JSON.stringify(body),
  });
};

export const installAuthenticatedBrowser = async (
  page: Page,
  {
    aiMode = "openai_only",
    hasOpenAiKey = false,
    dismissAiSetup = true,
  }: AuthenticatedBrowserOptions = {},
) => {
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ?? "https://test.supabase.co";
  const projectRef = supabaseUrl.split("//")[1]?.split(".")[0] ?? "test";

  await page.addInitScript(
    ({ authKey, shouldDismissAiSetup }) => {
      const session = {
        access_token: "test-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "refresh-token",
        user: { id: "user-1", email: "dev@example.com" },
      };
      window.localStorage.setItem(authKey, JSON.stringify(session));
      if (shouldDismissAiSetup) {
        window.sessionStorage.setItem("aiSetupDismissed", "1");
      } else {
        window.sessionStorage.removeItem("aiSetupDismissed");
      }
    },
    {
      authKey: `sb-${projectRef}-auth-token`,
      shouldDismissAiSetup: dismissAiSetup,
    },
  );

  await page.route("**/api/v1/me", (route) =>
    fulfillJson(route, {
      id: "user-1",
      email: "dev@example.com",
      display_name: "Dev User",
      bio: null,
      created_at: null,
      hasOpenAiKey,
    }),
  );
  await page.route("**/api/v1/me/settings", (route) =>
    fulfillJson(route, {
      aiMode,
      localAiBaseUrl: DEFAULT_GATEWAY_ORIGIN,
      localSttUrl: null,
      localLlmUrl: null,
      storeAudio: false,
      hasOpenAiKey,
    }),
  );
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, {
      isAuthenticated: true,
      isAdmin: false,
      email: "dev@example.com",
    }),
  );
};

export const dismissAiSetupWizard = async (page: Page) => {
  const dialog = page.getByRole("dialog", {
    name: /artificial intelligence setup/i,
  });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: /skip for now|close/i }).click();
    await expect(dialog).toBeHidden();
  }
};

export const expectNoSeriousAccessibilityViolations = async (page: Page) => {
  const result = await new AxeBuilder({ page }).analyze();
  const blockingViolations = result.violations
    .filter(({ impact }) => impact === "serious" || impact === "critical")
    .map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map(({ target }) => target),
    }));

  expect(blockingViolations).toEqual([]);
};

type AppFixtures = {
  authenticatedApp: void;
};

export const test = base.extend<AppFixtures>({
  authenticatedApp: [
    async ({ page }, use) => {
      await installAuthenticatedBrowser(page);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
