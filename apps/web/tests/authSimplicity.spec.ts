import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  installAnonymousBrowser,
} from "./fixtures";

test.beforeEach(async ({ page }) => {
  await installAnonymousBrowser(page);
  await page.route("**/api/auth/config", (route) =>
    fulfillJson(route, {
      ready: true,
      emailPassword: true,
      emailDelivery: true,
      providers: { google: false, github: false, apple: false },
    }),
  );
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, { isAuthenticated: false, isAdmin: false, email: null }),
  );
});

for (const width of [360, 768, 1280]) {
  test(`French login and signup have a single clear action at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => localStorage.setItem("i18nextLng", "fr"));
    await page.goto("/login?returnTo=%2Fhistory");
    await expect(
      page.getByRole("heading", { name: "Se connecter", exact: true }),
    ).toBeVisible();
    await expect(page.locator('.auth-form button[type="submit"]')).toHaveCount(
      1,
    );
    await expect(page.locator(".auth-layout button")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Google|GitHub|Apple|Renvoyer/ }),
    ).toHaveCount(0);
    await expect(page.locator(".auth-divider")).toHaveCount(0);
    await expect(page.locator(".auth-layout [aria-pressed]")).toHaveCount(0);
    const action = page.getByRole("button", {
      name: "Se connecter",
      exact: true,
    });
    const actionBounds = (await action.boundingBox())!;
    expect(actionBounds.y + actionBounds.height).toBeLessThanOrEqual(800);
    const signup = page.getByRole("link", {
      name: "Créer un compte",
      exact: true,
    });
    const bounds = (await signup.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
    expect(
      await page
        .locator("#auth-email")
        .evaluate((e) => getComputedStyle(e).fontSize),
    ).toBe("16px");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width < 900) await expect(page.locator(".auth-art-panel")).toBeHidden();
    await expectNoSeriousAccessibilityViolations(page);
    if (process.env.STUDIO_CAPTURE_DIR)
      await page.screenshot({
        path: path.join(
          process.env.STUDIO_CAPTURE_DIR,
          `simple-login-${width}.png`,
        ),
        fullPage: true,
      });
    await signup.click();
    await expect(page).toHaveURL(/\/signup\?returnTo=%2Fhistory$/);
    await expect(
      page.getByRole("heading", { name: "Créer un compte", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".auth-form input")).toHaveCount(3);
    await expect(page.locator(".auth-layout button")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /Renvoyer|oublié/ }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expectNoSeriousAccessibilityViolations(page);
    if (process.env.STUDIO_CAPTURE_DIR)
      await page.screenshot({
        path: path.join(
          process.env.STUDIO_CAPTURE_DIR,
          `simple-signup-${width}.png`,
        ),
        fullPage: true,
      });
    await page
      .getByRole("link", { name: "Retour à la connexion", exact: true })
      .click();
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fhistory$/);
  });
}

test("verification resend appears only when an unverified account needs it", async ({
  page,
}) => {
  await page.route("**/api/auth/sign-in/email", (route) =>
    fulfillJson(
      route,
      { code: "EMAIL_NOT_VERIFIED", message: "private server details" },
      403,
    ),
  );
  await page.route("**/api/auth/send-verification-email", (route) =>
    fulfillJson(route, { status: true }),
  );
  await page.goto("/login");
  await expect(
    page.getByRole("button", {
      name: "Resend confirmation email",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
  await page
    .getByLabel("Password", { exact: true })
    .fill("synthetic passphrase");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).not.toContainText(
    "private server details",
  );
  await page
    .getByRole("button", { name: "Resend confirmation email", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "If confirmation is needed",
  );
  await expect(page.locator(".auth-form")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Back to sign in", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("password recovery is a focused page and keeps the return destination", async ({
  page,
}) => {
  await page.route("**/api/auth/request-password-reset", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: "synthetic@example.com",
    });
    await fulfillJson(route, { status: true });
  });
  await page.goto("/login?returnTo=%2Fsettings");
  await page
    .getByRole("link", { name: "Forgot password", exact: true })
    .click();
  await expect(page).toHaveURL(/\/forgot-password\?returnTo=%2Fsettings$/);
  await expect(page.locator(".auth-form input")).toHaveCount(1);
  await expect(page.locator(".auth-layout button")).toHaveCount(1);
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
  await page
    .getByRole("button", { name: "Send the link", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "If an account uses this email",
  );
  await expect(page.locator(".auth-form")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Back to sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsettings$/);
});
