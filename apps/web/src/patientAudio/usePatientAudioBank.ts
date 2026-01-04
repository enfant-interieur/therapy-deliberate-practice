import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePrefetchPatientAudioBatchMutation,
  usePrefetchPatientAudioMutation
} from "../store/api";
import { PatientAudioBank, type PatientAudioEntry } from "./PatientAudioBank";
import { createPatientAudioLogger } from "./logger";

export type WarmupTargets =
  | Array<{ exerciseId: string; statementId: string }>
  | Record<string, string[]>;

type WarmupOptions = {
  signal?: AbortSignal;
};

type EnsureOptions = {
  signal?: AbortSignal;
};

type PlayOptions = {
  signal?: AbortSignal;
  onEnded?: () => void;
  shouldPlay?: () => boolean;
};

type UsePatientAudioBankOptions = {
  loggerScope?: string;
  maxAttempts?: number;
};

const normalizeWarmupTargets = (targets: WarmupTargets) => {
  const grouped = new Map<string, Set<string>>();
  if (Array.isArray(targets)) {
    targets.forEach(({ exerciseId, statementId }) => {
      if (!grouped.has(exerciseId)) {
        grouped.set(exerciseId, new Set());
      }
      grouped.get(exerciseId)?.add(statementId);
    });
  } else {
    Object.entries(targets).forEach(([exerciseId, statementIds]) => {
      grouped.set(exerciseId, new Set(statementIds));
    });
  }
  return grouped;
};

export const usePatientAudioBank = (options?: UsePatientAudioBankOptions) => {
  const [prefetchSingleTrigger] = usePrefetchPatientAudioMutation();
  const [prefetchBatchTrigger] = usePrefetchPatientAudioBatchMutation();
  const logger = useMemo(
    () => createPatientAudioLogger(options?.loggerScope ?? "bank"),
    [options?.loggerScope]
  );
  const bankRef = useRef<PatientAudioBank>();

  if (!bankRef.current) {
    bankRef.current = new PatientAudioBank({
      prefetchSingle: async ({ exerciseId, statementId }, signal) => {
        const promise = prefetchSingleTrigger({
          exercise_id: exerciseId,
          practice_mode: "real_time",
          statement_id: statementId
        });
        let onAbort: (() => void) | undefined;
        if (signal) {
          onAbort = () => promise.abort();
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        try {
          return await promise.unwrap();
        } finally {
          if (signal && onAbort) {
            signal.removeEventListener("abort", onAbort);
          }
        }
      },
      prefetchBatch: async ({ exerciseId, statementIds }, signal) => {
        const promise = prefetchBatchTrigger({
          exercise_id: exerciseId,
          practice_mode: "real_time",
          statement_ids: statementIds
        });
        let onAbort: (() => void) | undefined;
        if (signal) {
          onAbort = () => promise.abort();
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }
        try {
          return await promise.unwrap();
        } finally {
          if (signal && onAbort) {
            signal.removeEventListener("abort", onAbort);
          }
        }
      },
      logger,
      maxAttempts: options?.maxAttempts
    });
  }

  const bank = bankRef.current;
  const [version, setVersion] = useState(0);

  useEffect(() => bank.subscribe(() => setVersion((prev) => prev + 1)), [bank]);

  const warmup = useCallback(
    async (targets: WarmupTargets, opts?: WarmupOptions) => {
      const grouped = normalizeWarmupTargets(targets);
      await Promise.all(
        Array.from(grouped.entries()).map(([exerciseId, statementIds]) =>
          bank.warmupBatch(exerciseId, Array.from(statementIds), opts?.signal)
        )
      );
    },
    [bank]
  );

  const ensureReady = useCallback(
    (exerciseId: string, statementId: string, opts?: EnsureOptions) =>
      bank.ensureReady(exerciseId, statementId, opts?.signal),
    [bank]
  );

  const stop = useCallback((audioElement?: HTMLAudioElement | null) => {
    if (!audioElement) return;
    audioElement.pause();
    audioElement.currentTime = 0;
  }, []);

  const play = useCallback(
    async (
      exerciseId: string,
      statementId: string,
      audioElement?: HTMLAudioElement | null,
      opts?: PlayOptions
    ) => {
      if (!audioElement) return;
      if (opts?.signal?.aborted) return;

      await bank.ensureReady(exerciseId, statementId, opts?.signal);
      const entry = bank.getEntry(exerciseId, statementId);
      if (!entry?.blobUrl) return;
      if (opts?.shouldPlay && !opts.shouldPlay()) {
        logger("play.token_mismatch", { exerciseId, statementId });
        return;
      }

      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement.src = entry.blobUrl;
      audioElement.load();
      audioElement.onended = () => {
        bank.updateEntry(exerciseId, statementId, { status: "ready" });
        opts?.onEnded?.();
      };
      audioElement.onerror = () => {
        bank.updateEntry(exerciseId, statementId, {
          status: "error",
          error: "Audio failed to load. Try again."
        });
      };

      try {
        await audioElement.play();
        logger("play.start", { exerciseId, statementId });
        bank.updateEntry(exerciseId, statementId, { status: "playing", error: undefined });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        if (errorName === "NotAllowedError") {
          logger("play.blocked", { exerciseId, statementId });
          bank.updateEntry(exerciseId, statementId, {
            status: "blocked",
            error: "Autoplay was blocked. Tap play to begin."
          });
        } else {
          bank.updateEntry(exerciseId, statementId, {
            status: "error",
            error: "Audio failed to play."
          });
        }
      }
    },
    [bank, logger]
  );

  const getEntry = useCallback(
    (exerciseId: string, statementId: string) => bank.getEntry(exerciseId, statementId),
    [bank]
  );

  const progress = useMemo(() => {
    const entries = bank.getEntries();
    const ready = entries.filter((entry) => entry.status === "ready").length;
    return { ready, total: entries.length };
  }, [bank, version]);

  return {
    bank,
    warmup,
    ensureReady,
    play,
    stop,
    getEntry,
    progress
  };
};

export type { PatientAudioEntry };
export type PatientAudioBankHandle = ReturnType<typeof usePatientAudioBank>;
