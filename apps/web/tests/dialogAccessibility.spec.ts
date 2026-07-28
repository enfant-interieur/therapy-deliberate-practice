import {
  expect,
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  installAuthenticatedBrowser,
  test,
} from "./fixtures";

test.describe("learner dialog accessibility", () => {
  test("AI setup has a name, traps focus, and closes with Escape", async ({
    page,
    baseURL,
  }) => {
    await installAuthenticatedBrowser(page, { dismissAiSetup: false });
    await page.goto(`${baseURL ?? "http://localhost:5173"}/settings`);

    const dialog = page.getByRole("dialog", {
      name: "Get ready for AI-assisted practice",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Close" }),
    ).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Skip for now" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("game selection and setup expose named, keyboard-contained dialogs", async ({
    page,
    baseURL,
  }) => {
    await page.route("**/api/v1/tasks?*", (route) => fulfillJson(route, []));
    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames/play`);

    const selectDialog = page.getByRole("dialog", {
      name: "Choose your mode",
    });
    await expect(selectDialog).toBeVisible();
    await expect(
      selectDialog.getByRole("button", { name: "Close" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      selectDialog.getByRole("button", { name: "Start setup" }).last(),
    ).toBeFocused();

    await selectDialog
      .getByRole("button", { name: "Start setup" })
      .first()
      .click();
    const setupDialog = page.getByRole("dialog", {
      name: "Team Deathmatch",
    });
    await expect(setupDialog).toBeVisible();
    await expect(
      setupDialog.getByRole("button", { name: "Close" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    expect(
      await setupDialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(setupDialog).toBeHidden();
  });

  test("mobile app navigation traps focus and restores its invoker", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(`${baseURL ?? "http://localhost:5173"}/settings`);

    const invoker = page.getByRole("button", { name: "Menu" });
    await invoker.click();
    const dialog = page.getByRole("dialog", { name: "Menu" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "Library" }),
    ).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await expectNoSeriousAccessibilityViolations(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(invoker).toBeFocused();
  });

  test("mobile help navigation traps focus and restores its invoker", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/help/getting-started`,
    );

    const invoker = page.getByRole("button", {
      name: "Open help navigation",
    });
    await invoker.click();
    const dialog = page.getByRole("dialog", { name: "Help navigation" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Close" }),
    ).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((element) =>
        element.contains(document.activeElement),
      ),
    ).toBe(true);
    await expectNoSeriousAccessibilityViolations(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(invoker).toBeFocused();
  });
});
