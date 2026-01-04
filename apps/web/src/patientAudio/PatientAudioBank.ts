import { getBlobUrlForAudio, getCachedResponse, putIfMissing, revokeAllBlobUrls, revokeBlobUrl, toBlobUrl } from "./cache";
import type { PatientAudioLogger } from "./logger";

export type PatientAudioStatus =
  | "idle"
  | "generating"
  | "downloading"
  | "ready"
  | "playing"
  | "blocked"
  | "error";

export type PatientAudioEntry = {
  status: PatientAudioStatus;
  cacheKey?: string;
  audioUrl?: string;
  blobUrl?: string;
  retryAfterMs?: number;
  error?: string;
  inFlight?: Promise<void>;
  lastUpdatedAt?: number;
};

type PrefetchSingleResponse = {
  cache_key: string;
  status: "ready" | "generating";
  audio_url?: string;
  retry_after_ms?: number;
};

type PrefetchBatchResponse = {
  items: Array<{
    statement_id: string;
    cache_key: string;
    status: "ready" | "generating";
    audio_url?: string;
    retry_after_ms?: number;
  }>;
};

type PatientAudioBankOptions = {
  prefetchSingle: (
    input: { exerciseId: string; statementId: string },
    signal?: AbortSignal
  ) => Promise<PrefetchSingleResponse>;
  prefetchBatch: (
    input: { exerciseId: string; statementIds: string[] },
    signal?: AbortSignal
  ) => Promise<PrefetchBatchResponse>;
  logger?: PatientAudioLogger;
  maxAttempts?: number;
};

const DEFAULT_RETRY_MS = 500;
const DEFAULT_MAX_ATTEMPTS = 10;

const makeKey = (exerciseId: string, statementId: string) => `${exerciseId}:${statementId}`;

export class PatientAudioBank {
  private entries = new Map<string, PatientAudioEntry>();
  private listeners = new Set<() => void>();
  private prefetchSingle: PatientAudioBankOptions["prefetchSingle"];
  private prefetchBatch: PatientAudioBankOptions["prefetchBatch"];
  private logger?: PatientAudioLogger;
  private maxAttempts: number;

  constructor(options: PatientAudioBankOptions) {
    this.prefetchSingle = options.prefetchSingle;
    this.prefetchBatch = options.prefetchBatch;
    this.logger = options.logger;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getEntry(exerciseId: string, statementId: string) {
    return this.entries.get(makeKey(exerciseId, statementId));
  }

  getEntries() {
    return Array.from(this.entries.values());
  }

  updateEntry(exerciseId: string, statementId: string, update: Partial<PatientAudioEntry>) {
    const key = makeKey(exerciseId, statementId);
    const existing = this.entries.get(key) ?? { status: "idle" };
    const next: PatientAudioEntry = {
      ...existing,
      ...update,
      inFlight: "inFlight" in update ? update.inFlight : existing.inFlight,
      lastUpdatedAt: Date.now()
    };
    if (existing.status === "generating" && next.status === "downloading") {
      this.log("status.downloading", { exerciseId, statementId });
    }
    this.entries.set(key, next);
    this.emit();
  }

  setStatus(
    exerciseId: string,
    statementId: string,
    status: PatientAudioStatus,
    update?: Pick<PatientAudioEntry, "error">
  ) {
    this.updateEntry(exerciseId, statementId, { status, ...update });
  }

  async ensureReady(exerciseId: string, statementId: string, signal?: AbortSignal) {
    const key = makeKey(exerciseId, statementId);
    const existing = this.entries.get(key);
    if (existing?.status === "ready" && existing.blobUrl) return;
    if (existing?.inFlight) {
      await existing.inFlight;
      return;
    }

    const task = this.runEnsureReady(exerciseId, statementId, signal);
    this.updateEntry(exerciseId, statementId, { inFlight: task });
    try {
      await task;
    } finally {
      const entry = this.getEntry(exerciseId, statementId);
      if (entry?.inFlight === task) {
        this.updateEntry(exerciseId, statementId, { inFlight: undefined });
      }
    }
  }

  async warmupBatch(exerciseId: string, statementIds: string[], signal?: AbortSignal) {
    const candidates = statementIds.filter((statementId) => {
      const entry = this.getEntry(exerciseId, statementId);
      return !(entry?.status === "ready" && entry.blobUrl) && !entry?.inFlight;
    });

    if (candidates.length === 0) return;
    this.log("warmup.start", { exerciseId, count: candidates.length });
    let remaining = new Set(candidates);
    let attempts = 0;

    while (!signal?.aborted && remaining.size > 0 && attempts < this.maxAttempts) {
      attempts += 1;
      const response = await this.prefetchBatch(
        { exerciseId, statementIds: Array.from(remaining) },
        signal
      );
      if (signal?.aborted) return;

      const nextRemaining = new Set<string>();
      const downloadTasks: Promise<void>[] = [];

      response.items.forEach((item) => {
        const statementId = item.statement_id;
        if (item.status === "ready" && item.audio_url) {
          const entry = this.getEntry(exerciseId, statementId);
          if (entry?.blobUrl || entry?.inFlight) return;
          const downloadTask = this.runDownload(
            exerciseId,
            statementId,
            item.audio_url,
            item.cache_key,
            signal
          );
          this.updateEntry(exerciseId, statementId, { inFlight: downloadTask });
          downloadTasks.push(downloadTask);
        } else {
          this.updateEntry(exerciseId, statementId, {
            status: "generating",
            cacheKey: item.cache_key,
            retryAfterMs: item.retry_after_ms,
            error: undefined
          });
          nextRemaining.add(statementId);
        }
      });

      if (downloadTasks.length > 0) {
        await Promise.all(downloadTasks);
      }

      remaining = nextRemaining;
      if (remaining.size === 0) break;
      const retryAfter = Math.min(
        ...response.items
          .filter((item) => item.status !== "ready")
          .map((item) => item.retry_after_ms ?? DEFAULT_RETRY_MS)
      );
      await this.waitWithAbort(retryAfter, signal);
    }

    if (!signal?.aborted && remaining.size > 0) {
      remaining.forEach((statementId) => {
        this.updateEntry(exerciseId, statementId, {
          status: "error",
          error: "Patient audio took too long to generate."
        });
      });
    }

    if (!signal?.aborted) {
      this.log("warmup.end", { exerciseId });
    }
  }

  revoke(exerciseId: string, statementId: string) {
    const entry = this.getEntry(exerciseId, statementId);
    if (entry?.audioUrl) {
      revokeBlobUrl(entry.audioUrl);
    }
    this.entries.delete(makeKey(exerciseId, statementId));
    this.emit();
  }

  revokeAll() {
    revokeAllBlobUrls();
    this.entries.clear();
    this.emit();
  }

  private async runEnsureReady(exerciseId: string, statementId: string, signal?: AbortSignal) {
    this.updateEntry(exerciseId, statementId, { status: "generating", error: undefined });
    let attempts = 0;

    while (!signal?.aborted && attempts < this.maxAttempts) {
      attempts += 1;
      try {
        const result = await this.prefetchSingle({ exerciseId, statementId }, signal);
        if (signal?.aborted) return;

        this.updateEntry(exerciseId, statementId, {
          cacheKey: result.cache_key,
          status: result.status,
          audioUrl: result.audio_url,
          retryAfterMs: result.retry_after_ms,
          error: undefined
        });

        if (result.status === "ready" && result.audio_url) {
          await this.runDownload(exerciseId, statementId, result.audio_url, result.cache_key, signal);
          return;
        }

        await this.waitWithAbort(result.retry_after_ms ?? DEFAULT_RETRY_MS, signal);
      } catch (error) {
        if (signal?.aborted) return;
        this.updateEntry(exerciseId, statementId, {
          status: "error",
          error: "Unable to prepare patient audio."
        });
        return;
      }
    }

    if (!signal?.aborted) {
      this.updateEntry(exerciseId, statementId, {
        status: "error",
        error: "Patient audio took too long to generate."
      });
    }
  }

  private async runDownload(
    exerciseId: string,
    statementId: string,
    audioUrl: string,
    cacheKey: string,
    signal?: AbortSignal
  ) {
    try {
      if (signal?.aborted) return;
      const cachedBlobUrl = getBlobUrlForAudio(audioUrl);
      if (cachedBlobUrl) {
        this.updateEntry(exerciseId, statementId, {
          status: "ready",
          cacheKey,
          audioUrl,
          blobUrl: cachedBlobUrl,
          error: undefined
        });
        return;
      }

      this.updateEntry(exerciseId, statementId, {
        status: "downloading",
        cacheKey,
        audioUrl,
        error: undefined
      });

      const cachedResponse = await getCachedResponse(audioUrl, signal);
      if (signal?.aborted) return;

      let response = cachedResponse;
      if (cachedResponse) {
        this.log("cache.hit", { audioUrl });
      } else {
        this.log("cache.miss", { audioUrl });
        response = await fetch(audioUrl, { signal });
        if (!response.ok) {
          throw new Error("Failed to fetch patient audio.");
        }
        await putIfMissing(audioUrl, response.clone());
      }

      const blobUrl = await toBlobUrl(audioUrl, response);
      this.updateEntry(exerciseId, statementId, {
        status: "ready",
        cacheKey,
        audioUrl,
        blobUrl,
        error: undefined
      });
    } catch (error) {
      if (signal?.aborted) return;
      this.updateEntry(exerciseId, statementId, {
        status: "error",
        error: "Unable to cache patient audio."
      });
    } finally {
      const entry = this.getEntry(exerciseId, statementId);
      if (entry?.inFlight) {
        this.updateEntry(exerciseId, statementId, { inFlight: undefined });
      }
    }
  }

  private async waitWithAbort(ms: number, signal?: AbortSignal) {
    if (!signal) {
      await new Promise((resolve) => window.setTimeout(resolve, ms));
      return;
    }
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private log(event: string, payload?: Record<string, unknown>) {
    this.logger?.(event, payload);
  }
}
