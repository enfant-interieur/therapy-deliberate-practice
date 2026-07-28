// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { fr } from "./i18n/fr";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { invokeMock, openUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openUrlMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

const models = [
  {
    id: "llm-a",
    metadata: {
      display: {
        title:
          "Modèle de langage local avec une désignation volontairement longue",
      },
      api: { endpoint: "responses" },
      compat: { platforms: ["darwin-arm64"] },
    },
  },
  {
    id: "stt-a",
    metadata: {
      display: {
        title:
          "Modèle de transcription locale avec une désignation volontairement longue",
      },
      api: { endpoint: "audio.transcriptions" },
      compat: { platforms: ["darwin-arm64"] },
    },
  },
];

const initialConfig = {
  port: 8484,
  default_models: {
    responses: "llm-a",
    "audio.transcriptions": "stt-a",
  },
  prefer_local: true,
};

const modelJob = (
  status: "pending" | "running" | "completed" | "failed",
  modelStatuses: [
    "pending" | "loading" | "loaded" | "skipped" | "error",
    "pending" | "loading" | "loaded" | "skipped" | "error",
  ],
) => ({
  id: "job-1",
  status,
  created_at: 1,
  started_at: status === "pending" ? null : 2,
  finished_at: ["completed", "failed"].includes(status) ? 3 : null,
  models: [
    {
      model_id: "llm-a",
      status: modelStatuses[0],
      started_at: 2,
      finished_at: ["loaded", "error"].includes(modelStatuses[0]) ? 3 : null,
      duration_ms: ["loaded", "error"].includes(modelStatuses[0]) ? 1000 : null,
      error:
        modelStatuses[0] === "error" ? "Language model checksum failed." : null,
    },
    {
      model_id: "stt-a",
      status: modelStatuses[1],
      started_at: 2,
      finished_at: ["loaded", "error", "skipped"].includes(modelStatuses[1])
        ? 3
        : null,
      duration_ms: modelStatuses[1] === "loaded" ? 1200 : null,
      error: modelStatuses[1] === "error" ? "Speech model load failed." : null,
    },
  ],
});

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const baseInvoke = async (command: string) => {
  switch (command) {
    case "gateway_status":
      return { status: "running" };
    case "gateway_logs":
      return { logs: [] };
    case "gateway_connection_info":
      return {
        port: 8484,
        base_url: "http://127.0.0.1:8484",
        llm_url: "http://127.0.0.1:8484",
        stt_url: "http://127.0.0.1:8484",
        endpoints: {
          health: "http://127.0.0.1:8484/health",
          llm_example: "http://127.0.0.1:8484/v1/responses",
          stt_example: "http://127.0.0.1:8484/v1/audio/transcriptions",
        },
      };
    case "gateway_storage_paths":
      return {
        config_file:
          "/Users/example/Library/Application Support/Therapy Local Runtime/config.json",
        data_dir:
          "/Users/example/Library/Application Support/Therapy Local Runtime/data",
        cache_dir:
          "/Users/example/Library/Caches/Therapy Local Runtime/models/long-cache-directory",
        logging_policy: "metadata_only",
      };
    case "gateway_config":
      return structuredClone(initialConfig);
    case "gateway_pairing_token":
      return {
        token: "test-token-with-enough-characters-to-exercise-wrapping",
        masked: "test…ping",
      };
    case "gateway_doctor":
      return { checks: [] };
    case "gateway_models":
      return { data: structuredClone(models) };
    case "gateway_runtime_state":
      return {
        platform_id: "darwin-arm64",
        defaults: initialConfig.default_models,
        loaded_models: [],
      };
    case "save_gateway_config":
      return undefined;
    default:
      throw new Error(`Unexpected invoke command: ${command}`);
  }
};

const flushEffects = async (cycles = 5) => {
  for (let index = 0; index < cycles; index += 1) {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
};

const buttonByText = (scope: ParentNode, label: string): HTMLButtonElement => {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Could not find button: ${label}`);
  return button;
};

const openAdvancedDrawer = async (container: HTMLElement) => {
  const trigger = container.querySelector<HTMLButtonElement>(
    "main .hero-actions button.btn.ghost",
  );
  if (!trigger) throw new Error("Advanced controls trigger did not render");
  await act(async () => {
    trigger.focus();
    trigger.click();
  });
  await flushEffects(1);
  const drawer = container.querySelector<HTMLElement>(".advanced-drawer");
  if (!drawer) throw new Error("Advanced drawer did not render");
  return { drawer, trigger };
};

describe("Story 14 desktop UI evidence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation(baseInvoke);
    openUrlMock.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1100,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      window.setTimeout(() => callback(0), 0);
      return 1;
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("recovers from clipboard denial without falsely marking a copy complete", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    const { drawer } = await openAdvancedDrawer(container);
    const baseUrlRow = [
      ...drawer.querySelectorAll<HTMLElement>(".connection-row"),
    ].find((row) => row.querySelector(".label")?.textContent === "Base URL");
    if (!baseUrlRow) throw new Error("Base URL row did not render");
    const copyButton = buttonByText(baseUrlRow, "Copy");

    await act(async () => {
      copyButton.click();
    });
    await flushEffects(1);

    expect(drawer.querySelector('[role="alert"]')?.textContent).toContain(
      "The clipboard is unavailable",
    );
    expect(copyButton.textContent).toBe("Copy");

    await act(async () => {
      copyButton.click();
    });
    await flushEffects(1);

    expect(writeText).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8484");
    expect(writeText).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8484");
    expect(drawer.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a failed Doctor run and recovers with categorized guidance", async () => {
    let doctorCalls = 0;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "gateway_doctor") {
        doctorCalls += 1;
        if (doctorCalls === 1) {
          throw new Error("Doctor command unavailable");
        }
        return {
          checks: [
            {
              code: "port_availability",
              status: "error",
              port: 8484,
              gateway_status: "foreign",
            },
            {
              code: "gateway_health",
              status: "error",
              details: "HTTP 503",
              gateway_status: "running",
            },
          ],
        };
      }
      return baseInvoke(command);
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    const { drawer } = await openAdvancedDrawer(container);

    const alert = drawer.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Doctor could not complete: Doctor command unavailable",
    );

    await act(async () => {
      buttonByText(alert!, "Retry doctor").click();
    });
    await flushEffects(2);

    expect(drawer.querySelector('[role="alert"]')).toBeNull();
    expect(drawer.textContent).toContain("Port availability");
    expect(drawer.textContent).toContain(
      "Port 8484 is already in use by another process.",
    );
    expect(drawer.textContent).toContain("Gateway health");
    expect(drawer.textContent).toContain(
      "Open the gateway logs to inspect startup errors.",
    );
    expect(doctorCalls).toBe(2);
  });

  it("times out only desktop polling, rechecks the same failed job, then permits retry", async () => {
    let loadAttempts = 0;
    let modelsLoaded = false;
    let returnFailedStatus = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "gateway_runtime_state") {
        return {
          platform_id: "darwin-arm64",
          defaults: initialConfig.default_models,
          loaded_models: modelsLoaded ? ["llm-a", "stt-a"] : [],
        };
      }
      if (command === "gateway_load_models") {
        loadAttempts += 1;
        if (loadAttempts === 1) {
          return {
            job_id: "job-1",
            status: modelJob("pending", ["pending", "pending"]),
          };
        }
        modelsLoaded = true;
        return {
          job_id: "job-2",
          status: {
            ...modelJob("completed", ["loaded", "loaded"]),
            id: "job-2",
          },
        };
      }
      if (command === "gateway_model_load_status") {
        return returnFailedStatus
          ? modelJob("failed", ["error", "skipped"])
          : modelJob("pending", ["pending", "pending"]);
      }
      return baseInvoke(command);
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    const main = container.querySelector<HTMLElement>("main");
    if (!main) throw new Error("Main desktop surface did not render");
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    vi.setSystemTime(0);

    await act(async () => {
      buttonByText(main, "Download and load selected models").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(buttonByText(main, "Preparing models…").disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000 - 1_000);
    });

    expect(main.textContent).toContain(
      "The desktop app stopped waiting after 15 minutes",
    );
    expect(main.textContent).toContain("Load continues in the gateway");

    returnFailedStatus = true;
    await act(async () => {
      buttonByText(main, "Check current load status").click();
      await vi.runAllTimersAsync();
    });

    expect(main.textContent).toContain("Language model checksum failed.");
    expect(main.textContent).toContain("Needs attention");

    await act(async () => {
      buttonByText(main, "Download and load selected models").click();
      await vi.runAllTimersAsync();
    });

    expect(loadAttempts).toBe(2);
    expect(main.textContent).toContain("Ready");
    expect(main.textContent).not.toContain("Language model checksum failed.");
    vi.useRealTimers();
  });

  it("ignores a model status response that resolves after the gateway is stopped", async () => {
    const statusResponse = createDeferred<ReturnType<typeof modelJob>>();
    let gatewayStatus = "running";
    let statusRequested = false;
    let runtimeCalls = 0;
    let modelsLoaded = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "gateway_status") {
        return { status: gatewayStatus };
      }
      if (command === "gateway_runtime_state") {
        runtimeCalls += 1;
        return {
          platform_id: "darwin-arm64",
          defaults: initialConfig.default_models,
          loaded_models: modelsLoaded ? ["llm-a", "stt-a"] : [],
        };
      }
      if (command === "gateway_load_models") {
        return {
          job_id: "late-status-job",
          status: {
            ...modelJob("pending", ["pending", "pending"]),
            id: "late-status-job",
          },
        };
      }
      if (command === "gateway_model_load_status") {
        statusRequested = true;
        return statusResponse.promise;
      }
      if (command === "stop_gateway") {
        gatewayStatus = "stopped";
        return undefined;
      }
      return baseInvoke(command);
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    const main = container.querySelector<HTMLElement>("main");
    if (!main) throw new Error("Main desktop surface did not render");
    const { drawer } = await openAdvancedDrawer(container);
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });

    await act(async () => {
      buttonByText(main, "Download and load selected models").click();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(statusRequested).toBe(true);

    await act(async () => {
      buttonByText(drawer, "Stop gateway").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const runtimeCallsBeforeLateStatus = runtimeCalls;
    modelsLoaded = true;
    await act(async () => {
      statusResponse.resolve({
        ...modelJob("completed", ["loaded", "loaded"]),
        id: "late-status-job",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runtimeCalls).toBe(runtimeCallsBeforeLateStatus);
    expect(
      buttonByText(main, "Download and load selected models").disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain(
      "Selected models are downloaded and loaded.",
    );
    vi.useRealTimers();
  });

  it("does not apply a runtime refresh that resolves after model-load invalidation", async () => {
    const runtimeResponse = createDeferred<{
      platform_id: string;
      defaults: typeof initialConfig.default_models;
      loaded_models: string[];
    }>();
    let gatewayStatus = "running";
    let runtimeCalls = 0;
    let deferredRuntimeRequested = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "gateway_status") {
        return { status: gatewayStatus };
      }
      if (command === "gateway_runtime_state") {
        runtimeCalls += 1;
        if (runtimeCalls === 1) {
          return {
            platform_id: "darwin-arm64",
            defaults: initialConfig.default_models,
            loaded_models: [],
          };
        }
        deferredRuntimeRequested = true;
        return runtimeResponse.promise;
      }
      if (command === "gateway_load_models") {
        return {
          job_id: "late-runtime-job",
          status: {
            ...modelJob("pending", ["pending", "pending"]),
            id: "late-runtime-job",
          },
        };
      }
      if (command === "gateway_model_load_status") {
        return {
          ...modelJob("completed", ["loaded", "loaded"]),
          id: "late-runtime-job",
        };
      }
      if (command === "stop_gateway") {
        gatewayStatus = "stopped";
        return undefined;
      }
      return baseInvoke(command);
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    const main = container.querySelector<HTMLElement>("main");
    if (!main) throw new Error("Main desktop surface did not render");
    const { drawer } = await openAdvancedDrawer(container);
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });

    await act(async () => {
      buttonByText(main, "Download and load selected models").click();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(deferredRuntimeRequested).toBe(true);

    await act(async () => {
      buttonByText(drawer, "Stop gateway").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      runtimeResponse.resolve({
        platform_id: "darwin-arm64",
        defaults: initialConfig.default_models,
        loaded_models: ["llm-a", "stt-a"],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      buttonByText(main, "Download and load selected models").disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain(
      "Selected models are downloaded and loaded.",
    );
    vi.useRealTimers();
  });

  it("traps keyboard focus in the material dialog and restores the opener on Escape", async () => {
    await act(async () => {
      root.render(<App />);
    });
    await flushEffects();
    const { drawer, trigger } = await openAdvancedDrawer(container);

    expect(document.activeElement).toBe(drawer);
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector("main")?.getAttribute("aria-hidden")).toBe(
      "true",
    );

    const focusable = [
      ...drawer.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((element) => !element.hasAttribute("hidden"));
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    await act(async () => {
      last.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(first);

    await act(async () => {
      first.focus();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(last);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flushEffects(1);

    expect(drawer.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("main")?.getAttribute("aria-hidden")).toBe(
      "false",
    );
    expect(document.activeElement).toBe(trigger);
  });

  it.each([360, 768, 1100])(
    "keeps long French content and material controls semantically available at %i CSS pixels",
    async (viewportWidth) => {
      window.localStorage.setItem("therapy-local-runtime.locale", "fr");
      window.innerWidth = viewportWidth;
      window.dispatchEvent(new Event("resize"));

      await act(async () => {
        root.render(<App />);
      });
      await flushEffects();

      const shell = container.querySelector<HTMLElement>(".app-shell");
      expect(shell?.dataset.locale).toBe("fr");
      expect(shell?.textContent).toContain(
        fr.hero.subtitle.replace("{platform}", "darwin-arm64"),
      );
      const languageSelect = shell?.querySelector<HTMLSelectElement>(
        ".locale-control select",
      );
      expect(languageSelect?.value).toBe("fr");
      expect(languageSelect?.getAttribute("aria-label")).toBe(
        "Langue de l’interface",
      );

      const { drawer } = await openAdvancedDrawer(container);
      expect(drawer.getAttribute("aria-label")).toBe(
        "Commandes avancées de l’exécution locale",
      );
      expect(drawer.textContent).toContain(fr.connection.metadataOnly);
      expect(drawer.querySelectorAll(".storage-paths dd.mono")).toHaveLength(3);
      expect(drawer.querySelector(".pairing-value")).not.toBeNull();

      for (const control of drawer.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >("button, input, select")) {
        const associatedLabel = control.id
          ? [...drawer.querySelectorAll<HTMLLabelElement>("label")].find(
              (label) => label.htmlFor === control.id,
            )
          : null;
        const accessibleName =
          [
            control.getAttribute("aria-label"),
            control.textContent?.trim(),
            control.closest("label")?.textContent?.trim(),
            associatedLabel?.textContent?.trim(),
          ].find(Boolean) ?? "";
        expect(accessibleName, control.outerHTML).not.toBe("");
      }
    },
  );
});
