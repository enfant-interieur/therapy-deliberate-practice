import { describe, expect, it } from "vitest";
import {
  clearPracticeDraft,
  clearPracticeSessionDrafts,
  loadPracticeDraft,
  PRACTICE_DRAFT_TTL_MS,
  practiceDraftKey,
  purgeExpiredPracticeDrafts,
  savePracticeDraft,
} from "./practiceDraftStorage";

const createStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

describe("practice draft storage", () => {
  it("restores a typed draft after a page reload without crossing user, session, or item scope", () => {
    const storage = createStorage();
    savePracticeDraft(storage, "user-a", "session-a", "item-a", "Draft", 100);

    expect(
      loadPracticeDraft(storage, "user-a", "session-a", "item-a", 101),
    ).toBe("Draft");
    expect(
      loadPracticeDraft(storage, "user-b", "session-a", "item-a", 101),
    ).toBeNull();
    expect(
      loadPracticeDraft(storage, "user-a", "session-b", "item-a", 101),
    ).toBeNull();
    expect(
      loadPracticeDraft(storage, "user-a", "session-a", "item-b", 101),
    ).toBeNull();
  });

  it("clears the item-scoped draft after successful completion", () => {
    const storage = createStorage();
    savePracticeDraft(storage, "user-a", "session-a", "item-a", "Draft", 100);

    clearPracticeDraft(storage, "user-a", "session-a", "item-a");

    expect(
      loadPracticeDraft(storage, "user-a", "session-a", "item-a", 101),
    ).toBeNull();
  });

  it("clears every draft for the selected session while preserving other sessions and users", () => {
    const storage = createStorage();
    savePracticeDraft(storage, "user-a", "session-a", "item-a", "A", 100);
    savePracticeDraft(storage, "user-a", "session-a", "item-b", "B", 100);
    savePracticeDraft(storage, "user-a", "session-b", "item-a", "C", 100);
    savePracticeDraft(storage, "user-b", "session-a", "item-a", "D", 100);

    clearPracticeSessionDrafts(storage, "user-a", "session-a");

    expect(
      loadPracticeDraft(storage, "user-a", "session-a", "item-a", 101),
    ).toBeNull();
    expect(
      loadPracticeDraft(storage, "user-a", "session-a", "item-b", 101),
    ).toBeNull();
    expect(
      loadPracticeDraft(storage, "user-a", "session-b", "item-a", 101),
    ).toBe("C");
    expect(
      loadPracticeDraft(storage, "user-b", "session-a", "item-a", 101),
    ).toBe("D");
  });

  it("removes expired and malformed drafts during bounded cleanup", () => {
    const storage = createStorage();
    savePracticeDraft(storage, "user-a", "session-a", "item-a", "Draft", 100);
    storage.setItem(
      practiceDraftKey("user-a", "session-a", "malformed"),
      "not-json",
    );

    purgeExpiredPracticeDrafts(storage, 100 + PRACTICE_DRAFT_TTL_MS + 1);

    expect(storage.length).toBe(0);
  });
});
