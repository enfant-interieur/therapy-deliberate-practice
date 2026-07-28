const DRAFT_PREFIX = "practiceTypedDraft:";
const DRAFT_VERSION = 1;
export const PRACTICE_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

type PersistedPracticeDraft = {
  version: typeof DRAFT_VERSION;
  value: string;
  expiresAt: number;
};

export const practiceDraftKey = (
  userId: string,
  sessionId: string,
  itemId: string,
) =>
  `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}:${encodeURIComponent(itemId)}`;

const parseDraft = (raw: string | null, now: number) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPracticeDraft>;
    if (
      parsed.version !== DRAFT_VERSION ||
      typeof parsed.value !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now
    ) {
      return null;
    }
    return parsed as PersistedPracticeDraft;
  } catch {
    return null;
  }
};

export const loadPracticeDraft = (
  storage: Storage,
  userId: string,
  sessionId: string,
  itemId: string,
  now = Date.now(),
) => {
  const key = practiceDraftKey(userId, sessionId, itemId);
  const draft = parseDraft(storage.getItem(key), now);
  if (!draft) {
    storage.removeItem(key);
    return null;
  }
  return draft.value;
};

export const savePracticeDraft = (
  storage: Storage,
  userId: string,
  sessionId: string,
  itemId: string,
  value: string,
  now = Date.now(),
) => {
  const key = practiceDraftKey(userId, sessionId, itemId);
  if (value) {
    const draft: PersistedPracticeDraft = {
      version: DRAFT_VERSION,
      value,
      expiresAt: now + PRACTICE_DRAFT_TTL_MS,
    };
    storage.setItem(key, JSON.stringify(draft));
  } else {
    storage.removeItem(key);
  }
};

export const clearPracticeDraft = (
  storage: Storage,
  userId: string,
  sessionId: string,
  itemId: string,
) => {
  if (!userId || !sessionId || !itemId) return;
  storage.removeItem(practiceDraftKey(userId, sessionId, itemId));
};

export const clearPracticeSessionDrafts = (
  storage: Storage,
  userId: string,
  sessionId: string,
) => {
  const prefix = `${DRAFT_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(sessionId)}:`;
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => Boolean(key?.startsWith(prefix)));
  keys.forEach((key) => storage.removeItem(key));
};

export const purgeExpiredPracticeDrafts = (
  storage: Storage,
  now = Date.now(),
) => {
  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  ).filter((key): key is string => Boolean(key?.startsWith(DRAFT_PREFIX)));
  keys.forEach((key) => {
    if (!parseDraft(storage.getItem(key), now)) {
      storage.removeItem(key);
    }
  });
};
