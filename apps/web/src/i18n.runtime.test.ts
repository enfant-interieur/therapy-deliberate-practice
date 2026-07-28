// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storedValues = new Map<string, string>();
const localStorageStub: Storage = {
  get length() {
    return storedValues.size;
  },
  clear: () => storedValues.clear(),
  getItem: (key) => storedValues.get(key) ?? null,
  key: (index) => [...storedValues.keys()][index] ?? null,
  removeItem: (key) => {
    storedValues.delete(key);
  },
  setItem: (key, value) => {
    storedValues.set(key, String(value));
  },
};

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageStub,
  });
  localStorageStub.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe("i18n document language", () => {
  it("sets the initial html language and restores it after a module reload", async () => {
    window.localStorage.setItem("i18nextLng", "fr");
    document.documentElement.lang = "";

    const first = await import("./i18n");
    await first.default.changeLanguage("fr");
    expect(document.documentElement.lang).toBe("fr");

    document.documentElement.lang = "";
    vi.resetModules();
    await import("./i18n");

    expect(document.documentElement.lang).toBe("fr");
  });
});
