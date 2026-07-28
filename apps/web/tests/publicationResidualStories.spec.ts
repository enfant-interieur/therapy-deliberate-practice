import type { Page, Route } from "@playwright/test";
import {
  expect,
  expectNoSeriousAccessibilityViolations,
  fulfillJson,
  installAuthenticatedBrowser,
  test,
} from "./fixtures";

const task = {
  id: "task-residual",
  slug: "alliance-therapeutique",
  title:
    "Explorer une préoccupation complexe sans précipiter la personne vers une solution",
  description:
    "Cette tâche aide à ralentir, à refléter avec précision une expérience nuancée et à laisser suffisamment d’espace pour que la personne puisse définir elle-même ce qui compte le plus.",
  skill_domain: "reformulation_empathique_et_exploration_collaborative",
  base_difficulty: 3,
  general_objective:
    "Reconnaître simultanément l’émotion, l’incertitude et le besoin d’autonomie avant de proposer une question ouverte.",
  tags: ["alliance thérapeutique", "écoute réflexive"],
  language: "fr",
  is_published: true,
  parent_task_id: null,
  created_at: 1,
  updated_at: 1,
  criteria: [
    {
      id: "criterion-reflect",
      task_id: "task-residual",
      label: "Refléter l’expérience avec précision",
      description:
        "Nommer l’émotion et la tension sans supposer une intention que la personne n’a pas exprimée.",
      rubric: null,
      sort_order: 0,
    },
  ],
  interaction_examples: [
    {
      id: "interaction-long",
      task_id: "task-residual",
      difficulty: 3,
      title: "Une réponse qui respecte l’ambivalence",
      patient_text:
        "Une partie de moi voudrait que quelque chose change immédiatement, mais une autre partie craint de perdre le peu de stabilité que j’ai réussi à construire.",
      therapist_text:
        "Vous ressentez à la fois l’urgence d’un changement et le besoin de protéger cette stabilité durement acquise. Qu’aimeriez-vous que nous comprenions d’abord de cette tension?",
      created_at: 1,
      updated_at: 1,
    },
  ],
};

const example = {
  id: "example-residual",
  task_id: task.id,
  difficulty: 3,
  severity_label: null,
  patient_text: "I feel torn between changing things and staying safe.",
  language: "en",
  meta: null,
  created_at: 1,
  updated_at: 1,
};

const transcript =
  "It sounds like both change and safety matter, and I wonder which part needs attention first.";

const evaluation = (attemptId: string) => ({
  version: "2.0",
  task_id: task.id,
  example_id: example.id,
  attempt_id: attemptId,
  transcript: { text: transcript },
  criterion_scores: [
    {
      criterion_id: "criterion-reflect",
      score: 4,
      rationale_short: "Reflects both sides and invites the patient to lead.",
    },
  ],
  overall: {
    score: 4,
    pass: true,
    summary_feedback: "A clear and collaborative response.",
    what_to_improve_next: ["Keep the question concise."],
  },
  patient_reaction: { emotion: "engaged", intensity: 2 },
});

const expectNoHorizontalOverflow = async (page: Page) => {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
};

const installTaskRoutes = async (page: Page) => {
  await page.route("**/api/v1/tasks?*", (route) => fulfillJson(route, [task]));
  await page.route("**/api/v1/tasks/languages", (route) =>
    fulfillJson(route, { languages: ["en", "fr"] }),
  );
  await page.route("**/api/v1/tasks/tags", (route) =>
    fulfillJson(route, { tags: task.tags }),
  );
  await page.route("**/api/v1/tasks/skill-domains", (route) =>
    fulfillJson(route, { skill_domains: [task.skill_domain] }),
  );
  await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
    fulfillJson(route, task),
  );
};

type MicOutcome = "success" | "permission_denied" | "no_device";

const installMicrophone = async (
  page: Page,
  {
    outcomes,
    throwFirstRecorder = false,
    supportedMimeType = "audio/mp4",
  }: {
    outcomes: MicOutcome[];
    throwFirstRecorder?: boolean;
    supportedMimeType?: string;
  },
) => {
  await page.addInitScript(
    ({ requestedOutcomes, shouldThrowFirstRecorder, supportedMime }) => {
      const micWindow = window as typeof window & {
        __micPermissionRequests?: number;
        __micRecorderConstructors?: number;
        __micRecorderStarts?: number;
        __micTrackStops?: number;
      };
      let outcomeIndex = 0;
      micWindow.__micPermissionRequests = 0;
      micWindow.__micRecorderConstructors = 0;
      micWindow.__micRecorderStarts = 0;
      micWindow.__micTrackStops = 0;

      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: true,
      });
      const createStream = () =>
        ({
          getTracks: () => [
            {
              stop: () => {
                micWindow.__micTrackStops =
                  (micWindow.__micTrackStops ?? 0) + 1;
              },
            },
          ],
        }) as unknown as MediaStream;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            micWindow.__micPermissionRequests =
              (micWindow.__micPermissionRequests ?? 0) + 1;
            const outcome =
              requestedOutcomes[
                Math.min(outcomeIndex, requestedOutcomes.length - 1)
              ] ?? "success";
            outcomeIndex += 1;
            if (outcome === "permission_denied") {
              throw new DOMException("Permission denied", "NotAllowedError");
            }
            if (outcome === "no_device") {
              throw new DOMException("No microphone", "NotFoundError");
            }
            return createStream();
          },
        },
      });

      class FakeMediaRecorder {
        static isTypeSupported(type: string) {
          return type === supportedMime;
        }

        state = "inactive";
        mimeType: string;
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;

        constructor(_stream: MediaStream, options?: { mimeType?: string }) {
          micWindow.__micRecorderConstructors =
            (micWindow.__micRecorderConstructors ?? 0) + 1;
          if (
            shouldThrowFirstRecorder &&
            micWindow.__micRecorderConstructors === 1
          ) {
            throw new DOMException(
              "The selected MIME type is unavailable.",
              "NotSupportedError",
            );
          }
          this.mimeType = options?.mimeType ?? supportedMime;
        }

        start() {
          this.state = "recording";
          micWindow.__micRecorderStarts =
            (micWindow.__micRecorderStarts ?? 0) + 1;
        }

        stop() {
          this.state = "inactive";
          this.ondataavailable?.({
            data: new Blob(["recorded-audio"], { type: this.mimeType }),
          });
          queueMicrotask(() => this.onstop?.());
        }
      }

      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
    },
    {
      requestedOutcomes: outcomes,
      shouldThrowFirstRecorder: throwFirstRecorder,
      supportedMime: supportedMimeType,
    },
  );
};

const installPracticeRoutes = async (
  page: Page,
  onPracticeRun: (route: Route) => Promise<void>,
) => {
  await installAuthenticatedBrowser(page, {
    aiMode: "openai_only",
    hasOpenAiKey: true,
  });
  await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
    fulfillJson(route, task),
  );
  await page.route("**/api/v1/sessions?*", (route) => fulfillJson(route, []));
  await page.route("**/api/v1/sessions/start", (route) =>
    fulfillJson(route, {
      session_id: "cloud-session",
      items: [
        {
          session_item_id: "cloud-item-1",
          task_id: task.id,
          example_id: example.id,
          target_difficulty: 3,
          patient_text: example.patient_text,
        },
        {
          session_item_id: "cloud-item-2",
          task_id: task.id,
          example_id: "example-second",
          target_difficulty: 3,
          patient_text: "I am unsure what I need next.",
        },
      ],
    }),
  );
  await page.route("**/api/v1/sessions/cloud-session/attempts", (route) =>
    fulfillJson(route, []),
  );
  await page.route("**/api/v1/practice/run", onPracticeRun);
};

const sessionSummary = {
  id: "hub-session",
  game_type: "ffa" as const,
  created_at: 10,
  ended_at: null,
  last_active_at: 20,
  current_round_id: "hub-round",
  current_player_id: "hub-player",
  progress: { completed: 1, total: 3 },
  players_count: 2,
  teams_count: 0,
  winner: null,
};

test.describe("residual publication-readiness stories", () => {
  test("long French task detail remains readable and returns to exact library state at 360/768/1100", async ({
    page,
  }) => {
    await installTaskRoutes(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(
      "/?q=alliance&language=fr&skill_domain=reformulation&sort=oldest",
    );

    const language = page
      .getByRole("navigation")
      .getByRole("combobox", { name: /language/i });
    await language.selectOption("fr");
    const detailLink = page.getByRole("link", {
      name: /voir les détails/i,
    });
    await detailLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: task.title })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.setViewportSize({ width: 360, height: 800 });
    await expect(
      page.getByText(task.interaction_examples[0].patient_text),
    ).toBeVisible();
    await expect(
      page.getByText(task.interaction_examples[0].therapist_text),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);

    await page.setViewportSize({ width: 768, height: 900 });
    const backLink = page.getByRole("link", {
      name: /retour à la bibliothèque/i,
    });
    await backLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      /\?q=alliance&language=fr&skill_domain=reformulation&sort=oldest$/,
    );
    await expect(page.getByText(task.title)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("cloud-recorded practice keeps transcription and evaluation separate and disables motion at 360px", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 360, height: 900 });
    await installMicrophone(page, { outcomes: ["success"] });

    let releaseTranscription!: () => void;
    const transcriptionGate = new Promise<void>((resolve) => {
      releaseTranscription = resolve;
    });
    let releaseEvaluation!: () => void;
    const evaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    const runBodies: Array<Record<string, unknown>> = [];
    await installPracticeRoutes(page, async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      runBodies.push(body);
      if (body.skip_scoring === true) {
        await transcriptionGate;
        await fulfillJson(route, {
          requestId: "cloud-transcription",
          attemptId: "cloud-attempt",
          score_trust: "cloud_trusted",
          transcript: {
            text: transcript,
            input_mode: "audio",
            provider: { kind: "openai", model: "test-transcriber" },
            duration_ms: 25,
          },
        });
        return;
      }
      await evaluationGate;
      await fulfillJson(route, {
        requestId: "cloud-evaluation",
        attemptId: "cloud-attempt",
        score_trust: "cloud_trusted",
        transcript: {
          text: transcript,
          input_mode: "audio",
          provider: { kind: "openai", model: "test-transcriber" },
          duration_ms: 25,
        },
        scoring: {
          evaluation: evaluation("cloud-attempt"),
          provider: { kind: "openai", model: "test-evaluator" },
          duration_ms: 30,
        },
      });
    });

    await page.goto(`/practice/${task.id}`);
    const start = page.getByRole("button", { name: "Start recording" });
    await expect(start).toBeEnabled();
    await start.click();
    await page.getByRole("button", { name: "Stop recording" }).click();

    await expect(
      page.getByText("Transcribing", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Evaluation running", { exact: true }),
    ).toHaveCount(0);
    releaseTranscription();

    await expect(
      page.getByText("Evaluation running", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Show transcript" }).click();
    await expect(page.getByText(transcript)).toBeVisible();
    releaseEvaluation();

    await expect(page.getByText("Coach feedback")).toBeVisible();
    const nextExample = page.locator('button[aria-label="Next example"]');
    await expect(nextExample).toBeEnabled();
    await expect
      .poll(() =>
        nextExample.evaluate(
          (element) => window.getComputedStyle(element).animationName,
        ),
      )
      .toBe("none");
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);

    expect(runBodies).toHaveLength(2);
    expect(runBodies[0]).toMatchObject({
      session_item_id: "cloud-item-1",
      audio_mime: "audio/mp4",
      mode: "openai_only",
      practice_mode: "standard",
      skip_scoring: true,
    });
    expect(runBodies[0].audio).toEqual(expect.any(String));
    expect(runBodies[0]).not.toHaveProperty("pairing_key");
    expect(runBodies[1]).toMatchObject({
      session_item_id: "cloud-item-1",
      attempt_id: "cloud-attempt",
      transcript_text: transcript,
      input_mode: "audio",
      mode: "openai_only",
      practice_mode: "standard",
    });
    expect(runBodies[1]).not.toHaveProperty("audio");
    expect(runBodies[1]).not.toHaveProperty("pairing_key");
  });

  test("practice recovers from permission, no-device, and unsupported-MIME failures", async ({
    page,
  }) => {
    await installMicrophone(page, {
      outcomes: ["permission_denied", "no_device", "success", "success"],
      throwFirstRecorder: true,
      supportedMimeType: "audio/webm;codecs=opus",
    });
    await installPracticeRoutes(page, async (route) => {
      await fulfillJson(route, { error: "Not expected in this test." }, 500);
    });
    await page.goto(`/practice/${task.id}`);
    const start = page.getByRole("button", { name: "Start recording" });
    await expect(start).toBeEnabled();

    await start.click();
    await expect(page.getByText(/Microphone blocked/i).first()).toBeVisible();
    await expect(start).toBeEnabled();

    await start.click();
    await expect(
      page.getByText("Connect a microphone and try again.").first(),
    ).toBeVisible();
    await expect(start).toBeEnabled();

    await start.click();
    await expect(
      page.getByText("Try a different browser or device.").first(),
    ).toBeVisible();
    await expect(start).toBeEnabled();

    await start.click();
    await expect(
      page.getByRole("button", { name: "Stop recording" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => {
        const micWindow = window as typeof window & {
          __micPermissionRequests?: number;
          __micRecorderConstructors?: number;
          __micRecorderStarts?: number;
          __micTrackStops?: number;
        };
        return {
          permissions: micWindow.__micPermissionRequests,
          constructors: micWindow.__micRecorderConstructors,
          starts: micWindow.__micRecorderStarts,
          stoppedTracks: micWindow.__micTrackStops,
        };
      }),
    ).toEqual({
      permissions: 4,
      constructors: 2,
      starts: 1,
      stoppedTracks: 1,
    });

    await page.getByRole("button", { name: "Profile" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __micTrackStops?: number })
              .__micTrackStops,
        ),
      )
      .toBe(2);
  });

  test("minigame hub distinguishes load failure, retries by keyboard, and preserves a failed deletion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    let listShouldFail = true;
    await page.route("**/api/v1/minigames/sessions?*", (route) =>
      listShouldFail
        ? fulfillJson(route, { error: "Temporary hub failure." }, 503)
        : fulfillJson(route, { sessions: [sessionSummary] }),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionSummary.id}`,
      (route) => fulfillJson(route, { error: "Delete failed." }, 503),
    );

    await page.goto("/minigames");
    await expect(page.getByRole("alert")).toContainText(
      "We couldn’t load your minigame sessions.",
    );
    await expect(page.getByText("No minigame sessions yet")).toHaveCount(0);
    const retry = page.getByRole("button", { name: "Retry" });
    await retry.focus();
    listShouldFail = false;
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

    const deleteInvoker = page.getByRole("button", { name: "Delete" });
    await deleteInvoker.click();
    const dialog = page.getByRole("dialog", {
      name: "Remove this session?",
    });
    await dialog.getByRole("button", { name: "Delete session" }).click();
    await expect(dialog).toBeVisible();
    await expect(
      page.getByText("We couldn’t delete that session."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

    await dialog.getByRole("button", { name: "Close" }).click();
    await page.setViewportSize({ width: 1100, height: 900 });
    const language = page
      .getByRole("navigation")
      .getByRole("combobox", { name: /language/i });
    await language.selectOption("fr");
    await page.setViewportSize({ width: 360, height: 900 });
    await expect(page.getByText("Chacun pour soi")).toBeVisible();
    await expect(page.getByText("1 / 3 manches")).toBeVisible();
    await page.getByRole("button", { name: "Supprimer" }).click();
    await expect(
      page.getByRole("dialog", { name: "Supprimer cette session ?" }),
    ).toContainText(
      "Cette action supprimera la session Chacun pour soi de votre historique. Elle est irréversible.",
    );

    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });

  test("minigame detail retries a failed load and keeps the page after delete failure", async ({
    page,
  }) => {
    const sessionId = "detail-session";
    let loadShouldFail = true;
    await page.route(`**/api/v1/minigames/sessions/${sessionId}`, (route) => {
      if (route.request().method() === "DELETE") {
        return fulfillJson(route, { error: "Delete failed." }, 503);
      }
      if (loadShouldFail) {
        return fulfillJson(route, { error: "Load failed." }, 503);
      }
      return fulfillJson(route, {
        session: {
          id: sessionId,
          user_id: "user-1",
          game_type: "ffa",
          visibility_mode: "normal",
          task_selection: {},
          settings: {},
          created_at: 10,
          ended_at: 20,
          last_active_at: 20,
          current_round_id: null,
          current_player_id: null,
        },
        teams: [],
        players: [
          {
            id: "detail-player",
            session_id: sessionId,
            name: "Ava",
            avatar: "astro",
            team_id: null,
            created_at: 10,
          },
        ],
        rounds: [],
        results: [],
      });
    });

    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto(`/minigames/session/${sessionId}`);
    await expect(
      page.getByText("We couldn’t load that session."),
    ).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry" });
    await retry.focus();
    loadShouldFail = false;
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Minigame results" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete session" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Remove this session?",
    });
    await dialog.getByRole("button", { name: "Delete session" }).click();
    await expect(dialog).toBeVisible();
    await expect(
      page.getByText("We couldn’t delete that session."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Minigame results" }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
  });

  test("TDM mobile intro and audio background honor reduced motion without a delay", async ({
    page,
  }) => {
    const sessionId = "tdm-reduced-motion";
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: async () => undefined,
      });
      Object.defineProperty(HTMLMediaElement.prototype, "pause", {
        configurable: true,
        value: () => undefined,
      });
    });
    await page.route("**/api/v1/tasks?*", (route) =>
      fulfillJson(route, [task]),
    );
    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      fulfillJson(route, task),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/state`,
      (route) =>
        fulfillJson(route, {
          session: {
            id: sessionId,
            user_id: "user-1",
            game_type: "tdm",
            visibility_mode: "normal",
            task_selection: {},
            settings: {},
            created_at: 10,
            ended_at: null,
            last_active_at: 20,
            current_round_id: "tdm-round",
            current_player_id: "player-left",
          },
          teams: [
            {
              id: "team-left",
              session_id: sessionId,
              name: "Aurora",
              color: "teal",
              created_at: 10,
            },
            {
              id: "team-right",
              session_id: sessionId,
              name: "Nova",
              color: "rose",
              created_at: 10,
            },
          ],
          players: [
            {
              id: "player-left",
              session_id: sessionId,
              name: "Ava",
              avatar: "astro",
              team_id: "team-left",
              created_at: 10,
            },
            {
              id: "player-right",
              session_id: sessionId,
              name: "Ben",
              avatar: "nova",
              team_id: "team-right",
              created_at: 10,
            },
          ],
          rounds: [
            {
              id: "tdm-round",
              session_id: sessionId,
              position: 0,
              task_id: task.id,
              example_id: example.id,
              player_a_id: "player-left",
              player_b_id: "player-right",
              team_a_id: "team-left",
              team_b_id: "team-right",
              status: "active",
              started_at: 10,
              completed_at: null,
              patient_text: example.patient_text,
            },
          ],
          results: [],
        }),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/resume`,
      (route) => fulfillJson(route, { ok: true }),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/rounds/tdm-round/start`,
      (route) => fulfillJson(route, { ok: true }),
    );
    await page.route(
      "**/api/v1/practice/patient-audio/prefetch-batch",
      (route) =>
        fulfillJson(route, {
          items: [
            {
              statement_id: example.id,
              cache_key: "tdm-reduced-audio",
              status: "ready",
              audio_url: "/api/v1/tts/tdm-reduced-audio",
            },
          ],
          ready_count: 1,
          total_count: 1,
        }),
    );
    await page.route("**/api/v1/practice/patient-audio/prefetch", (route) =>
      fulfillJson(route, {
        cache_key: "tdm-reduced-audio",
        status: "ready",
        audio_url: "/api/v1/tts/tdm-reduced-audio",
      }),
    );
    await page.route("**/api/v1/tts/tdm-reduced-audio", (route) =>
      route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: "RIFF-test-audio",
      }),
    );

    await page.goto(`/minigames/play/${sessionId}`);
    const overlay = page.locator("div.fixed.inset-0.z-30");
    await expect(overlay).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(".animate-versus-intro-enter")
          .evaluate(
            (element) => window.getComputedStyle(element).animationName,
          ),
      )
      .toBe("none");
    await expect(page.locator('canvas[data-motion="reduced"]')).toBeVisible();
    const dismissIntro = page.getByRole("button", {
      name: "Continue to the match",
    });
    await expect(async () => {
      if (await dismissIntro.isVisible()) {
        await expect(dismissIntro).toHaveAttribute("aria-disabled", "false");
        await dismissIntro.focus();
        await page.keyboard.press("Enter");
      }
      await expect(overlay).toBeHidden({ timeout: 250 });
    }).toPass();
    await expectNoHorizontalOverflow(page);
  });

  test("missing and long public profiles have distinct, responsive presentation", async ({
    page,
  }) => {
    let profileIsMissing = true;
    const longName = "AlexandredeLaReflectionSansEspaces";
    const longBio =
      "Je travaille une écoute patiente et collaborative, même lorsque plusieurs émotions et besoins importants apparaissent dans la même conversation.";
    await page.route("**/api/v1/profiles/public-profile", (route) =>
      profileIsMissing
        ? fulfillJson(route, { error: "Not found" }, 404)
        : fulfillJson(route, {
            profile: {
              id: "public-profile",
              display_name: longName,
              bio: longBio,
              created_at: "2026-01-01T00:00:00.000Z",
              stats: {
                average_score: 4,
                tasks_played: 12,
                last_active_at: "2026-07-28T10:00:00.000Z",
              },
            },
          }),
    );

    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/profiles/public-profile");
    await expect(
      page.getByText("This profile is no longer available."),
    ).toBeVisible();
    await expect(
      page.getByText("We couldn't load this profile. Try again."),
    ).toHaveCount(0);

    profileIsMissing = false;
    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    await expect(page.getByRole("heading", { name: longName })).toBeVisible();
    await expect(page.getByText(longBio)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAccessibilityViolations(page);
  });
});
