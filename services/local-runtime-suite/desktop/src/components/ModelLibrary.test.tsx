// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ModelLibrary, type ModelInventory } from "./ModelLibrary";
import { translate } from "../i18n";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
const inventory: ModelInventory = {
  platform_id: "darwin-arm64", resources: { memory_bytes: 64 * 1024 ** 3, cache_free_bytes: 50 * 1024 ** 3 },
  models: [{ id: "local//llm/qwen35-2b-mlx", title: "Qwen3.5 2B", kind: "llm", endpoint: "responses", compatible: true, ram_gb: 8, memory_suitable: true, provider: "mlx", license: "apache-2.0", revision: "a".repeat(40), source: "https://huggingface.co/model", languages: ["fr", "en"], loaded: true, loading: false, active_requests: 0, assets: { state: "cached", completed_bytes: 100, total_bytes: 100 } },
    { id: "local//stt/faster-whisper", title: "Whisper base", kind: "stt", endpoint: "audio.transcriptions", compatible: true, ram_gb: 6, memory_suitable: true, provider: "faster_whisper", license: "mit", revision: "b".repeat(40), source: "https://huggingface.co/model", languages: ["fr", "en"], loaded: false, loading: false, active_requests: 0, assets: { state: "cached", completed_bytes: 100, total_bytes: 100 } }]
};

describe("local model workspace", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); invokeMock.mockReset(); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
  it("uses measured inventory for resource, cached and loaded state and unloads only the chosen model", async () => {
    invokeMock.mockImplementation(async (command: string) => command === "gateway_model_inventory" ? inventory : {});
    const choose = vi.fn(); const changed = vi.fn(async () => {});
    await act(async () => { root.render(<ModelLibrary enabled selected={{ llm: "", stt: "" }} onChoose={choose} onChanged={changed} busy={false} t={(key, values) => translate("en", key, values)} />); });
    expect(container.textContent).toContain("In memory");
    expect(container.textContent).toContain("Files ready");
    const profile = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Compact practice"))!;
    await act(async () => profile.click());
    expect(choose).toHaveBeenCalledWith({ llm: "local//llm/qwen35-2b-mlx", stt: "local//stt/faster-whisper" });
    const release = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Release memory")!;
    await act(async () => release.click());
    expect(invokeMock).toHaveBeenCalledWith("gateway_unload_model", { payload: { model: "local//llm/qwen35-2b-mlx" } });
    expect(changed).toHaveBeenCalled();
    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain("Bearer");
  });
  it("supports a speech-only profile on Intel without inventing a language backend", async () => {
    invokeMock.mockResolvedValue({ ...inventory, platform_id: "darwin-x64", models: inventory.models.filter((model) => model.kind === "stt") });
    const choose = vi.fn();
    await act(async () => { root.render(<ModelLibrary enabled selected={{ llm: "", stt: "" }} onChoose={choose} onChanged={async () => {}} busy={false} t={(key, values) => translate("fr", key, values)} />); });
    expect(container.textContent).toContain("Mac Intel");
    await act(async () => container.querySelector<HTMLButtonElement>(".profile-option")!.click());
    expect(choose).toHaveBeenCalledWith({ llm: "", stt: "local//stt/faster-whisper" });
  });
  it("keeps a release conflict visible after a successful inventory poll", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "gateway_unload_model") throw new Error("409 model busy");
      return inventory;
    });
    await act(async () => root.render(<ModelLibrary enabled selected={{ llm: "", stt: "" }} onChoose={() => {}} onChanged={async () => {}} busy={false} t={(key, values) => translate("en", key, values)} />));
    const release = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Release memory")!;
    await act(async () => release.click());
    expect(container.textContent).toContain(translate("en", "library.busyError"));
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(container.textContent).toContain(translate("en", "library.busyError"));
    expect(container.textContent).not.toContain(translate("en", "library.inventoryError"));
  });
  it("ignores inventory that arrives after the gateway disconnects", async () => {
    let resolve!: (value: ModelInventory) => void;
    invokeMock.mockReturnValue(new Promise<ModelInventory>((done) => { resolve = done; }));
    const props = { selected: { llm: "", stt: "" }, onChoose: () => {}, onChanged: async () => {}, busy: false, t: (key: string, values?: Record<string, string | number>) => translate("en", key, values) };
    await act(async () => root.render(<ModelLibrary {...props} enabled />));
    await act(async () => root.render(<ModelLibrary {...props} enabled={false} />));
    await act(async () => resolve(inventory));
    expect(container.querySelectorAll(".resource-pills")).toHaveLength(0);
    expect(container.querySelectorAll(".model-card")).toHaveLength(0);
  });

});
