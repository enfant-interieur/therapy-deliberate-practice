import path from "node:path";
import type { Page } from "@playwright/test";
import {
  expect,
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  test,
} from "./fixtures";

const installVisualData = async (page: Page) => {
  await page.route("**/api/v1/tasks/languages", (route) =>
    fulfillJson(route, { languages: ["en", "fr"] }),
  );
  await page.route("**/api/v1/tasks/tags", (route) =>
    fulfillJson(route, { tags: ["empathy", "reflection"] }),
  );
  await page.route("**/api/v1/tasks/skill-domains", (route) =>
    fulfillJson(route, { skill_domains: ["Schema therapy"] }),
  );
  await page.route("**/api/v1/tasks?*", (route) =>
    fulfillJson(route, [
      {
        id: "visual-rehearsal",
        slug: "make-space",
        title: "Make space for a difficult feeling",
        description:
          "Reflect the concern with warmth and invite the patient to say more.",
        skill_domain: "Schema therapy",
        base_difficulty: 2,
        tags: ["empathy", "reflection"],
        language: "en",
        is_published: true,
        created_at: 1,
        updated_at: 1,
      },
    ]),
  );
  await page.route("**/api/v1/minigames/sessions?*", (route) =>
    fulfillJson(route, { sessions: [] }),
  );
};

const expectNoOverflow = async (page: Page) => {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBe(true);
};

test.beforeEach(async ({ page }) => {
  await installVisualData(page);
});

for (const width of [360, 768, 1280]) {
  test(`artwork stays legible, decorative and static with reduced motion at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const surfaces = [
      ["library", "/", ".studio-library-art"],
      ["games", "/minigames", ".studio-game-art"],
      [
        "help",
        "/help/getting-started",
        width >= 1024 ? ".studio-help-sidebar-art" : ".studio-help-mobile-art",
      ],
    ];

    for (const [name, url, selector] of surfaces) {
      await page.goto(url);
      const artwork = page.locator(selector);
      await artwork.scrollIntoViewIfNeeded();
      const image = artwork.locator("img");
      await expect(artwork).toBeVisible();
      await expect(artwork).toHaveAttribute("aria-hidden", "true");
      await expect(image).toHaveAttribute("alt", "");
      await expect
        .poll(() =>
          image.evaluate(
            (element) =>
              (element as HTMLImageElement).complete &&
              (element as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .toBe(true);
      await expect(image).toHaveCSS("animation-name", "none");
      await expect(image).toHaveCSS("transform", "none");
      const bounds = await artwork.boundingBox();
      expect(bounds?.height).toBeGreaterThan(80);
      if (width === 360) expect(bounds?.height).toBeLessThan(181);
      await expectNoOverflow(page);
      await expectNoSeriousAccessibilityViolations(page);
      if (process.env.STUDIO_CAPTURE_DIR) {
        await page.screenshot({
          path: path.join(
            process.env.STUDIO_CAPTURE_DIR,
            `visual-${name}-${width}.png`,
          ),
          fullPage: true,
        });
      }
    }
  });
}

test("supported decorative parallax follows scrolling within its small travel budget", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const image = page.locator(".studio-library-art img");
  await expect(image).toBeVisible();
  const supported = await page.evaluate(
    () =>
      CSS.supports("animation-timeline", "view()") &&
      matchMedia("(pointer: fine)").matches,
  );
  if (!supported) {
    await expect(image).toHaveCSS("animation-name", "none");
    await expect(image).toHaveCSS("transform", "none");
    return;
  }
  const initial = await image.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() =>
      image.evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(initial);
  const translateY = await image.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    return new DOMMatrixReadOnly(transform).m42;
  });
  expect(Math.abs(translateY)).toBeLessThanOrEqual(6.01);
});

test.describe("touch motion preference", () => {
  test.use({ hasTouch: true });

  test("coarse-pointer artwork remains static without a reduced-motion request", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const image = page.locator(".studio-library-art img");
    await expect(image).toHaveCSS("animation-name", "none");
    await expect(image).toHaveCSS("transform", "none");
  });
});

test("failed decorative image preserves the hero and library actions", async ({
  page,
}) => {
  await page.route("**/artwork/open-shelter-*.webp", (route) => route.abort());
  await page.goto("/");
  const artwork = page.locator(".studio-library-art");
  await expect(artwork.locator("img")).toHaveCSS("visibility", "hidden");
  expect(
    await artwork.evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    ),
  ).not.toBe("none");
  await expect(
    page.getByRole("heading", {
      name: "Build confidence, one response at a time.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Start practice" }),
  ).toBeVisible();
  await expectNoOverflow(page);
});

test("French copy and long task text remain reachable with 200 percent text resizing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "fr"));
  await page.route("**/api/v1/tasks?*", (route) =>
    fulfillJson(route, [
      {
        id: "visual-long-title",
        slug: "reflection",
        title:
          "Accueillir une émotion difficile et inviter la personne à préciser ce dont elle a besoin",
        description:
          "Prendre le temps de refléter une préoccupation avec des mots simples, puis poser une question ouverte et laisser une place à la réponse.",
        skill_domain: "Thérapie des schémas",
        base_difficulty: 2,
        tags: ["écoute", "réflexion"],
        language: "fr",
        is_published: true,
        created_at: 1,
        updated_at: 1,
      },
    ]),
  );
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(
    page.getByRole("heading", {
      name: "Gagner en confiance, une réponse à la fois.",
    }),
  ).toBeVisible();
  const search = page.locator("#library-search-input");
  await search.scrollIntoViewIfNeeded();
  await expect(search).toBeVisible();
  const searchBounds = await search.boundingBox();
  expect(searchBounds?.width).toBeGreaterThanOrEqual(240);
  await search.fill("émotion");
  await expect(search).toHaveValue("émotion");
  const action = page.getByRole("link", { name: "Commencer la pratique" });
  await action.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();
  await expectNoOverflow(page);
  await expectNoSeriousAccessibilityViolations(page);
  if (process.env.STUDIO_CAPTURE_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.STUDIO_CAPTURE_DIR,
        "visual-french-text-200.png",
      ),
      fullPage: true,
    });
  }
});
