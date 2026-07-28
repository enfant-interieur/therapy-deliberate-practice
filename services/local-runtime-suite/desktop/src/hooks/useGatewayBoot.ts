import { useCallback, useEffect, useReducer, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { translate, type Translator } from "../i18n";

const englishTranslator: Translator = (key, values) => translate("en", key, values);

export type GatewayBootPhase = "idle" | "booting" | "polling" | "ready" | "error" | "cancelled";

export type GatewayBootState = {
  phase: GatewayBootPhase;
  runId: number;
  startedAtMs?: number;
  attempts: number;
  lastHttpStatus?: number;
  lastReadiness?: string;
  error?: string;
};

export function gatewayBootActivityMessage(
  boot: GatewayBootState,
  t: Translator = (key, values) => translate("en", key, values)
) {
  if (boot.phase === "ready") return t("launch.readyMessage");
  if (boot.phase === "error") return t("launch.failedMessage");
  if (boot.phase === "cancelled") return t("launch.stoppedMessage");
  if (boot.phase === "idle") return t("launch.idleMessage");
  if (boot.phase === "booting") return t("launch.bootingMessage");
  if (boot.attempts === 0) return t("launch.firstHealth");
  if (boot.lastReadiness) {
    return t("launch.readiness", { status: boot.lastReadiness });
  }
  if (boot.lastHttpStatus) {
    return t("launch.http", { status: boot.lastHttpStatus });
  }
  return t("launch.noHealthyResponse");
}

type BootAction =
  | { type: "REQUEST_START"; runId: number; startedAtMs: number }
  | { type: "SPAWN_OK" }
  | { type: "HEALTH_ATTEMPT"; httpStatus?: number; readiness?: string }
  | { type: "READY" }
  | { type: "FAIL"; error: string }
  | { type: "CANCELLED" }
  | { type: "RESET" };

const initialState: GatewayBootState = {
  phase: "idle",
  runId: 0,
  attempts: 0
};

function reducer(state: GatewayBootState, action: BootAction): GatewayBootState {
  switch (action.type) {
    case "REQUEST_START":
      return {
        phase: "booting",
        runId: action.runId,
        startedAtMs: action.startedAtMs,
        attempts: 0,
        lastHttpStatus: undefined,
        lastReadiness: undefined,
        error: undefined
      };
    case "SPAWN_OK":
      return state.phase === "booting" ? { ...state, phase: "polling" } : state;
    case "HEALTH_ATTEMPT":
      return {
        ...state,
        attempts: state.attempts + 1,
        lastHttpStatus: action.httpStatus ?? state.lastHttpStatus,
        lastReadiness: action.readiness ?? state.lastReadiness
      };
    case "READY":
      return { ...state, phase: "ready", error: undefined };
    case "FAIL":
      return { ...state, phase: "error", error: action.error };
    case "CANCELLED":
      return { ...state, phase: "cancelled" };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const id = window.setTimeout(() => {
      window.clearTimeout(id);
      resolve();
    }, ms);
  });
}

function formatErrorMessage(error: unknown, t: Translator) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return t("common.requestTimedOut");
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return t("common.unknownError");
  }
}

export function isReadyGatewayHealth(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Record<string, unknown>;
  return (
    candidate.service === "therapy-local-runtime" &&
    candidate.protocol_version === "1" &&
    candidate.status === "ready"
  );
}

async function checkHealthOnce(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; httpStatus?: number; readiness?: string }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    let readiness: string | undefined;
    let identityMatches = false;
    try {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = (await res.json()) as Record<string, unknown>;
        identityMatches = isReadyGatewayHealth(payload);
        if (payload && typeof payload.status === "string") {
          readiness = payload.status;
        }
      }
    } catch {
      // Ignore JSON parse failures; the HTTP status still informs readiness.
    }

    const ok = res.status === 200 && identityMatches;
    return { ok, httpStatus: res.status, readiness };
  } finally {
    window.clearTimeout(timer);
  }
}

export type UseGatewayBootOptions = {
  healthUrl: string;
  t?: Translator;
  maxWaitMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  onReady?: () => void | Promise<void>;
};

export function useGatewayBoot(options: UseGatewayBootOptions) {
  const { healthUrl } = options;
  const t = options.t ?? englishTranslator;
  const maxWaitMs = options.maxWaitMs ?? 10 * 60 * 1000;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1500;

  const [state, dispatch] = useReducer(reducer, initialState);
  const runIdRef = useRef(0);
  const cancelRef = useRef(false);
  const onReadyRef = useRef(options.onReady);

  useEffect(() => {
    onReadyRef.current = options.onReady;
  }, [options.onReady]);

  const start = useCallback(async () => {
    cancelRef.current = false;
    const runId = ++runIdRef.current;
    dispatch({ type: "REQUEST_START", runId, startedAtMs: Date.now() });

    try {
      await invoke("start_gateway");
      dispatch({ type: "SPAWN_OK" });
    } catch (error) {
      dispatch({
        type: "FAIL",
        error: t("errors.launchStartFailed", {
          details: formatErrorMessage(error, t)
        })
      });
    }
  }, [t]);

  const cancel = useCallback(async () => {
    cancelRef.current = true;
    runIdRef.current += 1;
    try {
      await invoke("stop_gateway");
      dispatch({ type: "CANCELLED" });
    } catch (error) {
      dispatch({
        type: "FAIL",
        error: t("errors.launchStopFailed", {
          details: formatErrorMessage(error, t)
        })
      });
    }
  }, [t]);

  const reset = useCallback(() => {
    cancelRef.current = false;
    dispatch({ type: "RESET" });
  }, []);

  useEffect(() => {
    if (state.phase !== "polling") return;

    const activeRunId = state.runId;
    const deadline = (state.startedAtMs ?? Date.now()) + maxWaitMs;
    let mounted = true;

    (async () => {
      while (mounted && !cancelRef.current && runIdRef.current === activeRunId) {
        if (Date.now() > deadline) {
          dispatch({
            type: "FAIL",
            error: t("errors.launchHealthTimeout")
          });
          return;
        }

        try {
          const result = await checkHealthOnce(healthUrl, requestTimeoutMs);
          dispatch({
            type: "HEALTH_ATTEMPT",
            httpStatus: result.httpStatus,
            readiness: result.readiness
          });

          if (result.ok) {
            dispatch({ type: "READY" });
            try {
              await onReadyRef.current?.();
            } catch {
              // Follow-up refreshes can fail silently; UI remains ready.
            }
            return;
          }
        } catch {
          dispatch({ type: "HEALTH_ATTEMPT" });
        }

        await sleep(pollIntervalMs);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [
    state.phase,
    state.runId,
    state.startedAtMs,
    healthUrl,
    maxWaitMs,
    pollIntervalMs,
    requestTimeoutMs,
    t
  ]);

  return { state, start, cancel, reset };
}
