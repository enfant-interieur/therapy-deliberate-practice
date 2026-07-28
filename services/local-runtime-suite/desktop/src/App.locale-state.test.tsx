// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn()
}));

const model = (id: string, endpoint: string) => ({
  id,
  metadata: {
    display: { title: id },
    api: { endpoint },
    compat: { platforms: ["darwin-arm64"] }
  }
});

const initialConfig = {
  port: 8484,
  default_models: {
    responses: "llm-a",
    "audio.transcriptions": "stt-a"
  },
  prefer_local: true
};

const flushEffects = async () => {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("desktop locale state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
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
              stt_example:
                "http://127.0.0.1:8484/v1/audio/transcriptions"
            }
          };
        case "gateway_storage_paths":
          return {
            config_file: "/tmp/config.json",
            data_dir: "/tmp/data",
            cache_dir: "/tmp/cache",
            logging_policy: "metadata_only"
          };
        case "gateway_config":
          return structuredClone(initialConfig);
        case "gateway_pairing_token":
          return { token: "test-token", masked: "test…oken" };
        case "gateway_doctor":
          return { checks: [] };
        case "gateway_models":
          return {
            data: [
              model("llm-a", "responses"),
              model("llm-b", "responses"),
              model("stt-a", "audio.transcriptions"),
              model("stt-b", "audio.transcriptions")
            ]
          };
        case "gateway_runtime_state":
          return {
            platform_id: "darwin-arm64",
            defaults: initialConfig.default_models,
            loaded_models: ["llm-a", "llm-b", "stt-a", "stt-b"]
          };
        default:
          throw new Error(`Unexpected invoke command: ${command}`);
      }
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("preserves unsaved model, routing, and port choices across both locale transitions", async () => {
    await act(async () => {
      root.render(<App />);
    });
    for (let index = 0; index < 5; index += 1) {
      await flushEffects();
    }

    const drawer = container.querySelector<HTMLElement>(".advanced-drawer");
    const modelSelects =
      drawer?.querySelectorAll<HTMLSelectElement>("select.select");
    const preferLocal =
      drawer?.querySelector<HTMLInputElement>("#prefer-local");
    const portInput =
      drawer?.querySelector<HTMLInputElement>(".port-input");
    const localeSelect =
      container.querySelector<HTMLSelectElement>(".locale-control select");

    expect(modelSelects).toHaveLength(2);
    expect(preferLocal?.disabled).toBe(false);
    expect(portInput?.value).toBe("8484");
    expect(localeSelect?.value).toBe("en");

    await act(async () => {
      modelSelects![0]!.value = "llm-b";
      modelSelects![0]!.dispatchEvent(new Event("change", { bubbles: true }));
      modelSelects![1]!.value = "stt-b";
      modelSelects![1]!.dispatchEvent(new Event("change", { bubbles: true }));
      preferLocal!.click();
      setInputValue(portInput!, "9001");
      localeSelect!.value = "fr";
      localeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushEffects();

    expect(modelSelects![0]!.value).toBe("llm-b");
    expect(modelSelects![1]!.value).toBe("stt-b");
    expect(preferLocal!.checked).toBe(false);
    expect(portInput!.value).toBe("9001");
    expect(localeSelect!.value).toBe("fr");

    await act(async () => {
      localeSelect!.value = "en";
      localeSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushEffects();

    expect(modelSelects![0]!.value).toBe("llm-b");
    expect(modelSelects![1]!.value).toBe("stt-b");
    expect(preferLocal!.checked).toBe(false);
    expect(portInput!.value).toBe("9001");
    expect(localeSelect!.value).toBe("en");
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "gateway_config")
    ).toHaveLength(1);
  });
});
