import { expect, test } from "./fixtures";

test.describe("minigames dock panel collapse", () => {
  test("collapsed dock panel does not reserve layout space on desktop", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames/play`);

    const closeButton = page.getByRole("button", { name: "Close" }).first();
    await closeButton.click();

    const panelButton = page.getByRole("button", { name: /players/i });
    await expect(panelButton).toBeVisible();

    const panel = panelButton.locator("..");
    const content = panel.locator(":scope > div");

    await expect(content).toHaveAttribute("aria-hidden", "true");
    await expect(content).toHaveAttribute("inert", "");
    await content.evaluate((element) => {
      const probe = document.createElement("button");
      probe.id = "collapsed-focus-probe-desktop";
      probe.textContent = "Hidden focus probe";
      element.append(probe);
    });
    await panelButton.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.locator("#collapsed-focus-probe-desktop"),
    ).not.toBeFocused();

    const headerBox = await panelButton.boundingBox();
    const panelBox = await panel.boundingBox();
    const contentBox = await content.boundingBox();

    expect(contentBox?.height ?? 0).toBeLessThan(1);
    expect(panelBox?.height ?? 0).toBeLessThan((headerBox?.height ?? 0) + 4);
  });

  test("collapsed stack panel does not reserve layout space on mobile", async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await page.goto(`${baseURL ?? "http://localhost:5173"}/minigames/play`);

    const closeButton = page.getByRole("button", { name: "Close" }).first();
    await closeButton.click();

    const panelButton = page.getByRole("button", { name: /task/i });
    await expect(panelButton).toBeVisible();

    const panel = panelButton.locator("..");
    const content = panel.locator(":scope > div");

    await expect(content).toHaveAttribute("aria-hidden", "true");
    await expect(content).toHaveAttribute("inert", "");
    await content.evaluate((element) => {
      const probe = document.createElement("button");
      probe.id = "collapsed-focus-probe-mobile";
      probe.textContent = "Hidden focus probe";
      element.append(probe);
    });
    await panelButton.focus();
    await page.keyboard.press("Tab");
    await expect(
      page.locator("#collapsed-focus-probe-mobile"),
    ).not.toBeFocused();

    const headerBox = await panelButton.boundingBox();
    const panelBox = await panel.boundingBox();
    const contentBox = await content.boundingBox();

    expect(contentBox?.height ?? 0).toBeLessThan(1);
    expect(panelBox?.height ?? 0).toBeLessThan((headerBox?.height ?? 0) + 4);
  });
});
