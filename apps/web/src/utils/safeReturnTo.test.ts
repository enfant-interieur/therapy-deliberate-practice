import { describe, expect, it } from "vitest";
import { safeInternalReturnTo } from "./safeReturnTo";

const origin = "https://therapy.example";

describe("safeInternalReturnTo", () => {
  it("preserves a safe routed destination with query and hash", () => {
    expect(
      safeInternalReturnTo("/practice/task-1?session=s-1#review", origin),
    ).toBe("/practice/task-1?session=s-1#review");
  });

  it.each([
    ["absolute URL", "https://attacker.example/path"],
    ["protocol-relative URL", "//attacker.example/path"],
    ["backslash path", "/\\attacker.example/path"],
    ["non-path", "settings"],
  ])("rejects %s", (_name, value) => {
    expect(safeInternalReturnTo(value, origin)).toBeNull();
  });

  it("does not return to the login page", () => {
    expect(safeInternalReturnTo("/login?returnTo=/settings", origin)).toBe("/");
    expect(safeInternalReturnTo("/login#callback", origin)).toBe("/");
    expect(safeInternalReturnTo("/login/?returnTo=/history", origin)).toBe("/");
  });
});
