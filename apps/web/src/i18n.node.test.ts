// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

describe("i18n outside a browser", () => {
  it("initializes without accessing document", async () => {
    vi.resetModules();
    const module = await import("./i18n");

    expect(module.default.isInitialized).toBe(true);
  });
});
