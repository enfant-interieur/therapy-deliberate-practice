import path from "node:path";
import {
  expect,
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  test,
} from "./fixtures";

const task = {
  id: "studio-task",
  slug: "empathic-reflection",
  title: "Empathic reflection",
  description: "Name the feeling and invite the patient to say more.",
  skill_domain: "Schema therapy",
  base_difficulty: 2,
  general_objective: "Reflect the concern with warmth and an open question.",
  tags: ["empathy", "reflection"],
  authors: ["Synthetic educator"],
  language: "en",
  is_published: true,
  created_at: 1,
  updated_at: 1,
  criteria: [
    {
      id: "c1",
      label: "Reflect the concern",
      description: "Name the feeling without rushing to solve it.",
      rubric: {
        score_min: 0,
        score_max: 4,
        anchors: [
          { score: 0, meaning: "Misses the feeling." },
          { score: 2, meaning: "Partly reflects it." },
          { score: 4, meaning: "Reflects it clearly." },
        ],
      },
    },
  ],
  examples: [],
  interaction_examples: [
    {
      id: "ix1",
      difficulty: 2,
      title: "Make space",
      patient_text: "I worry I am asking too much.",
      therapist_text:
        "It sounds hard to make room for what you need. Can we explore that worry together?",
    },
  ],
};

for (const width of [360, 768, 1280]) {
  test(`studio routes, feedback identity and keyboard navigation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/api/v1/tasks/languages", (route) =>
      fulfillJson(route, { languages: ["en", "fr"] }),
    );
    await page.route("**/api/v1/tasks/tags", (route) =>
      fulfillJson(route, { tags: ["empathy"] }),
    );
    await page.route("**/api/v1/tasks/skill-domains", (route) =>
      fulfillJson(route, { skill_domains: ["Schema therapy"] }),
    );
    await page.route("**/api/v1/tasks?*", (route) =>
      fulfillJson(route, [task]),
    );
    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      fulfillJson(route, task),
    );
    await page.route("**/api/v1/attempts?*", (route) =>
      fulfillJson(route, [
        {
          id: "a1",
          task_id: task.id,
          task_title: task.title,
          overall_score: 3,
          overall_pass: true,
          completed_at: "2026-09-01",
          example_difficulty: 2,
          score_trust: "local_unverified",
        },
      ]),
    );
    await page.route("**/api/v1/admin/whoami", (route) =>
      fulfillJson(route, {
        isAuthenticated: true,
        isAdmin: true,
        email: "synthetic@example.com",
      }),
    );
    await page.route("**/api/v1/minigames/sessions?*", (route) =>
      fulfillJson(route, { sessions: [] }),
    );
    await page.route("**/api/v1/admin/tasks*", (route) =>
      fulfillJson(route, []),
    );
    const item = {
      session_item_id: "studio-item",
      task_id: task.id,
      example_id: "ex1",
      target_difficulty: 2,
      patient_text: "I worry I am asking too much.",
    };
    await page.route("**/api/v1/sessions?*", (route) =>
      fulfillJson(route, [
        {
          id: "studio-session",
          source_task_id: task.id,
          mode: "single_task",
          created_at: 1,
          ended_at: null,
          item_count: 1,
          completed_count: 1,
          items: [item],
        },
      ]),
    );
    await page.route("**/api/v1/sessions/studio-session/attempts", (route) =>
      fulfillJson(route, [
        {
          id: "studio-attempt",
          session_item_id: item.session_item_id,
          completed_at: 1,
          transcript: "I hear that it is hard to ask for support.",
          overall_score: 3,
          overall_pass: true,
          score_trust: "cloud_trusted",
          scoring_provider: { kind: "openai", model: "synthetic-evaluator" },
          evaluation: {
            version: "2.0",
            task_id: task.id,
            example_id: "ex1",
            attempt_id: "studio-attempt",
            transcript: { text: "I hear that it is hard to ask for support." },
            criterion_scores: [
              {
                criterion_id: "c1",
                score: 3,
                rationale_short: "Recognizes the concern.",
                evidence_quotes: [],
                missed_points: [],
              },
            ],
            overall: {
              score: 3,
              pass: true,
              summary_feedback:
                "You named the concern clearly. Invite more detail next time.",
              what_to_improve_next: ["Ask one open question."],
            },
            patient_reaction: { emotion: "engaged", intensity: 1 },
          },
        },
      ]),
    );
    await page.route("**/api/v1/practice/patient-audio/**", (route) =>
      fulfillJson(route, { items: [], status: "pending" }),
    );

    for (const [name, url, heading] of [
      ["library", "/", "Build confidence, one response at a time."],
      ["detail", `/tasks/${task.id}`, "Empathic reflection"],
      ["history", "/history", "Practice history"],
      ["settings", "/settings", "Practice settings"],
      ["games", "/minigames", "Minigame hub"],
      ["admin", "/admin", "Admin home"],
      [
        "practice",
        `/practice/${task.id}?session=studio-session`,
        "Empathic reflection",
      ],
    ]) {
      await page.goto(url);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }).first(),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        )
        .toBe(true);
      if (name === "settings")
        await expect(
          page.getByText("gpt-6.1-sol", { exact: true }),
        ).toBeVisible();
      if (name === "detail")
        await expect(
          page.getByText("Synthetic educator", { exact: true }),
        ).toBeVisible();
      if (name === "practice")
        await expect(
          page.getByText("Evaluator: synthetic-evaluator", { exact: true }),
        ).toBeVisible();
      if (process.env.STUDIO_CAPTURE_DIR)
        await page.screenshot({
          path: path.join(
            process.env.STUDIO_CAPTURE_DIR,
            `${name}-${width}.png`,
          ),
          fullPage: true,
        });
    }
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to practice content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#studio-main")).toBeFocused();
    await expectNoSeriousAccessibilityViolations(page);
  });
}

test("French studio copy, filters and model guidance retain narrow-screen fit", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => localStorage.setItem("i18nextLng", "fr"));
  await page.route("**/api/v1/tasks/languages", (route) =>
    fulfillJson(route, { languages: ["fr", "en"] }),
  );
  await page.route("**/api/v1/tasks/tags", (route) =>
    fulfillJson(route, { tags: [] }),
  );
  await page.route("**/api/v1/tasks/skill-domains", (route) =>
    fulfillJson(route, { skill_domains: [] }),
  );
  await page.route("**/api/v1/tasks?*", (route) => fulfillJson(route, [task]));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Gagner en confiance, une réponse à la fois.",
    }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Le modèle dépend du travail." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});
