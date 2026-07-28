import type { Page, Route } from "@playwright/test";
import {
  expect,
  expectNoSeriousAccessibilityViolations,
  test,
} from "./fixtures";

const gatewayOrigin = "http://127.0.0.1:8484";
const pairingKey = "p".repeat(64);
const transcript = "It sounds difficult. What feels most important to explore?";

const task = {
  id: "task-local",
  slug: "local-runtime-practice",
  title: "Local runtime practice",
  description: "A browser-to-loopback acceptance task.",
  skill_domain: "reflection",
  base_difficulty: 2,
  general_objective: "Reflect and invite exploration.",
  tags: ["local"],
  language: "en",
  is_published: true,
  parent_task_id: null,
  created_at: 1,
  updated_at: 1,
  criteria: [
    {
      id: "criterion-1",
      label: "Reflect",
      description: "Reflect the patient's concern.",
      rubric: null,
    },
  ],
};

const example = {
  id: "example-local",
  task_id: task.id,
  difficulty: 2,
  severity_label: null,
  patient_text: "I am not sure I can keep doing this.",
  language: "en",
  meta: null,
  created_at: 1,
  updated_at: 1,
};

const evaluation = (attemptId: string) => ({
  version: "2.0",
  task_id: task.id,
  example_id: example.id,
  attempt_id: attemptId,
  transcript: { text: transcript },
  criterion_scores: [
    {
      criterion_id: "criterion-1",
      score: 4,
      rationale_short: "Reflects the concern and opens exploration.",
    },
  ],
  overall: {
    score: 4,
    pass: true,
    summary_feedback: "A clear, empathic response.",
    what_to_improve_next: ["Keep the invitation open."],
  },
  patient_reaction: { emotion: "engaged", intensity: 2 },
});

const json = async (route: Route, body: unknown, status = 200) => {
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

const installBrowserState = async (
  page: Page,
  {
    aiMode = "local_only",
    hasOpenAiKey = false,
    injectPairingKey = true,
    deferMicrophone = false,
  }: {
    aiMode?: "openai_only" | "local_only" | "local_prefer";
    hasOpenAiKey?: boolean;
    injectPairingKey?: boolean;
    deferMicrophone?: boolean;
  } = {},
) => {
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ?? "https://test.supabase.co";
  const projectRef = supabaseUrl.split("//")[1]?.split(".")[0] ?? "test";
  await page.addInitScript(
    ({ authKey, runtimeKey, token, injectToken, shouldDeferMicrophone }) => {
      const session = {
        access_token: "test-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "refresh-token",
        user: { id: "user-1", email: "dev@example.com" },
      };
      window.localStorage.setItem(authKey, JSON.stringify(session));
      if (injectToken) {
        window.localStorage.setItem(runtimeKey, token);
      }
      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: true,
      });
      type PendingMicPermission = {
        resolve: (stream: MediaStream) => void;
        reject: (error: DOMException) => void;
      };
      const pendingMicPermissions: PendingMicPermission[] = [];
      const micWindow = window as typeof window & {
        __micPermissionRequests?: number;
        __micRecorderStarts?: number;
        __micTrackStops?: number;
        __resolveNextMicPermission?: () => void;
        __rejectNextMicPermission?: () => void;
      };
      const createMicStream = () =>
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
      micWindow.__micPermissionRequests = 0;
      micWindow.__micRecorderStarts = 0;
      micWindow.__micTrackStops = 0;
      micWindow.__resolveNextMicPermission = () => {
        pendingMicPermissions.shift()?.resolve(createMicStream());
      };
      micWindow.__rejectNextMicPermission = () => {
        pendingMicPermissions
          .shift()
          ?.reject(
            new DOMException(
              "Microphone permission was denied.",
              "NotAllowedError",
            ),
          );
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => {
            micWindow.__micPermissionRequests =
              (micWindow.__micPermissionRequests ?? 0) + 1;
            if (!shouldDeferMicrophone) {
              return Promise.resolve(createMicStream());
            }
            return new Promise<MediaStream>((resolve, reject) => {
              pendingMicPermissions.push({ resolve, reject });
            });
          },
        },
      });
      class FakeMediaRecorder {
        static isTypeSupported() {
          return true;
        }
        state = "inactive";
        mimeType = "audio/webm";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        constructor(_stream: unknown, options?: { mimeType?: string }) {
          this.mimeType = options?.mimeType ?? this.mimeType;
        }
        start() {
          this.state = "recording";
          micWindow.__micRecorderStarts =
            (micWindow.__micRecorderStarts ?? 0) + 1;
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({
            data: new Blob(["browser-local-audio"], { type: this.mimeType }),
          });
          queueMicrotask(() => this.onstop?.());
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: FakeMediaRecorder,
      });
      Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: async function play() {
          window.setTimeout(() => this.dispatchEvent(new Event("ended")), 0);
        },
      });
      Object.defineProperty(HTMLMediaElement.prototype, "pause", {
        configurable: true,
        value: () => undefined,
      });
    },
    {
      authKey: `sb-${projectRef}-auth-token`,
      runtimeKey: `therapy.localRuntimePairingKey:${gatewayOrigin}`,
      token: pairingKey,
      injectToken: injectPairingKey,
      shouldDeferMicrophone: deferMicrophone,
    },
  );

  await page.route("**/api/v1/me", (route) =>
    json(route, {
      id: "user-1",
      email: "dev@example.com",
      display_name: "Dev User",
      bio: null,
      created_at: null,
      hasOpenAiKey,
    }),
  );
  await page.route("**/api/v1/me/settings", (route) =>
    json(route, {
      aiMode,
      localAiBaseUrl: gatewayOrigin,
      localSttUrl: null,
      localLlmUrl: null,
      storeAudio: false,
      hasOpenAiKey,
    }),
  );
  await page.route("**/api/v1/admin/whoami", (route) =>
    json(route, {
      isAuthenticated: true,
      isAdmin: false,
      email: "dev@example.com",
    }),
  );
  await page.route("**/api/v1/sessions/*/attempts", (route) => {
    expect(route.request().method()).toBe("GET");
    return json(route, []);
  });
};

const installReadyGateway = async (page: Page, attemptId: string) => {
  const authorizationHeaders: string[] = [];
  await page.route(`${gatewayOrigin}/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/health") {
      await json(route, {
        service: "therapy-local-runtime",
        protocol_version: "1",
        status: "ready",
      });
      return;
    }
    authorizationHeaders.push(request.headers().authorization ?? "");
    if (path === "/v1/audio/transcriptions") {
      await json(route, { text: transcript, model: "faster-whisper-test" });
      return;
    }
    if (path === "/v1/responses") {
      await json(route, {
        id: "response-local",
        model: "qwen-test",
        output_text: JSON.stringify(evaluation(attemptId)),
      });
      return;
    }
    await json(route, { detail: "Not found" }, 404);
  });
  return authorizationHeaders;
};

const installMinigameRoundScaffold = async (
  page: Page,
  {
    mode,
    sessionId,
    onStartRound,
  }: {
    mode: "ffa" | "tdm";
    sessionId: string;
    onStartRound: (route: Route) => Promise<void>;
  },
) => {
  const roundId = `${mode}-round`;
  const playerAId = `${mode}-player-a`;
  const playerBId = `${mode}-player-b`;
  const players = [
    {
      id: playerAId,
      session_id: sessionId,
      name: "Ava",
      avatar: "astro",
      team_id: mode === "tdm" ? `${mode}-team-a` : null,
      created_at: 1,
    },
    ...(mode === "tdm"
      ? [
          {
            id: playerBId,
            session_id: sessionId,
            name: "Ben",
            avatar: "nova",
            team_id: `${mode}-team-b`,
            created_at: 1,
          },
        ]
      : []),
  ];
  const teams =
    mode === "tdm"
      ? [
          {
            id: `${mode}-team-a`,
            session_id: sessionId,
            name: "Aurora",
            color: "teal",
            created_at: 1,
          },
          {
            id: `${mode}-team-b`,
            session_id: sessionId,
            name: "Nova",
            color: "rose",
            created_at: 1,
          },
        ]
      : [];

  await page.route("**/api/v1/tasks?*", (route) => json(route, [task]));
  await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
    json(route, task),
  );
  await page.route(
    `**/api/v1/minigames/sessions/${sessionId}/state`,
    (route) =>
      json(route, {
        session: {
          id: sessionId,
          user_id: "user-1",
          game_type: mode,
          visibility_mode: "normal",
          task_selection: {},
          settings: {},
          created_at: 1,
          ended_at: null,
          last_active_at: 1,
          current_round_id: roundId,
          current_player_id: playerAId,
        },
        teams,
        players,
        rounds: [
          {
            id: roundId,
            session_id: sessionId,
            position: 0,
            task_id: task.id,
            example_id: example.id,
            player_a_id: playerAId,
            player_b_id: mode === "tdm" ? playerBId : null,
            team_a_id: mode === "tdm" ? `${mode}-team-a` : null,
            team_b_id: mode === "tdm" ? `${mode}-team-b` : null,
            status: "active",
            started_at: 1,
            completed_at: null,
            patient_text: example.patient_text,
          },
        ],
        results: [],
      }),
  );
  await page.route(
    `**/api/v1/minigames/sessions/${sessionId}/rounds/${roundId}/start`,
    onStartRound,
  );
  await page.route(
    `**/api/v1/minigames/sessions/${sessionId}/resume`,
    (route) => json(route, { ok: true }),
  );
  await page.route(
    "**/api/v1/practice/patient-audio/prefetch-batch",
    (route) =>
      json(route, {
        items: [
          {
            statement_id: example.id,
            cache_key: `${mode}-patient-audio`,
            status: "ready",
            audio_url: `/api/v1/tts/${mode}-patient-audio`,
          },
        ],
        ready_count: 1,
        total_count: 1,
      }),
  );
  await page.route("**/api/v1/practice/patient-audio/prefetch", (route) =>
    json(route, {
      cache_key: `${mode}-patient-audio`,
      status: "ready",
      audio_url: `/api/v1/tts/${mode}-patient-audio`,
    }),
  );
  await page.route(`**/api/v1/tts/${mode}-patient-audio`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: "RIFF-test-audio",
    });
  });

  return { roundId };
};

const dismissSetupWizard = async (page: Page) => {
  const closeButton = page.getByRole("button", { name: "Close" });
  const appeared = await closeButton
    .waitFor({ state: "visible", timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  if (appeared) {
    await closeButton.evaluate((element) =>
      (element as HTMLButtonElement).click(),
    );
    await expect(closeButton).toBeHidden();
  }
};

test.describe("browser-to-loopback local practice", () => {
  test("standard sessions restore partial state, recover stale or corrupt state, and preserve a failed selected-session delete", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "practiceSessionProgress:partial-session",
        "1",
      );
    });

    const firstItem = {
      session_item_id: "partial-item-1",
      task_id: task.id,
      example_id: example.id,
      target_difficulty: 2,
      patient_text: example.patient_text,
    };
    const secondItem = {
      session_item_id: "partial-item-2",
      task_id: task.id,
      example_id: "example-partial-second",
      target_difficulty: 2,
      patient_text: "I keep returning to the same difficult thought.",
    };
    const recoveredItem = {
      session_item_id: "recovered-item",
      task_id: task.id,
      example_id: "example-recovered",
      target_difficulty: 2,
      patient_text: "I need a fresh example after that broken session.",
    };
    const partialSession = {
      id: "partial-session",
      task_id: task.id,
      item_count: 2,
      completed_count: 1,
      created_at: "2026-07-28T12:00:00.000Z",
      items: [firstItem, secondItem],
    };
    const corruptSession = {
      id: "corrupt-session",
      task_id: task.id,
      item_count: 2,
      completed_count: 0,
      created_at: "2026-07-28T11:00:00.000Z",
      items: [],
    };
    const recoveredSession = {
      id: "recovered-session",
      task_id: task.id,
      item_count: 1,
      completed_count: 0,
      created_at: "2026-07-28T13:00:00.000Z",
      items: [recoveredItem],
    };
    let sessions = [partialSession];
    let deleteShouldFail = true;
    let startRequests = 0;
    let deleteRequests = 0;

    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      json(route, task),
    );
    await page.route("**/api/v1/sessions?*", (route) => json(route, sessions));
    await page.route("**/api/v1/sessions/start", async (route) => {
      startRequests += 1;
      sessions = [recoveredSession, corruptSession, partialSession];
      await json(route, {
        session_id: recoveredSession.id,
        items: recoveredSession.items,
      });
    });
    await page.route(
      `**/api/v1/sessions/${recoveredSession.id}`,
      async (route) => {
        expect(route.request().method()).toBe("DELETE");
        deleteRequests += 1;
        if (deleteShouldFail) {
          await json(route, { error: "Temporary delete failure." }, 503);
          return;
        }
        sessions = sessions.filter(
          (session) => session.id !== recoveredSession.id,
        );
        await json(route, { ok: true });
      },
    );

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}?session=${partialSession.id}`,
    );
    await dismissSetupWizard(page);
    await expect(page.getByText(secondItem.patient_text)).toBeVisible();
    await expect(
      page.getByText("Example 2 of 2", { exact: true }),
    ).toBeVisible();

    await page.evaluate(() =>
      window.localStorage.setItem(
        "practiceSessionProgress:partial-session",
        "999",
      ),
    );
    await page.reload();
    await expect(page.getByText(secondItem.patient_text)).toBeVisible();

    sessions = [corruptSession, partialSession];
    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}?session=${corruptSession.id}`,
    );
    await expect(page.getByText(recoveredItem.patient_text)).toBeVisible();
    expect(startRequests).toBe(1);

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}?session=${recoveredSession.id}`,
    );
    await page.getByRole("radio", { name: /type/i }).check();
    const response = page.getByLabel("Written response");
    await response.fill("A draft that must survive a failed delete.");
    const sessionHistory = page.getByText("Session history", { exact: true });
    await sessionHistory.click();
    await page.getByRole("button", { name: "Delete" }).first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete session" })
      .click();

    await expect(
      page.getByText("Unable to delete this session. Please try again."),
    ).toBeVisible();
    await expect(response).toHaveValue(
      "A draft that must survive a failed delete.",
    );
    expect(
      await page.evaluate(() =>
        Object.keys(window.localStorage).some((key) =>
          key.startsWith(
            "practiceTypedDraft:user-1:recovered-session:recovered-item",
          ),
        ),
      ),
    ).toBe(true);

    deleteShouldFail = false;
    await page.getByRole("button", { name: "Delete" }).first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete session" })
      .click();
    await expect(page.getByText("Session RECOVE", { exact: true })).toHaveCount(
      0,
    );
    expect(deleteRequests).toBe(2);
    expect(
      await page.evaluate(() =>
        Object.keys(window.localStorage).some((key) =>
          key.startsWith(
            "practiceTypedDraft:user-1:recovered-session:recovered-item",
          ),
        ),
      ),
    ).toBe(false);
    await expectNoSeriousAccessibilityViolations(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  });

  test("typed standard practice uses local prepare/evaluate/commit without speech metadata", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page);
    const gatewayAuthorization = await installReadyGateway(
      page,
      "attempt-typed",
    );
    const prepareBodies: Array<Record<string, unknown>> = [];
    const commitBodies: Array<Record<string, unknown>> = [];

    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      json(route, task),
    );
    await page.route("**/api/v1/sessions?*", (route) => json(route, []));
    await page.route("**/api/v1/sessions/start", (route) =>
      json(route, {
        session_id: "typed-practice-session",
        items: [
          {
            session_item_id: "typed-session-item",
            task_id: task.id,
            example_id: example.id,
            target_difficulty: 2,
            patient_text: example.patient_text,
          },
        ],
      }),
    );
    await page.route("**/api/v1/practice/local/prepare", async (route) => {
      prepareBodies.push(route.request().postDataJSON());
      await json(route, {
        requestId: "prepare-typed",
        attemptId: "attempt-typed",
        score_trust: "local_unverified",
        task,
        example,
      });
    });
    await page.route("**/api/v1/practice/local/commit", async (route) => {
      commitBodies.push(route.request().postDataJSON());
      const response = {
        requestId: "commit-typed",
        attemptId: "attempt-typed",
        score_trust: "local_unverified",
        transcript: {
          text: transcript,
          input_mode: "typed",
          provider: null,
          duration_ms: null,
        },
      };
      await json(
        route,
        commitBodies.length === 1
          ? response
          : {
              ...response,
              scoring: {
                evaluation: evaluation("attempt-typed"),
                provider: { kind: "local", model: "qwen-test" },
                duration_ms: 30,
              },
            },
      );
    });

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}`,
    );
    await dismissSetupWizard(page);
    await page.getByRole("radio", { name: /type/i }).check();
    const response = page.getByLabel("Written response");
    await response.fill(transcript);
    const submit = page.getByRole("button", {
      name: "Evaluate written response",
    });
    await submit.click();
    await expect(submit).toBeEnabled();
    await expect(response).toHaveValue(transcript);
    expect(
      await page.evaluate(() =>
        Object.keys(window.localStorage).some((key) =>
          key.startsWith("practiceTypedDraft:"),
        ),
      ),
    ).toBe(true);

    await submit.click();

    await expect(page.getByText("Local · unverified").first()).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    expect(prepareBodies).toHaveLength(1);
    expect(commitBodies).toHaveLength(2);
    for (const prepareBody of prepareBodies) {
      expect(prepareBody).toEqual({
        session_item_id: "typed-session-item",
        input_mode: "typed",
        transcript: { text: transcript },
      });
    }
    for (const commitBody of commitBodies) {
      expect(commitBody).toMatchObject({
        attempt_id: "attempt-typed",
        input_mode: "typed",
        transcript: { text: transcript },
      });
      expect(
        (commitBody.transcript as Record<string, unknown>)?.model,
      ).toBeUndefined();
      expect(
        (commitBody.transcript as Record<string, unknown>)?.duration_ms,
      ).toBeUndefined();
    }
    expect(gatewayAuthorization).toEqual([
      `Bearer ${pairingKey}`,
      `Bearer ${pairingKey}`,
    ]);
  });

  test("recording locks practice transitions and stopping releases the microphone", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page, { deferMicrophone: true });
    await installReadyGateway(page, "attempt-navigation-lock");
    let sessionStarted = false;
    const items = [
      {
        session_item_id: "locked-item-1",
        task_id: task.id,
        example_id: example.id,
        target_difficulty: 2,
        patient_text: example.patient_text,
      },
      {
        session_item_id: "locked-item-2",
        task_id: task.id,
        example_id: "example-second",
        target_difficulty: 2,
        patient_text: "I do not know what to say next.",
      },
    ];

    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      json(route, task),
    );
    await page.route("**/api/v1/sessions?*", (route) =>
      json(
        route,
        sessionStarted
          ? [
              {
                id: "locked-session",
                task_id: task.id,
                item_count: items.length,
                completed_count: 0,
                created_at: new Date().toISOString(),
                items,
              },
            ]
          : [],
      ),
    );
    await page.route("**/api/v1/sessions/start", async (route) => {
      sessionStarted = true;
      await json(route, { session_id: "locked-session", items });
    });
    await page.route("**/api/v1/practice/local/prepare", (route) =>
      json(route, {
        requestId: "prepare-navigation-lock",
        attemptId: "attempt-navigation-lock",
        score_trust: "local_unverified",
        task,
        example,
      }),
    );
    await page.route("**/api/v1/practice/local/commit", (route) =>
      json(route, {
        requestId: "commit-navigation-lock",
        attemptId: "attempt-navigation-lock",
        score_trust: "local_unverified",
        transcript: {
          text: transcript,
          provider: { kind: "local", model: "faster-whisper-test" },
          duration_ms: 20,
        },
        scoring: {
          evaluation: evaluation("attempt-navigation-lock"),
          provider: { kind: "local", model: "qwen-test" },
          duration_ms: 30,
        },
      }),
    );

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}`,
    );
    await dismissSetupWizard(page);
    await expect(
      page.getByRole("button", { name: "Next example" }),
    ).toBeEnabled();
    await page.getByText("Session history", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "New session" }),
    ).toBeVisible();

    const startRecordingButton = page.getByRole("button", {
      name: "Start recording",
    });
    await startRecordingButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });

    await expect(startRecordingButton).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Stop recording" }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const micWindow = window as typeof window & {
          __micPermissionRequests?: number;
          __micRecorderStarts?: number;
        };
        return {
          permissionRequests: micWindow.__micPermissionRequests ?? 0,
          recorderStarts: micWindow.__micRecorderStarts ?? 0,
        };
      }),
    ).toEqual({ permissionRequests: 1, recorderStarts: 0 });

    await expect(
      page.getByRole("button", { name: "Next example" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "New session" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Text", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Audio", exact: true }),
    ).toBeDisabled();

    await page.evaluate(() => {
      (
        window as typeof window & {
          __resolveNextMicPermission?: () => void;
        }
      ).__resolveNextMicPermission?.();
    });
    await expect(
      page.getByRole("button", { name: "Stop recording" }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __micRecorderStarts?: number })
            .__micRecorderStarts ?? 0,
      ),
    ).toBe(1);

    await page.getByRole("button", { name: "Stop recording" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __micTrackStops?: number })
              .__micTrackStops ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await expect(page.getByText("Coach feedback")).toBeVisible();
  });

  for (const mode of ["ffa", "tdm"] as const) {
    test(`${mode.toUpperCase()} keeps recording locked when round activation fails`, async ({
      page,
      baseURL,
    }) => {
      await installBrowserState(page, { deferMicrophone: true });
      const sessionId = `${mode}-activation-failure`;
      let startCalls = 0;
      let releaseStart!: () => void;
      const startGate = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      await installMinigameRoundScaffold(page, {
        mode,
        sessionId,
        onStartRound: async (route) => {
          startCalls += 1;
          await startGate;
          await json(route, { error: "Temporary activation failure." }, 503);
        },
      });

      await page.goto(
        `${baseURL ?? "http://localhost:5173"}/minigames/play/${sessionId}`,
      );
      await dismissSetupWizard(page);
      await expect.poll(() => startCalls).toBe(1);
      const recordButton = page
        .getByRole("button", { name: /record/i })
        .first();
      await expect(recordButton).toBeDisabled();
      await recordButton.evaluate((element) =>
        (element as HTMLButtonElement).click(),
      );
      expect(startCalls).toBe(1);
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __micPermissionRequests?: number })
              .__micPermissionRequests ?? 0,
        ),
      ).toBe(0);

      releaseStart();
      await expect(
        page.getByText(
          "We couldn’t start this round. Check your connection and try again.",
        ),
      ).toBeVisible();
      await expect(recordButton).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(0);
      await page.waitForTimeout(300);
      expect(startCalls).toBe(1);
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __micRecorderStarts?: number })
              .__micRecorderStarts ?? 0,
        ),
      ).toBe(0);
    });

    test(`${mode.toUpperCase()} handles permission denial before exposing Stop`, async ({
      page,
      baseURL,
    }) => {
      await installBrowserState(page, { deferMicrophone: true });
      const sessionId = `${mode}-permission-denial`;
      await installMinigameRoundScaffold(page, {
        mode,
        sessionId,
        onStartRound: (route) => json(route, { ok: true }),
      });

      await page.goto(
        `${baseURL ?? "http://localhost:5173"}/minigames/play/${sessionId}`,
      );
      await dismissSetupWizard(page);
      if (mode === "tdm") {
        const versus = page.getByText("VS", { exact: true }).last();
        await expect(versus).toBeVisible();
        await page.waitForTimeout(1_250);
        await versus.click();
      }
      const recordButton = page
        .getByRole("button", { name: /record/i })
        .first();
      await expect(recordButton).toBeEnabled({ timeout: 5_000 });
      await recordButton.evaluate((element) => {
        (element as HTMLButtonElement).click();
        (element as HTMLButtonElement).click();
      });

      await expect(recordButton).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() => {
          const micWindow = window as typeof window & {
            __micPermissionRequests?: number;
            __micRecorderStarts?: number;
          };
          return {
            permissionRequests: micWindow.__micPermissionRequests ?? 0,
            recorderStarts: micWindow.__micRecorderStarts ?? 0,
          };
        }),
      ).toEqual({ permissionRequests: 1, recorderStarts: 0 });

      await page.evaluate(() => {
        (
          window as typeof window & {
            __rejectNextMicPermission?: () => void;
          }
        ).__rejectNextMicPermission?.();
      });
      await expect(
        page.getByText("Microphone access failed. Please try again."),
      ).toBeVisible();
      await expect(recordButton).toBeEnabled();

      await recordButton.click();
      await expect(recordButton).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toHaveCount(0);
      await page.evaluate(() => {
        (
          window as typeof window & {
            __resolveNextMicPermission?: () => void;
          }
        ).__resolveNextMicPermission?.();
      });
      await expect(
        page.getByRole("button", { name: "Stop", exact: true }),
      ).toBeEnabled();
      expect(
        await page.evaluate(
          () =>
            (window as typeof window & { __micRecorderStarts?: number })
              .__micRecorderStarts ?? 0,
        ),
      ).toBe(1);

      await page.getByRole("button", { name: "New game" }).click();
      await expect(
        page.getByRole("dialog", { name: "Choose your mode" }),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as typeof window & { __micTrackStops?: number })
                .__micTrackStops ?? 0,
          ),
        )
        .toBeGreaterThan(0);
    });

    test(`${mode.toUpperCase()} discards a microphone grant after cancellation`, async ({
      page,
      baseURL,
    }) => {
      await installBrowserState(page, { deferMicrophone: true });
      const sessionId = `${mode}-late-permission`;
      await installMinigameRoundScaffold(page, {
        mode,
        sessionId,
        onStartRound: (route) => json(route, { ok: true }),
      });

      await page.goto(
        `${baseURL ?? "http://localhost:5173"}/minigames/play/${sessionId}`,
      );
      await dismissSetupWizard(page);
      if (mode === "tdm") {
        const versus = page.getByText("VS", { exact: true }).last();
        await expect(versus).toBeVisible();
        await page.waitForTimeout(1_250);
        await versus.click();
      }
      const recordButton = page
        .getByRole("button", { name: /record/i })
        .first();
      await expect(recordButton).toBeEnabled({ timeout: 5_000 });
      await recordButton.click();
      await expect(recordButton).toBeDisabled();

      await page.getByRole("button", { name: "New game" }).click();
      await expect(
        page.getByRole("dialog", { name: "Choose your mode" }),
      ).toBeVisible();
      await page.evaluate(() => {
        (
          window as typeof window & {
            __resolveNextMicPermission?: () => void;
          }
        ).__resolveNextMicPermission?.();
      });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const micWindow = window as typeof window & {
              __micRecorderStarts?: number;
              __micTrackStops?: number;
            };
            return {
              recorderStarts: micWindow.__micRecorderStarts ?? 0,
              trackStops: micWindow.__micTrackStops ?? 0,
            };
          }),
        )
        .toEqual({ recorderStarts: 0, trackStops: 1 });
    });
  }

  test("typed cloud retry preserves the response and locks mode during evaluation", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page, {
      aiMode: "openai_only",
      hasOpenAiKey: true,
      injectPairingKey: false,
    });
    let runCount = 0;
    const runBodies: Array<Record<string, unknown>> = [];
    let releaseFirstFailure = () => undefined;
    const firstFailureGate = new Promise<void>((resolve) => {
      releaseFirstFailure = resolve;
    });

    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      json(route, task),
    );
    await page.route("**/api/v1/sessions?*", (route) => json(route, []));
    await page.route("**/api/v1/sessions/start", (route) =>
      json(route, {
        session_id: "cloud-typed-session",
        items: [
          {
            session_item_id: "cloud-typed-item",
            task_id: task.id,
            example_id: example.id,
            target_difficulty: 2,
            patient_text: example.patient_text,
          },
        ],
      }),
    );
    await page.route("**/api/v1/practice/run", async (route) => {
      runBodies.push(route.request().postDataJSON());
      runCount += 1;
      if (runCount === 1) {
        await firstFailureGate;
        await json(route, { error: "Temporary evaluation failure." }, 503);
        return;
      }
      await json(route, {
        requestId: "cloud-typed-request",
        attemptId: "cloud-typed-attempt",
        score_trust: "cloud_trusted",
        transcript: {
          text: transcript,
          input_mode: "typed",
          provider: null,
          duration_ms: null,
        },
        scoring: {
          evaluation: evaluation("cloud-typed-attempt"),
          provider: { kind: "openai", model: "test-evaluator" },
          duration_ms: 20,
        },
      });
    });

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}`,
    );
    await dismissSetupWizard(page);
    await page.getByRole("radio", { name: /type/i }).check();
    const response = page.getByLabel("Written response");
    await response.fill(transcript);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(window.localStorage).some((key) =>
            key.startsWith("practiceTypedDraft:"),
          ),
        ),
      )
      .toBe(true);
    await page.reload();
    await dismissSetupWizard(page);
    await page.getByRole("radio", { name: /type/i }).check();
    await expect(response).toHaveValue(transcript);
    const submit = page.getByRole("button", {
      name: "Evaluate written response",
    });
    await submit.click();
    await expect(page.getByRole("radio", { name: /speak/i })).toBeDisabled();
    releaseFirstFailure();
    await expect(page.getByText("Temporary evaluation failure.")).toBeVisible();
    await expect(response).toHaveValue(transcript);

    await submit.click();
    await expect(page.getByText("Coach feedback")).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(window.localStorage).some((key) =>
          key.startsWith("practiceTypedDraft:"),
        ),
      ),
    ).toBe(false);
    expect(runBodies).toHaveLength(2);
    for (const body of runBodies) {
      expect(body).toMatchObject({
        session_item_id: "cloud-typed-item",
        input_mode: "typed",
        transcript_text: transcript,
      });
      expect(body).not.toHaveProperty("audio");
      expect(body).not.toHaveProperty("audio_mime");
    }
  });

  test("standard practice transcribes, evaluates, commits, and shows provenance", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page);
    const gatewayAuthorization = await installReadyGateway(
      page,
      "attempt-standard",
    );
    let prepareBody: Record<string, unknown> | null = null;
    let commitBody: Record<string, unknown> | null = null;

    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      json(route, task),
    );
    await page.route("**/api/v1/sessions?*", (route) => json(route, []));
    await page.route("**/api/v1/sessions/start", (route) =>
      json(route, {
        session_id: "practice-session",
        items: [
          {
            session_item_id: "session-item",
            task_id: task.id,
            example_id: example.id,
            target_difficulty: 2,
            patient_text: example.patient_text,
          },
        ],
      }),
    );
    await page.route("**/api/v1/practice/local/prepare", async (route) => {
      prepareBody = route.request().postDataJSON();
      await json(route, {
        requestId: "prepare-request",
        attemptId: "attempt-standard",
        score_trust: "local_unverified",
        task,
        example,
      });
    });
    await page.route("**/api/v1/practice/local/commit", async (route) => {
      commitBody = route.request().postDataJSON();
      await json(route, {
        requestId: "commit-request",
        attemptId: "attempt-standard",
        score_trust: "local_unverified",
        transcript: {
          text: transcript,
          provider: { kind: "local", model: "faster-whisper-test" },
          duration_ms: 20,
        },
        scoring: {
          evaluation: evaluation("attempt-standard"),
          provider: { kind: "local", model: "qwen-test" },
          duration_ms: 30,
        },
      });
    });

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/practice/${task.id}`,
    );
    await dismissSetupWizard(page);
    await page.getByRole("button", { name: "Start recording" }).click();
    await page.getByRole("button", { name: "Stop recording" }).click();

    await expect(page.getByText("Local · unverified").first()).toBeVisible();
    await expect(
      page.getByText(/excluded from public rankings/i),
    ).toBeVisible();
    expect(prepareBody).toMatchObject({
      session_item_id: "session-item",
      input_mode: "audio",
      transcript: {
        text: transcript,
        model: "faster-whisper-test",
      },
    });
    expect(
      (prepareBody?.transcript as Record<string, unknown>)?.duration_ms,
    ).toEqual(expect.any(Number));
    expect(commitBody?.attempt_id).toBe("attempt-standard");
    expect(commitBody).not.toHaveProperty("pairing_key");
    expect(gatewayAuthorization).toEqual([
      `Bearer ${pairingKey}`,
      `Bearer ${pairingKey}`,
    ]);
  });

  test("local-preferred minigame preserves prepared audio provenance when cloud scoring is the fallback", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page, {
      aiMode: "local_prefer",
      hasOpenAiKey: true,
    });
    const gatewayAuthorization: string[] = [];
    await page.route(`${gatewayOrigin}/**`, async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/health") {
        await json(route, {
          service: "therapy-local-runtime",
          protocol_version: "1",
          status: "ready",
        });
        return;
      }
      gatewayAuthorization.push(request.headers().authorization ?? "");
      if (path === "/v1/audio/transcriptions") {
        await json(route, {
          text: transcript,
          model: "faster-whisper-test",
        });
        return;
      }
      if (path === "/v1/responses") {
        await json(route, { detail: "Local evaluator unavailable." }, 503);
        return;
      }
      await json(route, { detail: "Not found" }, 404);
    });
    let prepareBody: Record<string, unknown> | null = null;
    let finalized = false;
    let cloudSubmitBody: Record<string, unknown> | null = null;
    const sessionId = "session-local";
    const roundId = "round-local";
    const playerId = "player-local";

    await page.route("**/api/v1/tasks?*", (route) => json(route, [task]));
    await page.route(`**/api/v1/tasks/${task.id}*`, (route) =>
      json(route, task),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/state`,
      (route) =>
        json(route, {
          session: {
            id: sessionId,
            user_id: "user-1",
            game_type: "ffa",
            visibility_mode: "normal",
            task_selection: {},
            settings: {},
            created_at: 1,
            ended_at: null,
            last_active_at: 1,
            current_round_id: roundId,
            current_player_id: playerId,
          },
          teams: [],
          players: [
            {
              id: playerId,
              session_id: sessionId,
              name: "Nova",
              avatar: "nova",
              team_id: null,
              created_at: 1,
            },
          ],
          rounds: [
            {
              id: roundId,
              session_id: sessionId,
              position: 0,
              task_id: task.id,
              example_id: example.id,
              player_a_id: playerId,
              player_b_id: null,
              team_a_id: null,
              team_b_id: null,
              status: "active",
              started_at: 1,
              completed_at: null,
              patient_text: example.patient_text,
            },
          ],
          results: [],
        }),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/rounds/${roundId}/start`,
      (route) => json(route, { ok: true }),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/resume`,
      (route) => json(route, { ok: true }),
    );
    await page.route(
      "**/api/v1/practice/patient-audio/prefetch-batch",
      (route) =>
        json(route, {
          items: [
            {
              statement_id: example.id,
              cache_key: "patient-audio",
              status: "ready",
              audio_url: "/api/v1/tts/patient-audio",
            },
          ],
          ready_count: 1,
          total_count: 1,
        }),
    );
    await page.route("**/api/v1/practice/patient-audio/prefetch", (route) =>
      json(route, {
        cache_key: "patient-audio",
        status: "ready",
        audio_url: "/api/v1/tts/patient-audio",
      }),
    );
    await page.route("**/api/v1/tts/patient-audio", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: "RIFF-test-audio",
      });
    });
    await page.route("**/api/v1/practice/local/prepare", async (route) => {
      prepareBody = route.request().postDataJSON();
      await json(route, {
        requestId: "prepare-minigame",
        attemptId: "attempt-minigame",
        score_trust: "local_unverified",
        task,
        example,
      });
    });
    await page.route("**/api/v1/practice/local/commit", (route) =>
      json(route, {
        requestId: "commit-minigame",
        attemptId: "attempt-minigame",
        score_trust: "local_unverified",
        transcript: {
          text: transcript,
          provider: { kind: "local", model: "faster-whisper-test" },
          duration_ms: 20,
        },
        scoring: {
          evaluation: evaluation("attempt-minigame"),
          provider: { kind: "local", model: "qwen-test" },
          duration_ms: 30,
        },
      }),
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/rounds/${roundId}/commit-local`,
      async (route) => {
        finalized = true;
        await json(route, {
          requestId: "finalize-minigame",
          attemptId: "attempt-minigame",
          score_trust: "local_unverified",
          transcript: {
            text: transcript,
            provider: { kind: "local", model: "faster-whisper-test" },
            duration_ms: 20,
          },
          scoring: {
            evaluation: evaluation("attempt-minigame"),
            provider: { kind: "local", model: "qwen-test" },
            duration_ms: 30,
          },
          timing_penalty: 0,
          adjusted_score: 4,
        });
      },
    );
    await page.route(
      `**/api/v1/minigames/sessions/${sessionId}/rounds/${roundId}/submit`,
      async (route) => {
        cloudSubmitBody = route.request().postDataJSON();
        await json(route, {
          requestId: "fallback-minigame",
          attemptId: "attempt-minigame",
          score_trust: "cloud_trusted",
          transcript: {
            text: transcript,
            input_mode: "audio",
            provider: {
              kind: "local",
              model: "faster-whisper-test",
            },
            duration_ms: 20,
          },
          scoring: {
            evaluation: evaluation("attempt-minigame"),
            provider: { kind: "openai", model: "test-evaluator" },
            duration_ms: 30,
          },
          timing_penalty: 0,
          adjusted_score: 4,
        });
      },
    );

    await page.goto(
      `${baseURL ?? "http://localhost:5173"}/minigames/play/${sessionId}`,
    );
    await dismissSetupWizard(page);
    const recordButton = page.getByRole("button", { name: /record/i }).first();
    await expect(recordButton).toBeEnabled();
    await recordButton.click();
    await page.getByRole("button", { name: /stop/i }).first().click();

    await expect(page.getByText("Round complete").first()).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    expect(prepareBody).toMatchObject({
      task_id: task.id,
      example_id: example.id,
      input_mode: "audio",
      transcript: {
        text: transcript,
        model: "faster-whisper-test",
      },
      minigame: {
        session_id: sessionId,
        round_id: roundId,
        player_id: playerId,
      },
    });
    expect(
      (prepareBody?.transcript as Record<string, unknown>)?.duration_ms,
    ).toEqual(expect.any(Number));
    expect(cloudSubmitBody).toMatchObject({
      player_id: playerId,
      transcript_text: transcript,
      attempt_id: "attempt-minigame",
      mode: "openai_only",
      practice_mode: "real_time",
    });
    expect(finalized).toBe(false);
    expect(gatewayAuthorization).toEqual([
      `Bearer ${pairingKey}`,
      `Bearer ${pairingKey}`,
    ]);
  });

  test("pairs through Settings, persists across reload, and recovers after key rotation", async ({
    page,
    baseURL,
  }) => {
    await installBrowserState(page, { injectPairingKey: false });
    const rotatedPairingKey = "r".repeat(64);
    let acceptedPairingKey = pairingKey;
    await page.route(`${gatewayOrigin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/health") {
        await json(route, {
          service: "therapy-local-runtime",
          protocol_version: "1",
          status: "ready",
        });
        return;
      }
      if (
        route.request().headers().authorization !==
        `Bearer ${acceptedPairingKey}`
      ) {
        await json(route, { detail: "Invalid pairing key." }, 401);
        return;
      }
      if (path === "/health/details") {
        await json(route, {
          service: "therapy-local-runtime",
          protocol_version: "1",
          status: "ready",
          platform_id: "darwin-arm64",
          defaults: {
            responses: "local//llm/qwen3-mlx",
            "audio.transcriptions": "local//stt/parakeet-mlx",
          },
        });
        return;
      }
      if (path === "/v1/responses") {
        await json(route, { output_text: "connected", model: "qwen-test" });
        return;
      }
      if (path === "/v1/audio/transcriptions") {
        await json(route, { text: "", model: "stt-test" });
        return;
      }
      await json(route, { detail: "Not found" }, 404);
    });

    await page.goto(`${baseURL ?? "http://localhost:5173"}/settings`);
    await dismissSetupWizard(page);
    const pairingInput = page.getByLabel("Local pairing key");
    const storageKey = `therapy.localRuntimePairingKey:${gatewayOrigin}`;
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        storageKey,
      ),
    ).toBeNull();

    await pairingInput.fill(pairingKey);
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(
      page.getByText("Pairing key saved in this browser."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        (key) => window.localStorage.getItem(key),
        storageKey,
      ),
    ).toBe(pairingKey);

    await page.reload();
    await dismissSetupWizard(page);
    await expect(page.getByLabel("Local pairing key")).toHaveValue(pairingKey);
    await page.getByRole("button", { name: "Run all" }).click();
    await expect(page.getByText("Ready").first()).toBeVisible();

    acceptedPairingKey = rotatedPairingKey;
    await page.getByRole("button", { name: "Run all" }).click();
    await expect(
      page.getByText(/pairing key is missing or no longer valid/i).first(),
    ).toBeVisible();

    await page.getByLabel("Local pairing key").fill(rotatedPairingKey);
    await page.getByRole("button", { name: "Save settings" }).click();
    await page.reload();
    await dismissSetupWizard(page);
    await expect(page.getByLabel("Local pairing key")).toHaveValue(
      rotatedPairingKey,
    );
    await page.getByRole("button", { name: "Run all" }).click();
    await expect(page.getByText("Ready").first()).toBeVisible();
  });

  test("the existing deployed HTTPS origin can reach a real loopback gateway", async ({
    context,
    page,
  }) => {
    const httpsAppUrl = process.env.REAL_HTTPS_APP_URL;
    const realGatewayOrigin = process.env.REAL_GATEWAY_ORIGIN;
    const realPairingKey = process.env.REAL_PAIRING_KEY;
    test.skip(
      !httpsAppUrl || !realGatewayOrigin || !realPairingKey,
      "Run through scripts/run-local-runtime-network-smoke.mjs.",
    );

    await context.grantPermissions(["local-network-access"], {
      origin: new URL(httpsAppUrl as string).origin,
    });
    await page.goto(httpsAppUrl as string);
    const result = await page.evaluate(
      async ({ origin, token }) => {
        const healthResponse = await fetch(`${origin}/health`, {
          cache: "no-store",
          mode: "cors",
        });
        const detailsResponse = await fetch(`${origin}/health/details`, {
          cache: "no-store",
          mode: "cors",
          headers: { Authorization: `Bearer ${token}` },
        });
        const rejectedResponse = await fetch(`${origin}/health/details`, {
          cache: "no-store",
          mode: "cors",
          headers: { Authorization: "Bearer deliberately-wrong-key" },
        });
        return {
          appOrigin: window.location.origin,
          healthStatus: healthResponse.status,
          health: await healthResponse.json(),
          detailsStatus: detailsResponse.status,
          details: await detailsResponse.json(),
          rejectedStatus: rejectedResponse.status,
        };
      },
      { origin: realGatewayOrigin as string, token: realPairingKey as string },
    );

    expect(result.appOrigin).toBe(new URL(httpsAppUrl as string).origin);
    expect(result.healthStatus).toBe(200);
    expect(result.health).toMatchObject({
      service: "therapy-local-runtime",
      protocol_version: "1",
      status: "ready",
    });
    expect(result.detailsStatus).toBe(200);
    expect(result.details).toMatchObject({
      service: "therapy-local-runtime",
      protocol_version: "1",
      status: "ready",
    });
    expect(result.rejectedStatus).toBe(401);
  });
});
