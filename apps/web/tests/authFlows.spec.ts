import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createManagedSession,
  fulfillJson,
  installAnonymousBrowser,
  installAuthenticatedBrowser,
  expectNoSeriousAccessibilityViolations,
} from "./fixtures";

const installLibrary = async (
  page: Parameters<typeof installAuthenticatedBrowser>[0],
) => {
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
};

test("development admin access keeps its dedicated header without learner bearer credentials", async ({ page }) => {
  await installAuthenticatedBrowser(page);
  await page.addInitScript(() => localStorage.setItem("devAdminToken", "synthetic-development-admin-token"));
  await page.route("**/api/v1/admin/whoami", async (route) => {
    expect(route.request().headers()["x-dev-admin-token"]).toBe("synthetic-development-admin-token");
    expect(route.request().headers().authorization).toBeUndefined();
    await fulfillJson(route, { isAuthenticated: true, isAdmin: false, email: "dev@example.com" });
  });
  await installLibrary(page);
  const adminRequest = page.waitForResponse("**/api/v1/admin/whoami");
  await page.goto("/");
  expect((await adminRequest).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Task library" })).toBeVisible();
});

test("email sign-in returns to the protected destination without browser credentials", async ({
  page,
}) => {
  const auth = await installAuthenticatedBrowser(page);
  auth.setAuthenticated(false);
  await page.route("**/api/auth/sign-in/email", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: "learner@example.com",
      password: "synthetic passphrase",
    });
    expect(route.request().headers().authorization).toBeUndefined();
    auth.setAuthenticated(true);
    await fulfillJson(route, {
      user: auth.getSession()!.user,
      token: "synthetic",
    });
  });
  await page.route("**/api/v1/attempts?*", (route) => fulfillJson(route, []));
  await page.addInitScript(() =>
    localStorage.setItem("sb-obsolete-auth-token", "obsolete credential"),
  );
  await page.goto("/login?returnTo=%2Fhistory");
  await page.getByLabel("Email", { exact: true }).fill("learner@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic passphrase");
  await page
    .getByRole("button", { name: "Sign in with email", exact: true })
    .click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(
    page.getByRole("heading", { name: "Practice history" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some(
        (key) => key.startsWith("sb-") || key.includes("session_token"),
      ),
    ),
  ).toBe(false);
});

test("callback failures use safe localized copy and reject an external return destination", async ({
  page,
}) => {
  await installAnonymousBrowser(page);
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, { isAuthenticated: false, isAdmin: false, email: null }),
  );
  await page.goto(
    "/?error=access_denied&error_description=raw-secret&returnTo=%2Fhistory",
  );
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fhistory&authError=denied$/,
  );
  await expect(page.getByRole("alert")).toContainText("Sign-in was cancelled");
  await expect(page.locator("body")).not.toContainText("raw-secret");
  await page.goto("/login?returnTo=https%3A%2F%2Fattacker.example");
  await page.route("**/api/auth/sign-in/social", async (route) => {
    expect(route.request().postDataJSON().callbackURL).toBe(
      "http://127.0.0.1:5174/login?returnTo=%2F",
    );
    await fulfillJson(route, { url: "", redirect: false });
  });
  await page
    .getByRole("button", { name: "Continue with Apple", exact: true })
    .click();
});

test("signup, confirmation resend and reset request preserve private account responses", async ({
  page,
}) => {
  await installAnonymousBrowser(page);
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, { isAuthenticated: false, isAdmin: false, email: null }),
  );
  await page.route("**/api/auth/sign-up/email", (route) =>
    fulfillJson(route, {
      token: null,
      user: { ...createManagedSession().user, emailVerified: false },
    }),
  );
  await page.route("**/api/auth/send-verification-email", (route) =>
    fulfillJson(route, { status: true }),
  );
  await page.route("**/api/auth/request-password-reset", (route) =>
    fulfillJson(route, { status: true }),
  );
  await page.goto("/login");
  await page
    .getByRole("button", { name: "Email sign up", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("a unique synthetic phrase");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("a unique synthetic phrase");
  await page.getByRole("button", { name: "Create account with email" }).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await expect(page).toHaveURL(/\/login$/);
  await page
    .getByRole("button", { name: "Resend confirmation email", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "If confirmation is needed",
  );
  await page
    .getByRole("button", { name: "Forgot password", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "If an account uses this email",
  );
});

test("password recovery removes the token from history and completes the new-password form", async ({
  page,
}) => {
  await installAnonymousBrowser(page);
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, { isAuthenticated: false, isAdmin: false, email: null }),
  );
  await page.route("**/api/auth/reset-password", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token: "synthetic-recovery-token",
      newPassword: "a new unique synthetic phrase",
    });
    await fulfillJson(route, { status: true });
  });
  await page.goto("/reset-password?token=synthetic-recovery-token");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page
    .getByLabel("New password", { exact: true })
    .fill("a new unique synthetic phrase");
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill("a new unique synthetic phrase");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText(
    "previous sessions have been signed out",
  );
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("password recovery survives a delayed existing session and its later revocation", async ({ page }) => {
  const auth = await installAuthenticatedBrowser(page);
  let releaseSession = () => {};
  const delayedSession = new Promise<void>((resolve) => { releaseSession = resolve; });
  let firstRequest = true;
  await page.route(/\/api\/auth\/get-session(?:\?.*)?$/, async (route) => {
    if (firstRequest) { firstRequest = false; await delayedSession; }
    await fulfillJson(route, auth.getSession());
  });
  await page.route("**/api/auth/reset-password", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: "synthetic-delayed-recovery-token", newPassword: "a new unique synthetic phrase" });
    auth.setAuthenticated(false);
    await fulfillJson(route, { status: true });
  });
  await page.goto("/reset-password?token=synthetic-delayed-recovery-token");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.getByLabel("New password", { exact: true }).fill("a new unique synthetic phrase");
  await page.getByLabel("Confirm password", { exact: true }).fill("a new unique synthetic phrase");
  releaseSession();
  await expect(page.getByRole("button", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("a new unique synthetic phrase");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("status")).toContainText("previous sessions have been signed out");
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "better-auth.message", newValue: JSON.stringify({ event: "session", data: { trigger: "reset-password" } }) })));
  await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("previous sessions have been signed out");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("logout failure is recoverable and successful logout clears account state", async ({
  page,
}) => {
  await installAuthenticatedBrowser(page);
  await installLibrary(page);
  await page.route("**/api/auth/sign-out", (route) =>
    fulfillJson(route, { code: "FAILURE", message: "private" }, 503),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page.getByRole("alert")).toContainText("could not sign you out");
  await page.unroute("**/api/auth/sign-out");
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(
    page.getByRole("link", { name: "Log in", exact: true }),
  ).toBeVisible();
});

test("a same-page account refresh clears private forms and reloads account methods", async ({ page }) => {
  const auth = await installAuthenticatedBrowser(page);
  let accountLoads = 0;
  await page.route("**/api/v1/me", (route) => {
    const user = auth.getSession()!.user;
    return fulfillJson(route, { id: user.id, email: user.email, display_name: user.name, bio: "", is_profile_public: false, created_at: null, hasOpenAiKey: false });
  });
  await page.route("**/api/v1/profiles/*", (route) => fulfillJson(route, { profile: { insights: null } }));
  await page.route("**/api/auth/list-accounts", (route) => {
    accountLoads++;
    return fulfillJson(route, [{ id: "credential", providerId: "credential" }, { id: "provider", providerId: auth.getSession()!.user.id === "user-1" ? "google" : "apple" }]);
  });
  await page.route("**/api/auth/list-sessions", (route) => fulfillJson(route, Array.from({ length: auth.getSession()!.user.id === "user-1" ? 1 : 2 }, () => createManagedSession().session)));
  await page.goto("/profile");
  const security = page.locator("section").filter({ has: page.getByRole("heading", { name: "Account security", exact: true }) });
  await expect(security.getByText("Google", { exact: true })).toBeVisible();
  await security.getByLabel("Current password", { exact: true }).fill("first learner private password");
  await security.getByLabel("New password", { exact: true }).fill("first learner proposed private password");
  const next = createManagedSession();
  next.user.id = "user-two";
  next.user.name = "Second learner";
  next.user.email = "second@example.com";
  next.session.userId = "user-two";
  auth.setSession(next);
  // Better Auth receives this metadata-only event when another tab updates the shared cookie.
  await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "better-auth.message", newValue: JSON.stringify({ event: "session", data: { trigger: "sign-in" } }) })));
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText("Second learner", { exact: true })).toBeVisible();
  await expect(page.getByText("Dev User", { exact: true })).toHaveCount(0);
  await expect(security.getByText("Apple", { exact: true })).toBeVisible();
  await expect(security.getByText("Google", { exact: true })).toHaveCount(0);
  await expect(security.getByLabel("Current password", { exact: true })).toHaveValue("");
  await expect(security.getByLabel("New password", { exact: true })).toHaveValue("");
  await expect(security.getByText("Your account is open in 2 sessions.", { exact: true })).toBeVisible();
  expect(accountLoads).toBeGreaterThanOrEqual(2);
});

test("a second account gets fresh profile and security state after sign-out", async ({
  page,
}) => {
  const auth = await installAuthenticatedBrowser(page);
  let meRequests = 0;
  await page.route("**/api/v1/me", (route) => {
    meRequests++;
    const user = auth.getSession()?.user;
    return fulfillJson(route, {
      id: user?.id,
      email: user?.email,
      display_name: user?.name,
      bio: "",
      is_profile_public: false,
      created_at: null,
      hasOpenAiKey: false,
    });
  });
  await page.route("**/api/v1/profiles/*", (route) =>
    fulfillJson(route, { profile: { insights: null } }),
  );
  await page.route("**/api/auth/list-accounts", (route) =>
    fulfillJson(route, [{ id: "credential", providerId: "credential" }]),
  );
  await page.route("**/api/auth/list-sessions", (route) =>
    fulfillJson(route, [createManagedSession().session]),
  );
  await page.route("**/api/auth/sign-in/email", (route) => {
    const next = createManagedSession();
    next.user.id = "user-two";
    next.session.userId = "user-two";
    next.user.name = "Second learner";
    next.user.email = "second@example.com";
    auth.setSession(next);
    return fulfillJson(route, { token: "synthetic", user: next.user });
  });
  await page.goto("/profile");
  await expect(page.getByText("Dev User", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email", { exact: true }).fill("second@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic passphrase");
  await page
    .getByRole("button", { name: "Sign in with email", exact: true })
    .click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByText("Second learner", { exact: true })).toBeVisible();
  await expect(page.getByText("Dev User", { exact: true })).toHaveCount(0);
  expect(meRequests).toBeGreaterThanOrEqual(2);
});

for (const width of [360, 768, 1280])
  test(`login and recovery are accessible at ${width}px in French`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "fr"));
    await installAnonymousBrowser(page);
    await page.route("**/api/v1/admin/whoami", (route) =>
      fulfillJson(route, {
        isAuthenticated: false,
        isAdmin: false,
        email: null,
      }),
    );
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: "Continuer avec Apple", exact: true }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (process.env.STUDIO_CAPTURE_DIR)
      await page.screenshot({
        path: path.join(
          process.env.STUDIO_CAPTURE_DIR,
          `auth-login-${width}.png`,
        ),
        fullPage: true,
      });
    await page.goto("/reset-password?token=synthetic");
    await expect(
      page.getByLabel("Nouveau mot de passe", { exact: true }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (process.env.STUDIO_CAPTURE_DIR)
      await page.screenshot({
        path: path.join(
          process.env.STUDIO_CAPTURE_DIR,
          `auth-reset-${width}.png`,
        ),
        fullPage: true,
      });
  });
