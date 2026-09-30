// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmModelPreparation } from "./modelPreparation";
import { translate } from "../i18n";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
const t = (key: string, values?: Record<string, string | number>) => translate("en", key, values);
const model = (id: string, bytes: number) => ({ id, compatible: true, loaded: false, memory_suitable: true, assets: { state: "missing", total_bytes: bytes, completed_bytes: 0 } });
describe("desktop preparation consent and resource checks", () => {
  beforeEach(() => { invokeMock.mockReset(); vi.restoreAllMocks(); });
  it("asks once for the sum of remaining files and respects refusal", async () => {
    invokeMock.mockResolvedValue({ resources: { cache_free_bytes: 50 * 1024 ** 3 }, models: [model("language", 5_977_068_992), model("speech", 147_882_941)] });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(await confirmModelPreparation(["language", "speech"], t)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("6.12 GB");
  });
  it("blocks an unloaded model below its memory guidance before asking for download", async () => {
    invokeMock.mockResolvedValue({ resources: { cache_free_bytes: 50 * 1024 ** 3 }, models: [{ ...model("language", 5_977_068_992), memory_suitable: false }] });
    const confirm = vi.spyOn(window, "confirm");
    await expect(confirmModelPreparation(["language"], t)).rejects.toThrow(translate("en", "library.memoryWarning"));
    expect(confirm).not.toHaveBeenCalled();
  });
  it("blocks insufficient disk and permits complete cached files without download consent", async () => {
    const entry = model("language", 5_977_068_992);
    invokeMock.mockResolvedValue({ resources: { cache_free_bytes: 100 }, models: [entry] });
    await expect(confirmModelPreparation(["language"], t)).rejects.toThrow(translate("en", "library.diskWarning"));
    invokeMock.mockResolvedValue({ resources: { cache_free_bytes: 100 }, models: [{ ...entry, assets: { ...entry.assets, state: "cached", completed_bytes: entry.assets.total_bytes } }] });
    const confirm = vi.spyOn(window, "confirm");
    expect(await confirmModelPreparation(["language"], t)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
