// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PatientAudioBank } from "./PatientAudioBank";
import { revokeAllBlobUrls } from "./cache";

type PrefetchResult = {
  cache_key: string;
  status: "ready" | "generating";
  audio_url?: string;
  retry_after_ms?: number;
};

type PrefetchBatchResult = {
  items: Array<{
    statement_id: string;
    cache_key: string;
    status: "ready" | "generating";
    audio_url?: string;
    retry_after_ms?: number;
  }>;
};

const createResponse = (body = "audio") =>
  new Response(new Blob([body]), { status: 200 });

const createDeferred = <T,>() => {
  let resolve: (value: T) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
};

const setupCacheStorage = () => {
  const store = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (url: string) => store.get(url)),
    put: vi.fn(async (url: string, response: Response) => {
      store.set(url, response);
    })
  };
  const caches = {
    open: vi.fn(async () => cache)
  } as CacheStorage;
  Object.assign(globalThis, { caches });
  return { store, cache };
};

beforeEach(() => {
  setupCacheStorage();
  globalThis.fetch = vi.fn(async () => createResponse()) as typeof fetch;
  globalThis.URL.createObjectURL = vi.fn(() => "blob:audio") as typeof URL.createObjectURL;
});

afterEach(() => {
  vi.restoreAllMocks();
  revokeAllBlobUrls();
});

describe("PatientAudioBank", () => {
  it("dedupes in-flight work by exerciseId + statementId", async () => {
    const deferred = createDeferred<PrefetchResult>();
    const prefetchSingle = vi.fn(() => deferred.promise);
    const prefetchBatch = vi.fn(async () => ({ items: [] }) as PrefetchBatchResult);
    const bank = new PatientAudioBank({ prefetchSingle, prefetchBatch });

    const first = bank.ensureReady("exercise", "statement");
    const second = bank.ensureReady("exercise", "statement");

    expect(prefetchSingle).toHaveBeenCalledTimes(1);

    deferred.resolve({
      cache_key: "cache-key",
      status: "ready",
      audio_url: "/api/v1/tts/cache-key"
    });

    await Promise.all([first, second]);
  });

  it("uses CacheStorage hits to skip byte downloads and reuse blob URLs", async () => {
    const { store } = setupCacheStorage();
    const audioUrl = "/api/v1/tts/cache-hit";
    store.set(audioUrl, createResponse());

    const prefetchSingle = vi
      .fn()
      .mockResolvedValue({ cache_key: "cache-hit", status: "ready", audio_url: audioUrl });
    const prefetchBatch = vi.fn(async () => ({ items: [] }) as PrefetchBatchResult);
    const bank = new PatientAudioBank({ prefetchSingle, prefetchBatch });

    await bank.ensureReady("exercise", "statement");
    await bank.ensureReady("exercise", "statement-two");

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("respects retry_after_ms and caps attempts", async () => {
    vi.useFakeTimers();
    const prefetchSingle = vi.fn(async () => ({
      cache_key: "cache-wait",
      status: "generating",
      retry_after_ms: 200
    }));
    const prefetchBatch = vi.fn(async () => ({ items: [] }) as PrefetchBatchResult);
    const bank = new PatientAudioBank({ prefetchSingle, prefetchBatch, maxAttempts: 2 });

    const promise = bank.ensureReady("exercise", "statement");

    await vi.runAllTimersAsync();
    await promise;

    const entry = bank.getEntry("exercise", "statement");
    expect(prefetchSingle).toHaveBeenCalledTimes(2);
    expect(entry?.status).toBe("error");

    vi.useRealTimers();
  });

  it("aborts polling and avoids late state updates", async () => {
    vi.useFakeTimers();
    const prefetchSingle = vi.fn(async () => ({
      cache_key: "cache-abort",
      status: "generating",
      retry_after_ms: 200
    }));
    const prefetchBatch = vi.fn(async () => ({ items: [] }) as PrefetchBatchResult);
    const bank = new PatientAudioBank({ prefetchSingle, prefetchBatch });
    const controller = new AbortController();

    const promise = bank.ensureReady("exercise", "statement", controller.signal);
    controller.abort();

    await vi.runAllTimersAsync();
    await promise;

    const entry = bank.getEntry("exercise", "statement");
    expect(prefetchSingle).toHaveBeenCalledTimes(1);
    expect(entry?.status).not.toBe("error");

    vi.useRealTimers();
  });

  it("transitions through generating and downloading statuses", async () => {
    const prefetchSingle = vi.fn(async () => ({
      cache_key: "cache-ready",
      status: "ready",
      audio_url: "/api/v1/tts/cache-ready"
    }));
    const prefetchBatch = vi.fn(async () => ({ items: [] }) as PrefetchBatchResult);
    const bank = new PatientAudioBank({ prefetchSingle, prefetchBatch });
    const statuses: string[] = [];

    bank.subscribe(() => {
      const entry = bank.getEntry("exercise", "statement");
      if (entry?.status) {
        statuses.push(entry.status);
      }
    });

    await bank.ensureReady("exercise", "statement");

    expect(statuses).toContain("generating");
    expect(statuses).toContain("downloading");
    expect(statuses.at(-1)).toBe("ready");
  });
});
