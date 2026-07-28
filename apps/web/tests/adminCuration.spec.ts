import type { Page } from "@playwright/test";
import {
  expect,
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  test,
} from "./fixtures";

const adminTask = {
  id: "task-admin",
  slug: "admin-draft",
  title: "Draft reflection",
  description: "An editable draft.",
  skill_domain: "reflection",
  base_difficulty: 2,
  general_objective: "Reflect the concern.",
  tags: ["empathy"],
  language: "en",
  is_published: false,
  parent_task_id: null,
  created_at: 1,
  updated_at: 1,
  criteria: [
    {
      id: "criterion-admin",
      task_id: "task-admin",
      label: "Reflect",
      description: "Reflect the concern.",
      rubric: null,
      sort_order: 0,
    },
  ],
  examples: [
    {
      id: "example-admin",
      task_id: "task-admin",
      difficulty: 2,
      severity_label: null,
      patient_text: "I feel overwhelmed.",
      language: "en",
      meta: null,
      created_at: 1,
      updated_at: 1,
    },
  ],
};

const installAdmin = async (page: Page) => {
  await page.route("**/api/v1/admin/whoami", (route) =>
    fulfillJson(route, {
      isAuthenticated: true,
      isAdmin: true,
      email: "admin@example.com",
    }),
  );
};

test("authorized curation preserves the draft after a failed save, then publishes it", async ({
  page,
}) => {
  await installAdmin(page);
  let persistedTask = structuredClone(adminTask);
  let updateCount = 0;

  await page.route("**/api/v1/admin/tasks/task-admin", async (route) => {
    if (route.request().method() === "PUT") {
      updateCount += 1;
      if (updateCount === 1) {
        await fulfillJson(route, { error: "Temporary save failure." }, 503);
        return;
      }
      persistedTask = route.request().postDataJSON();
      await fulfillJson(route, { status: "updated" });
      return;
    }
    await fulfillJson(route, persistedTask);
  });
  await page.route("**/api/v1/tasks/task-admin*", (route) => {
    if (!persistedTask.is_published) {
      return fulfillJson(route, { error: "Task not found." }, 404);
    }
    return fulfillJson(route, { ...persistedTask, interaction_examples: [] });
  });

  await page.goto("/tasks/task-admin");
  await expect(page.getByText("Task not found.")).toBeVisible();

  await page.goto("/admin/tasks/task-admin");
  await expectNoSeriousAccessibilityViolations(page);
  const title = page.getByPlaceholder("Title");
  await title.fill("Published reflection");
  await page.getByRole("button", { name: "Published", exact: true }).click();
  const save = page.getByRole("button", { name: "Save changes" });
  await save.click();

  await expect(page.getByText("Something went wrong")).toBeVisible();
  await expect(title).toHaveValue("Published reflection");
  await expect(save).toBeEnabled();

  await save.click();
  await expect(page.getByText("Saved")).toBeVisible();
  expect(updateCount).toBe(2);
  expect(persistedTask).toMatchObject({
    title: "Published reflection",
    is_published: true,
  });

  await page.goto("/tasks/task-admin");
  await expect(
    page.getByRole("heading", { name: "Published reflection" }),
  ).toBeVisible();
});

test("admin portal, library, and secure text-or-URL parser cover normal and failure states", async ({
  page,
}) => {
  await installAdmin(page);
  await page.route("**/api/v1/admin/tasks", (route) =>
    fulfillJson(route, [adminTask]),
  );

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin home" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  await page.goto("/admin/library");
  await expect(page.getByText(adminTask.title)).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);

  const parsePayloads: Record<string, unknown>[] = [];
  await page.route("**/api/v1/admin/parse-task", (route) => {
    parsePayloads.push(route.request().postDataJSON());
    return fulfillJson(route, { error: "Temporary parser failure." }, 503);
  });
  await page.goto("/admin/tasks/parse");
  const sourceText = page.getByPlaceholder("Paste task text here");
  const sourceUrl = page.getByPlaceholder("https://");
  await sourceText.fill("A curator-provided source passage.");
  await expect(sourceUrl).toHaveValue("");
  const parseButton = page.getByRole("button", {
    name: "Parse with OpenAI",
    exact: true,
  });
  await parseButton.click();
  await expect(sourceText).toHaveValue("A curator-provided source passage.");
  await expect(parseButton).toBeEnabled();
  expect(parsePayloads[0]).toMatchObject({
    free_text: "A curator-provided source passage.",
    parse_mode: "original",
  });
  expect(parsePayloads[0]).not.toHaveProperty("source_url");

  await sourceUrl.fill("https://public.example/article");
  await expect(sourceText).toHaveValue("");
  await parseButton.click();
  await expect(sourceUrl).toHaveValue("https://public.example/article");
  expect(parsePayloads[1]).toMatchObject({
    source_url: "https://public.example/article",
    parse_mode: "original",
  });
  expect(parsePayloads[1]).not.toHaveProperty("free_text");
  await expectNoSeriousAccessibilityViolations(page);
});

test("admin dialogs trap focus, restore their invoker, fit target viewports, and create a task", async ({
  page,
}) => {
  await installAdmin(page);
  await page.route("**/api/v1/admin/tasks", async (route) => {
    if (route.request().method() === "POST") {
      await fulfillJson(route, { id: "task-created" });
      return;
    }
    await fulfillJson(route, [adminTask]);
  });
  await page.route("**/api/v1/admin/tasks/task-created", (route) =>
    fulfillJson(route, {
      ...adminTask,
      id: "task-created",
      title: "Created reflection",
    }),
  );

  await page.setViewportSize({ width: 360, height: 360 });
  await page.goto("/admin");
  const addTask = page.getByRole("button", { name: "Add task" });
  await addTask.click();
  const choiceDialog = page.getByRole("dialog", { name: "Add a new task" });
  await expect(choiceDialog).toBeVisible();
  await expect(
    choiceDialog.getByRole("button", { name: "Create manually" }),
  ).toBeFocused();
  const choiceBox = await choiceDialog.boundingBox();
  expect(choiceBox?.width ?? Infinity).toBeLessThanOrEqual(328);
  expect(choiceBox?.height ?? Infinity).toBeLessThanOrEqual(328);
  await expectNoSeriousAccessibilityViolations(page);
  await choiceDialog.getByRole("button", { name: "Parse text" }).focus();
  await page.keyboard.press("Tab");
  await expect(
    choiceDialog.getByRole("button", { name: "Close" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(choiceDialog).toBeHidden();
  await expect(addTask).toBeFocused();

  await page.setViewportSize({ width: 768, height: 720 });
  await addTask.click();
  await choiceDialog.getByRole("button", { name: "Create manually" }).click();
  const createDialog = page.getByRole("dialog", { name: "Create new task" });
  await expect(createDialog.getByLabel("Title")).toBeFocused();
  await createDialog.getByLabel("Title").fill("Created reflection");
  await createDialog.getByLabel("Skill domain").fill("reflection");
  await createDialog.getByLabel("Description").fill("A created task.");
  const createBox = await createDialog.boundingBox();
  expect(createBox?.height ?? Infinity).toBeLessThanOrEqual(688);
  await expectNoSeriousAccessibilityViolations(page);
  await createDialog
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/tasks\/task-created$/);

  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto("/admin");
  const importJson = page.getByRole("button", { name: "Import JSON" });
  await importJson.click();
  const importDialog = page.getByRole("dialog", { name: "Import JSON" });
  await expect(importDialog.getByLabel("Task JSON")).toBeFocused();
  await expectNoSeriousAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(importDialog).toBeHidden();
  await expect(importJson).toBeFocused();
});

test("admin duplicate, translate, and delete actions bind to their API outcomes", async ({
  page,
}) => {
  await installAdmin(page);
  const mutationCalls: string[] = [];
  await page.route("**/api/v1/admin/tasks/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.endsWith("/duplicate") && method === "POST") {
      mutationCalls.push("duplicate");
      await fulfillJson(route, { id: "task-copy", slug: "task-copy" });
      return;
    }
    if (url.pathname.endsWith("/translate") && method === "POST") {
      mutationCalls.push(
        `translate:${route.request().postDataJSON().target_language}`,
      );
      await fulfillJson(route, { id: "task-fr", slug: "task-fr" });
      return;
    }
    if (url.pathname.endsWith("/task-admin") && method === "DELETE") {
      mutationCalls.push("delete");
      await fulfillJson(route, { status: "deleted" });
      return;
    }
    const id = url.pathname.split("/").at(-1);
    await fulfillJson(route, {
      ...adminTask,
      id,
      title:
        id === "task-copy"
          ? "Draft reflection copy"
          : id === "task-fr"
            ? "Réflexion traduite"
            : adminTask.title,
      language: id === "task-fr" ? "fr" : "en",
    });
  });
  await page.route("**/api/v1/admin/tasks", (route) =>
    fulfillJson(route, [adminTask]),
  );

  await page.goto("/admin/tasks/task-admin");
  await page
    .getByRole("button", { name: "Duplicate", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/tasks\/task-copy$/);
  await expect(page.getByPlaceholder("Title")).toHaveValue(
    "Draft reflection copy",
  );

  await page.goto("/admin/tasks/task-admin");
  await page.getByRole("button", { name: "Translate" }).click();
  const translateDialog = page.getByRole("dialog", { name: "Translate task" });
  await expect(translateDialog.getByLabel("Translate to")).toBeFocused();
  await translateDialog.getByRole("button", { name: "Translate" }).click();
  await expect(page).toHaveURL(/\/admin\/tasks\/task-fr$/);
  await expect(page.getByPlaceholder("Title")).toHaveValue(
    "Réflexion traduite",
  );

  await page.goto("/admin/tasks/task-admin");
  await page.getByRole("button", { name: "Delete" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete task" });
  await expect(
    deleteDialog.getByRole("button", { name: "Cancel" }),
  ).toBeFocused();
  await deleteDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/admin\/library$/);
  expect(mutationCalls).toEqual(["duplicate", "translate:fr", "delete"]);
});

test("non-admin users are denied every admin entry point", async ({ page }) => {
  for (const route of [
    "/admin",
    "/admin/library",
    "/admin/tasks/parse",
    "/admin/tasks/task-admin",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL("/");
  }
});
