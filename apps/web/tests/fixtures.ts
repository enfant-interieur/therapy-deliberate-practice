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

export const createManagedSession = () => {
  const createdAt = new Date().toISOString();
  return {
    user: {
      id: "user-1",
      email: "dev@example.com",
      emailVerified: true,
      name: "Dev User",
      image: null,
      createdAt,
      updatedAt: createdAt,
    },
    session: {
      id: "browser-test-session",
      token: "synthetic-browser-session-token",
      userId: "user-1",
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ipAddress: null,
      userAgent: null,
    },
  };
};

export type ManagedSession = ReturnType<typeof createManagedSession>;

export const installManagedBrowser = async (
  page: Page,
  { authenticated = true }: { authenticated?: boolean } = {},
) => {
  let currentSession: ManagedSession | null = authenticated
    ? createManagedSession()
    : null;

  await page.route(/\/api\/auth\/get-session(?:\?.*)?$/, (route) =>
    fulfillJson(route, currentSession),
  );
  await page.route(/\/api\/auth\/sign-out(?:\?.*)?$/, (route) => {
    currentSession = null;
    return fulfillJson(route, { success: true });
  });
  await page.route(/\/api\/auth\/list-accounts(?:\?.*)?$/, (route) =>
    fulfillJson(
      route,
      currentSession
        ? [{ id: "synthetic-credential", providerId: "credential" }]
        : [],
      currentSession ? 200 : 401,
    ),
  );
  await page.route(/\/api\/auth\/list-sessions(?:\?.*)?$/, (route) =>
    fulfillJson(
      route,
      currentSession ? [currentSession.session] : [],
      currentSession ? 200 : 401,
    ),
  );
  await page.route(/\/api\/auth\/config(?:\?.*)?$/, (route) =>
    fulfillJson(route, {
      ready: true,
      emailPassword: true,
      emailDelivery: true,
      providers: { google: true, github: true, apple: true },
    }),
  );

  return {
    getSession: () => currentSession,
    setSession: (session: ManagedSession | null) => {
      currentSession = session;
    },
    setAuthenticated: (isAuthenticated: boolean) => {
      currentSession = isAuthenticated ? createManagedSession() : null;
    },
  };
};

export const installAnonymousBrowser = (page: Page) =>
  installManagedBrowser(page, { authenticated: false });

export const installAuthenticatedBrowser = async (
  page: Page,
  {
    aiMode = "openai_only",
    hasOpenAiKey = false,
    dismissAiSetup = true,
  }: AuthenticatedBrowserOptions = {},
) => {
  const managedBrowser = await installManagedBrowser(page);

  await page.addInitScript(
    ({ shouldDismissAiSetup }) => {
      if (shouldDismissAiSetup) {
        window.sessionStorage.setItem("aiSetupDismissed", "1");
      } else {
        window.sessionStorage.removeItem("aiSetupDismissed");
      }
    },
    {
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

  return managedBrowser;
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
