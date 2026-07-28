import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GatewayLaunchButton } from "./components/GatewayLaunchButton";
import { useGatewayBoot } from "./hooks/useGatewayBoot";
import {
  fetchInferenceWithTimeout,
  gatewayResponseError
} from "./lib/inferenceRequest";
import { useDesktopLocale, type Translator } from "./i18n";
import {
  describeDoctorCheck,
  type DoctorCheck
} from "./i18n/doctor";
import type { GatewayBootState } from "./hooks/useGatewayBoot";

type ModelSummary = {
  id: string;
  metadata: {
    display: { title: string };
    api: { endpoint: string };
    compat?: { platforms?: string[] };
  };
};

type ModelLoadStatus = {
  model_id: string;
  status: "pending" | "loading" | "loaded" | "skipped" | "error";
  started_at: number | null;
  finished_at: number | null;
  duration_ms: number | null;
  error: string | null;
};

type ModelLoadJob = {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  models: ModelLoadStatus[];
};

type ModelLoadView = {
  phase: "idle" | "starting" | "running" | "completed" | "failed" | "timed_out";
  job?: ModelLoadJob;
  error?: string;
};

type GatewayRuntimeState = {
  platform_id: string | null;
  defaults: Record<string, string>;
  loaded_models: string[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

type DoctorRunState = "idle" | "running" | "error";

type QuickTestStatus = "idle" | "running" | "ok" | "error";

type QuickTestResult = {
  status: QuickTestStatus;
  durationMs?: number;
  preview?: string;
  error?: string;
};

type QuickTestsState = {
  status: QuickTestStatus;
  llm: QuickTestResult;
  stt: QuickTestResult;
  startedAt?: string;
  finishedAt?: string;
};

type GatewayConnectionInfo = {
  port: number;
  base_url: string;
  llm_url: string;
  stt_url: string;
  endpoints: {
    health: string;
    llm_example: string;
    stt_example: string;
  };
};

type GatewayStoragePaths = {
  config_file: string;
  data_dir: string;
  cache_dir: string;
  logging_policy: "metadata_only";
};

type GatewayConfig = {
  port: number;
  default_models: Record<string, string>;
  prefer_local: boolean;
};

type PairingToken = {
  token: string;
  masked: string;
};

const initialQuickTestsState: QuickTestsState = {
  status: "idle",
  llm: { status: "idle" },
  stt: { status: "idle" }
};

function makeSilentWavBlob(durationSec = 0.5, sampleRate = 16000): Blob {
  const numSamples = Math.floor(durationSec * sampleRate);
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 1 * bytesPerSample, true); // byteRate
  view.setUint16(32, 1 * bytesPerSample, true); // blockAlign
  view.setUint16(34, 16, true);  // bitsPerSample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  // audio data remains zeros (silence)

  return new Blob([buffer], { type: "audio/wav" });
}

const truncatePreview = (value?: string, max = 120) => {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
};

const describeQuickTestStatus = (status: QuickTestStatus, t: Translator) => {
  switch (status) {
    case "ok":
      return t("common.ok");
    case "running":
      return t("common.running");
    case "error":
      return t("common.error");
    default:
      return t("common.idle");
  }
};

const describeModelLoadPhase = (phase: ModelLoadView["phase"], t: Translator) => {
  switch (phase) {
    case "starting":
      return t("model.phase.starting");
    case "running":
      return t("model.phase.running");
    case "completed":
      return t("model.phase.completed");
    case "failed":
      return t("model.phase.failed");
    case "timed_out":
      return t("model.phase.timedOut");
    default:
      return t("model.phase.idle");
  }
};

const formatModelDuration = (durationMs: number | null) => {
  if (durationMs === null) return "";
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${(durationMs / 1_000).toFixed(1)} s`;
};

const describeGatewayStatus = (status: string, t: Translator) => {
  const knownStatuses = new Set(["stopped", "starting", "running", "foreign"]);
  return t(
    knownStatuses.has(status) ? `gatewayStatus.${status}` : "gatewayStatus.unknown"
  );
};

const describeModelStatus = (status: ModelLoadStatus["status"], t: Translator) =>
  t(`model.status.${status}`);

const formatErrorMessage = (error: unknown, t: Translator) => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return t("common.requestTimedOut");
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch (stringifyError) {
    console.error("Unable to stringify error", stringifyError);
    return t("common.unknownError");
  }
};

export const App = () => {
  const { locale, setLocale, t } = useDesktopLocale();
  const [status, setStatus] = useState("stopped");
  const [models, setModels] = useState<ModelSummary[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>([]);
  const [doctorRunState, setDoctorRunState] = useState<DoctorRunState>("idle");
  const [doctorRunError, setDoctorRunError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState({ llm: "", stt: "" });
  const [preferLocal, setPreferLocal] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [port, setPort] = useState(8484);
  const [portInput, setPortInput] = useState("8484");
  const [portSaveState, setPortSaveState] = useState<SaveState>("idle");
  const [portSaveError, setPortSaveError] = useState<string | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<GatewayConnectionInfo | null>(null);
  const [storagePaths, setStoragePaths] = useState<GatewayStoragePaths | null>(null);
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [simpleSteps, setSimpleSteps] = useState({
    copiedUrl: false,
    copiedKey: false,
    openedSettings: false
  });
  const [pairing, setPairing] = useState<PairingToken | null>(null);
  const [showPairingKey, setShowPairingKey] = useState(false);
  const [pairingKeyState, setPairingKeyState] = useState<SaveState>("idle");
  const [quickTests, setQuickTests] = useState<QuickTestsState>(initialQuickTestsState);
  const [runtimeState, setRuntimeState] = useState<GatewayRuntimeState | null>(null);
  const [modelLoad, setModelLoad] = useState<ModelLoadView>({ phase: "idle" });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const advancedDrawerRef = useRef<HTMLElement | null>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const bootLogRef = useRef({ readyRunId: 0, errorRunId: 0 });
  const modelLoadRunRef = useRef(0);
  const initialLoadStartedRef = useRef(false);
  const baseUrl = connectionInfo?.base_url ?? `http://127.0.0.1:${port}`;
  const llmUrl = connectionInfo?.llm_url ?? baseUrl;
  const sttUrl = connectionInfo?.stt_url ?? baseUrl;
  const healthUrl = connectionInfo?.endpoints.health ?? `${baseUrl}/health`;
  const llmExample = connectionInfo?.endpoints.llm_example ?? `${baseUrl}/v1/responses`;
  const sttExample =
    connectionInfo?.endpoints.stt_example ?? `${baseUrl}/v1/audio/transcriptions`;
  const settingsUrl = "https://therapy-deliberate-practice.com/settings";
  const helpUrl = "https://therapy-deliberate-practice.com/help";
  const isMac = /(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent);

  const logEvent = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[UI ${timestamp}] ${message}`]);
  }, []);

  const refreshStatus = async () => {
    const result = await invoke<{ status: string }>("gateway_status");
    setStatus(result.status);
    return result.status;
  };

  const waitForGatewayReady = async (maxWaitMs = 10 * 60_000) => {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const nextStatus = await refreshStatus();
      if (nextStatus === "running") return;
      if (nextStatus === "stopped") {
        throw new Error(t("errors.gatewayStoppedBeforeReady"));
      }
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1_000));
    }
    throw new Error(t("errors.gatewayHealthTimeout"));
  };

  const refreshModels = useCallback(async () => {
    logEvent(t("events.refreshCatalog"));
    const result = await invoke<{ data: ModelSummary[] }>("gateway_models");
    setModels(result.data ?? []);
  }, [logEvent, t]);

  const refreshRuntimeState = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      const result = await invoke<GatewayRuntimeState>("gateway_runtime_state");
      if (!shouldApply()) return result;
      setRuntimeState(result);
      if (result.defaults.responses || result.defaults["audio.transcriptions"]) {
        setDefaults((current) => ({
          llm: current.llm || result.defaults.responses || "",
          stt: current.stt || result.defaults["audio.transcriptions"] || ""
        }));
      }
      return result;
    },
    []
  );

  const trackModelLoadJob = async (
    jobId: string,
    initialJob: ModelLoadJob,
    runId: number
  ) => {
    const isCurrentRun = () => runId === modelLoadRunRef.current;
    if (!isCurrentRun()) return;
    let job = initialJob;
    setModelLoad({ phase: job.status === "pending" ? "starting" : "running", job });
    const deadline = Date.now() + 15 * 60_000;

    while (job.status === "pending" || job.status === "running") {
      if (!isCurrentRun()) return;
      if (Date.now() >= deadline) {
        setModelLoad({
          phase: "timed_out",
          job,
          error: t("errors.modelWaitTimeout")
        });
        logEvent(t("events.modelWaitPaused"));
        return;
      }
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 1_000));
      if (!isCurrentRun()) return;
      const latestJob = await invoke<ModelLoadJob>("gateway_model_load_status", {
        payload: { job_id: jobId }
      });
      if (!isCurrentRun()) return;
      job = latestJob;
      setModelLoad({
        phase: job.status === "pending" ? "starting" : job.status,
        job
      });
    }

    await refreshRuntimeState(isCurrentRun);
    if (!isCurrentRun()) return;
    if (job.status === "completed") {
      setModelLoad({ phase: "completed", job });
      setSaveState("saved");
      logEvent(t("events.modelsLoaded"));
    } else {
      const failedModels = job.models
        .filter((model) => model.status === "error")
        .map((model) => `${model.model_id}: ${model.error || t("errors.loadFailed")}`)
        .join(" · ");
      setModelLoad({
        phase: "failed",
        job,
        error: failedModels || t("errors.modelLoadFailed")
      });
      logEvent(
        t("events.modelLoadFailed", {
          details: failedModels || t("errors.unknownModelError")
        })
      );
    }
    await refreshLogs(isCurrentRun);
  };

  const loadSelectedModels = async () => {
    const selectedModels = [...new Set([defaults.llm, defaults.stt].filter(Boolean))];
    if (status !== "running") {
      setModelLoad({ phase: "failed", error: t("errors.startBeforeModels") });
      return;
    }
    if (!selectedModels.length) {
      setModelLoad({ phase: "failed", error: t("errors.chooseModels") });
      return;
    }

    const runId = ++modelLoadRunRef.current;
    let activeJob: ModelLoadJob | undefined;
    setModelLoad({ phase: "starting" });
    logEvent(t("events.modelLoadStarting", { count: selectedModels.length }));
    try {
      await invoke("save_gateway_config", {
        payload: {
          port,
          default_models: {
            responses: defaults.llm,
            "audio.transcriptions": defaults.stt
          },
          prefer_local: preferLocal
        }
      });
      if (runId !== modelLoadRunRef.current) return;
      const created = await invoke<{ job_id: string; status: ModelLoadJob }>(
        "gateway_load_models",
        { payload: { models: selectedModels } }
      );
      if (runId !== modelLoadRunRef.current) return;
      activeJob = created.status;
      await trackModelLoadJob(created.job_id, created.status, runId);
    } catch (error) {
      if (runId !== modelLoadRunRef.current) return;
      const message = formatErrorMessage(error, t);
      setModelLoad(
        activeJob
          ? {
              phase: "timed_out",
              job: activeJob,
              error: t("errors.statusInterrupted", { details: message })
            }
          : { phase: "failed", error: message }
      );
      logEvent(t("events.modelLoadUnavailable", { details: message }));
    }
  };

  const resumeModelLoadStatus = async () => {
    const existingJob = modelLoad.job;
    if (!existingJob) return;
    const runId = ++modelLoadRunRef.current;
    setModelLoad({ phase: "running", job: existingJob });
    logEvent(t("events.modelLoadCheck", { id: existingJob.id }));
    try {
      const latest = await invoke<ModelLoadJob>("gateway_model_load_status", {
        payload: { job_id: existingJob.id }
      });
      if (runId !== modelLoadRunRef.current) return;
      await trackModelLoadJob(existingJob.id, latest, runId);
    } catch (error) {
      if (runId !== modelLoadRunRef.current) return;
      const message = formatErrorMessage(error, t);
      setModelLoad({
        phase: "timed_out",
        job: existingJob,
        error: t("errors.statusInterruptedAgain", { details: message })
      });
      logEvent(t("events.modelLoadResumeFailed", { details: message }));
    }
  };

  const refreshLogs = useCallback(
    async (shouldApply: () => boolean = () => true) => {
      const result = await invoke<{ logs: string[] }>("gateway_logs");
      if (!shouldApply()) return;
      setLogs((prev) => {
        const gatewayLogs = result.logs ?? [];
        const localLogs = prev.filter((line) => line.startsWith("[UI "));
        return [...localLogs, ...gatewayLogs];
      });
    },
    []
  );

  const refreshConnectionInfo = async () => {
    const result = await invoke<GatewayConnectionInfo>("gateway_connection_info");
    setConnectionInfo(result);
    setPort(result.port);
    setPortInput(String(result.port));
  };

  const refreshStoragePaths = async () => {
    const result = await invoke<GatewayStoragePaths>("gateway_storage_paths");
    setStoragePaths(result);
  };

  const refreshPairingToken = useCallback(async () => {
    const result = await invoke<PairingToken>("gateway_pairing_token");
    setPairing(result);
  }, []);

  const refreshConfig = async () => {
    const result = await invoke<GatewayConfig>("gateway_config");
    setPort(result.port);
    setPortInput(String(result.port));
    setPreferLocal(result.prefer_local);
    setDefaults({
      llm: result.default_models.responses ?? "",
      stt: result.default_models["audio.transcriptions"] ?? ""
    });
  };

  const saveConfig = async () => {
    setSaveState("saving");
    try {
      logEvent(t("events.savingPreferences"));
      await invoke("save_gateway_config", {
        payload: {
          port,
          default_models: {
            responses: defaults.llm,
            "audio.transcriptions": defaults.stt
          },
          prefer_local: preferLocal
        }
      });
      setSaveState("saved");
      await refreshConnectionInfo();
      if (status === "running") {
        await refreshRuntimeState();
      }
      await refreshLogs();
    } catch (error) {
      console.error("Failed to save preferences", error);
      setSaveState("error");
      logEvent(t("events.savePreferencesFailed"));
    }
  };

  const savePort = async () => {
    const parsed = Number(portInput);
    if (!Number.isInteger(parsed)) return;
    const restartRequired = (status === "running" || status === "starting") && parsed !== port;
    let configSaved = false;
    let previousGatewayStopped = false;
    setPortSaveState("saving");
    setPortSaveError(null);
    try {
      if (restartRequired) {
        logEvent(t("events.portStopping", { port: parsed }));
        resetBoot();
        modelLoadRunRef.current += 1;
        setModelLoad({ phase: "idle" });
        setRuntimeState(null);
        setQuickTests(initialQuickTestsState);
        await invoke("stop_gateway");
        previousGatewayStopped = true;
        setStatus("stopped");
      }

      logEvent(t("events.portSaving", { port: parsed }));
      await invoke("save_gateway_config", {
        payload: {
          port: parsed,
          default_models: {
            responses: defaults.llm,
            "audio.transcriptions": defaults.stt
          },
          prefer_local: preferLocal
        }
      });
      configSaved = true;
      setPort(parsed);
      if (restartRequired) {
        logEvent(t("events.portStarting", { port: parsed }));
        const started = await invoke<{ status: string }>("start_gateway");
        setStatus(started.status);
        await waitForGatewayReady();
      }
      setPortSaveState("saved");
    } catch (error) {
      console.error("Failed to save port", error);
      setPortSaveState("error");
      const details = formatErrorMessage(error, t);
      let recovery = "";
      if (previousGatewayStopped && !configSaved) {
        try {
          logEvent(t("events.portRecovery"));
          const restored = await invoke<{ status: string }>("start_gateway");
          setStatus(restored.status);
          await waitForGatewayReady();
          recovery = t("errors.previousGatewayRestarted");
        } catch (restartError) {
          recovery = t("errors.previousGatewayRestartFailed", {
            details: formatErrorMessage(restartError, t)
          });
        }
      }
      const message =
        configSaved && restartRequired
          ? t("errors.portSavedRestartFailed", { port: parsed, details })
          : t("errors.portNotApplied", { details, recovery });
      setPortSaveError(message);
      logEvent(message);
    } finally {
      await Promise.allSettled([refreshStatus(), refreshConnectionInfo(), refreshLogs()]);
    }
  };

  const refreshDoctorChecks = useCallback(async () => {
    setDoctorRunState("running");
    setDoctorRunError(null);
    try {
      const result = await invoke<{ checks: DoctorCheck[] }>("gateway_doctor");
      setDoctorChecks(result.checks ?? []);
      await Promise.allSettled([refreshLogs()]);
      setDoctorRunState("idle");
    } catch (error) {
      const message = t("doctor.runFailed", {
        details: formatErrorMessage(error, t)
      });
      setDoctorRunState("error");
      setDoctorRunError(message);
      logEvent(t("events.doctorFailed", { details: message }));
    }
  }, [logEvent, refreshLogs, t]);

  const runDoctor = useCallback(async () => {
    logEvent(t("events.doctorRunning"));
    await refreshDoctorChecks();
  }, [logEvent, refreshDoctorChecks, t]);

  const startGateway = async () => {
    setStartError(null);
    try {
      logEvent(t("events.gatewayStarting"));
      const started = await invoke<{ status: string }>("start_gateway");
      setStatus(started.status);
      await waitForGatewayReady();
      await refreshLogs();
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : JSON.stringify(error);
      setStartError(message);
      logEvent(t("events.gatewayStartFailed", { details: message }));
    } finally {
      await Promise.allSettled([refreshStatus(), refreshLogs()]);
    }
  };

  const stopGateway = async () => {
    resetBoot();
    modelLoadRunRef.current += 1;
    await invoke("stop_gateway");
    setRuntimeState(null);
    setModelLoad({ phase: "idle" });
    setQuickTests(initialQuickTestsState);
    await refreshStatus();
    logEvent(t("events.gatewayStopped"));
  };

  const rotatePairingToken = async () => {
    const confirmed = window.confirm(t("connection.rotateConfirm"));
    if (!confirmed) return;
    setPairingKeyState("saving");
    try {
      const result = await invoke<PairingToken>("rotate_gateway_pairing_token");
      setPairing(result);
      setShowPairingKey(false);
      setSimpleSteps((previous) => ({ ...previous, copiedKey: false }));
      await Promise.allSettled([refreshStatus(), refreshLogs()]);
      setPairingKeyState("saved");
      logEvent(t("events.pairingRotated"));
    } catch (error) {
      setPairingKeyState("error");
      logEvent(
        t("events.pairingRotationFailed", {
          details: formatErrorMessage(error, t)
        })
      );
    }
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setClipboardError(null);
      logEvent(t("events.clipboardCopied"));
      return true;
    } catch {
      const message = t("connection.clipboardFailure");
      setClipboardError(message);
      logEvent(message);
      return false;
    }
  };

  const runQuickTests = async () => {
    if (status !== "running") {
      const message = t("errors.gatewayNotRunning");
      logEvent(message);
      setQuickTests({
        status: "error",
        llm: { status: "error", error: message },
        stt: { status: "error", error: message },
        finishedAt: new Date().toISOString()
      });
      return;
    }
    const selected = [...new Set([defaults.llm, defaults.stt].filter(Boolean))];
    const loaded = new Set(runtimeState?.loaded_models ?? []);
    if (!selected.length || !selected.every((modelId) => loaded.has(modelId))) {
      const message = t("errors.modelsNotLoaded");
      logEvent(message);
      setQuickTests({
        status: "error",
        llm: { status: "error", error: message },
        stt: { status: "error", error: message },
        finishedAt: new Date().toISOString()
      });
      return;
    }
    if (!pairing?.token) {
      const message = t("errors.pairingUnavailable");
      logEvent(message);
      setQuickTests({
        status: "error",
        llm: { status: "error", error: message },
        stt: { status: "error", error: message },
        finishedAt: new Date().toISOString()
      });
      return;
    }

    const startedAt = new Date().toISOString();
    setQuickTests({
      status: "running",
      llm: { status: "running" },
      stt: { status: "idle" },
      startedAt
    });

    logEvent(t("events.llmTestRunning"));
    const llmStart = performance.now();
    let llmResult: QuickTestResult;
    try {
      const response = await fetchInferenceWithTimeout(
        `${baseUrl}/v1/responses`,
        pairing.token,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${pairing.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            input: "Self-test: reply with exactly the single word 'pong'.",
            max_output_tokens: 32,
            temperature: 0
          })
        },
        120_000
      );
      const durationMs = Math.round(performance.now() - llmStart);
      if (!response.ok) {
        throw await gatewayResponseError(response);
      }
      const data = await response.json();
      const text =
        data?.output?.[0]?.content?.[0]?.text ??
        (typeof data?.output_text === "string" ? data.output_text : undefined);
      if (!text) {
        throw new Error(t("errors.llmMissingText"));
      }
      llmResult = { status: "ok", durationMs, preview: text.trim() };
      logEvent(t("events.llmTestOk", { duration: durationMs }));
    } catch (error) {
      const durationMs = Math.round(performance.now() - llmStart);
      const message = formatErrorMessage(error, t);
      llmResult = { status: "error", durationMs, error: message };
      logEvent(t("events.llmTestFailed", { details: message }));
    }
    setQuickTests((prev) => ({ ...prev, llm: llmResult }));

    logEvent(t("events.sttTestRunning"));
    setQuickTests((prev) => ({ ...prev, stt: { status: "running" } }));
    const sttStart = performance.now();
    let sttResult: QuickTestResult;
    try {
      const formData = new FormData();
      formData.append("file", makeSilentWavBlob(), "selftest.wav");
      formData.append("response_format", "json");
      formData.append("language", "en");
      const response = await fetchInferenceWithTimeout(
        `${baseUrl}/v1/audio/transcriptions`,
        pairing.token,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${pairing.token}`
          },
          body: formData
        },
        120_000
      );
      const durationMs = Math.round(performance.now() - sttStart);
      if (!response.ok) {
        throw await gatewayResponseError(response);
      }
      const data = await response.json();
      const text = typeof data?.text === "string" ? data.text : undefined;
      if (text === undefined) {
        throw new Error(t("errors.sttMissingText"));
      }
      sttResult = {
        status: "ok",
        durationMs,
        preview: text.trim() || t("tests.silentAudio")
      };
      logEvent(t("events.sttTestOk", { duration: durationMs }));
    } catch (error) {
      const durationMs = Math.round(performance.now() - sttStart);
      const message = formatErrorMessage(error, t);
      sttResult = { status: "error", durationMs, error: message };
      logEvent(t("events.sttTestFailed", { details: message }));
    }
    setQuickTests((prev) => ({ ...prev, stt: sttResult }));

    const finishedAt = new Date().toISOString();
    const overallStatus =
      llmResult.status === "ok" && sttResult.status === "ok" ? "ok" : "error";
    setQuickTests((prev) => ({
      ...prev,
      status: overallStatus,
      finishedAt
    }));
    await refreshLogs();
  };

  const boot = useGatewayBoot({
    healthUrl,
    t,
    onReady: async () => {
      await refreshStatus();
      await refreshConnectionInfo();
      await refreshModels();
      await refreshRuntimeState();
      await refreshLogs();
    }
  });
  const { start: startBoot, cancel: cancelBoot, reset: resetBoot } = boot;

  useEffect(() => {
    if (boot.state.phase === "error" && boot.state.error && bootLogRef.current.errorRunId !== boot.state.runId) {
      bootLogRef.current.errorRunId = boot.state.runId;
      logEvent(t("events.launchFailed", { details: boot.state.error }));
    }
    if (boot.state.phase === "ready" && bootLogRef.current.readyRunId !== boot.state.runId) {
      bootLogRef.current.readyRunId = boot.state.runId;
      logEvent(t("events.healthPassed"));
    }
  }, [boot.state.phase, boot.state.error, boot.state.runId, logEvent, t]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void refreshStatus();
    void refreshLogs();
    void refreshConnectionInfo();
    void refreshStoragePaths();
    void refreshConfig();
    void refreshPairingToken();
    void refreshDoctorChecks();
  }, [refreshDoctorChecks, refreshLogs, refreshPairingToken]);

  useEffect(() => {
    if (status !== "running") return;
    void Promise.all([refreshModels(), refreshRuntimeState()]).catch((error) => {
      logEvent(
        t("events.runtimeRefreshFailed", {
          details: formatErrorMessage(error, t)
        })
      );
    });
  }, [logEvent, refreshModels, refreshRuntimeState, status, t]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshLogs();
    }, 2000);
    return () => clearInterval(interval);
  }, [refreshLogs]);

  useEffect(() => {
    if (status !== "starting") return;
    const interval = window.setInterval(() => {
      void refreshStatus().catch((error) => {
        logEvent(
          t("events.readinessRefreshFailed", {
            details: formatErrorMessage(error, t)
          })
        );
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [logEvent, status, t]);

  useEffect(() => {
    setSaveState("idle");
  }, [defaults.llm, defaults.stt, preferLocal]);

  useEffect(() => {
    setPortSaveState("idle");
    setPortSaveError(null);
  }, [portInput]);

  useEffect(() => {
    if (!autoScroll) return;
    if (!logBoxRef.current) return;
    logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs, autoScroll]);

  useEffect(() => {
    document.body.classList.toggle("drawer-open", showAdvanced);
    return () => {
      document.body.classList.remove("drawer-open");
    };
  }, [showAdvanced]);

  useEffect(() => {
    if (!showAdvanced) return;
    const drawer = advancedDrawerRef.current;
    if (!drawer) return;
    drawer.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowAdvanced(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("hidden"));
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => drawerReturnFocusRef.current?.focus());
    };
  }, [showAdvanced]);

  useEffect(
    () => () => {
      modelLoadRunRef.current += 1;
    },
    []
  );

  const runtimePlatformId = runtimeState?.platform_id ?? null;
  const supportsRuntimePlatform = useCallback(
    (model: ModelSummary) =>
      !runtimePlatformId ||
      !model.metadata.compat?.platforms?.length ||
      model.metadata.compat.platforms.includes(runtimePlatformId),
    [runtimePlatformId]
  );
  const llmOptions = useMemo(
    () =>
      models.filter(
        (model) =>
          model.metadata.api.endpoint === "responses" && supportsRuntimePlatform(model)
      ),
    [models, supportsRuntimePlatform]
  );
  const sttOptions = useMemo(
    () =>
      models.filter((model) =>
        ["audio.transcriptions", "audio.translations"].includes(model.metadata.api.endpoint) &&
        supportsRuntimePlatform(model)
      ),
    [models, supportsRuntimePlatform]
  );

  useEffect(() => {
    if (!models.length) return;
    const pickModel = (options: ModelSummary[], currentId: string, preferredId: string) =>
      options.find((model) => model.id === currentId)?.id ??
      options.find((model) => model.id === preferredId)?.id ??
      options[0]?.id ??
      "";
    const nextDefaults = {
      llm: pickModel(
        llmOptions,
        defaults.llm,
        runtimeState?.defaults.responses ??
          (isMac ? "local//llm/qwen3-mlx" : "local//llm/qwen3-hf")
      ),
      stt: pickModel(
        sttOptions,
        defaults.stt,
        runtimeState?.defaults["audio.transcriptions"] ??
          (isMac ? "local//stt/parakeet-mlx" : "local//stt/faster-whisper")
      )
    };
    if (nextDefaults.llm !== defaults.llm || nextDefaults.stt !== defaults.stt) {
      setDefaults(nextDefaults);
      logEvent(
        t("events.defaultsSelected", {
          platform: runtimePlatformId ?? t("hero.detectedMachine")
        })
      );
    }
  }, [
    defaults.llm,
    defaults.stt,
    isMac,
    llmOptions,
    logEvent,
    models.length,
    runtimePlatformId,
    runtimeState?.defaults,
    sttOptions,
    t
  ]);

  const gatewayReady = status === "running" || boot.state.phase === "ready";
  const heroBootState: GatewayBootState =
    gatewayReady && boot.state.phase !== "ready" ? { ...boot.state, phase: "ready" as const } : boot.state;
  const isGatewayRunning = status === "running";
  const isGatewayActive = status === "running" || status === "starting";
  const portValue = Number(portInput);
  const portValid = Number.isInteger(portValue) && portValue >= 1024 && portValue <= 65535;
  const portDirty = portValue !== port;
  const doctorBlocking = doctorChecks.find(
    (check) =>
      check.status === "error" &&
      ["local_runtime_import", "python_executable"].includes(check.code)
  );
  const doctorBlockingView = doctorBlocking
    ? describeDoctorCheck(doctorBlocking, t)
    : null;
  const canStartGateway = !doctorBlocking && !isGatewayActive;
  const canLoadModels = isGatewayRunning;
  const hasModels = models.length > 0;
  const canChooseDefaults = hasModels;
  const defaultsComplete = Boolean(defaults.llm && defaults.stt);
  const selectedModelIds = [...new Set([defaults.llm, defaults.stt].filter(Boolean))];
  const runtimeLoadedModels = new Set(runtimeState?.loaded_models ?? []);
  const selectedModelsLoaded =
    selectedModelIds.length > 0 &&
    selectedModelIds.every((modelId) => runtimeLoadedModels.has(modelId));
  const modelLoadBusy =
    modelLoad.phase === "starting" ||
    modelLoad.phase === "running" ||
    modelLoad.phase === "timed_out";
  const canSave = defaultsComplete && selectedModelsLoaded;
  const isSaved = saveState === "saved";
  const simpleStep1Complete = gatewayReady;
  const simpleStep2Complete = selectedModelsLoaded;
  const simpleStep3Complete = simpleSteps.copiedUrl && simpleSteps.copiedKey;
  const simpleStep4Complete = simpleSteps.openedSettings;
  const simpleActiveStep = !simpleStep1Complete
    ? 1
    : !simpleStep2Complete
      ? 2
      : !simpleStep3Complete
        ? 3
        : 4;
  const moduleNotFound = logs.some((line) =>
    line.includes("ModuleNotFoundError: No module named 'local_runtime'")
  );

  const handleLaunchStart = useCallback(() => {
    if (!canStartGateway) {
      logEvent(t("events.launchBlocked"));
      return;
    }
    logEvent(t("events.launchStarting"));
    startBoot();
  }, [canStartGateway, logEvent, startBoot, t]);

  const handleLaunchCancel = useCallback(() => {
    logEvent(t("events.launchStopping"));
    cancelBoot();
  }, [cancelBoot, logEvent, t]);

  const handleLaunchReset = useCallback(() => {
    resetBoot();
  }, [resetBoot]);

  const openAdvanced = useCallback(() => {
    logEvent(t("events.advancedOpened"));
    drawerReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShowAdvanced(true);
  }, [logEvent, t]);

  const closeAdvanced = useCallback(() => {
    setShowAdvanced(false);
  }, []);

  const handleReadyLaunchClick = useCallback(() => {
    openAdvanced();
  }, [openAdvanced]);

  let activeStep = 1;
  if (isGatewayRunning) activeStep = 2;
  if (hasModels) activeStep = 3;
  if (defaultsComplete) activeStep = 4;
  if (selectedModelsLoaded) activeStep = 5;
  if (isSaved) activeStep = 6;

  const step1Description = doctorBlockingView
    ? t("wizard.blocked", { details: doctorBlockingView.details })
    : t("wizard.startDescription");

  const steps = [
    {
      id: 1,
      title: t("wizard.startGateway"),
      description: step1Description,
      complete: isGatewayRunning
    },
    {
      id: 2,
      title: t("wizard.discover"),
      description: t("wizard.discoverDescription"),
      complete: hasModels
    },
    {
      id: 3,
      title: t("wizard.choose"),
      description: t("wizard.chooseDescription"),
      complete: defaultsComplete
    },
    {
      id: 4,
      title: t("wizard.download"),
      description: t("wizard.downloadDescription"),
      complete: selectedModelsLoaded
    },
    {
      id: 5,
      title: t("wizard.save"),
      description: t("wizard.saveDescription"),
      complete: isSaved
    }
  ];

  if (isSaved) {
    steps.push({
      id: 6,
      title: t("wizard.configure"),
      description: t("wizard.configureDescription"),
      complete: false
    });
  }

  const loadJobModelIds = new Set(modelLoad.job?.models.map((model) => model.model_id) ?? []);
  const loadJobMatchesSelection =
    selectedModelIds.length === loadJobModelIds.size &&
    selectedModelIds.every((modelId) => loadJobModelIds.has(modelId));
  const effectiveModelLoadPhase: ModelLoadView["phase"] = selectedModelsLoaded
    ? "completed"
    : modelLoad.phase === "completed" && !loadJobMatchesSelection
      ? "idle"
      : modelLoad.phase;
  const modelTitleById = new Map(
    models.map((model) => [model.id, model.metadata.display.title] as const)
  );
  const modelLoadProgress = (
    <div className="model-load-panel" aria-live="polite">
      <div className="model-load-summary">
        <span
          className={`badge ${selectedModelsLoaded ? "badge-success" : ""}`}
        >
          {describeModelLoadPhase(effectiveModelLoadPhase, t)}
        </span>
        {runtimePlatformId ? (
          <span className="mono">{t("model.platform", { platform: runtimePlatformId })}</span>
        ) : null}
      </div>
      {loadJobMatchesSelection
        ? modelLoad.job?.models.map((model) => (
        <div className="model-load-row" key={model.model_id}>
          <div>
            <div className="text-sm">
              {modelTitleById.get(model.model_id) ?? model.model_id}
            </div>
            {model.error ? <div className="error-text">{model.error}</div> : null}
          </div>
          <div className="model-load-row-status">
            <span className={`model-status model-status-${model.status}`}>
              {describeModelStatus(model.status, t)}
            </span>
            {model.duration_ms !== null ? (
              <span className="mono">{formatModelDuration(model.duration_ms)}</span>
            ) : null}
          </div>
        </div>
          ))
        : null}
      {modelLoad.error && (!modelLoad.job || loadJobMatchesSelection) ? (
        <div className="error-text">{modelLoad.error}</div>
      ) : null}
      {effectiveModelLoadPhase === "timed_out" && loadJobMatchesSelection ? (
        <div className="button-row">
          <button
            className="btn"
            onClick={resumeModelLoadStatus}
            disabled={status !== "running"}
          >
            {t("model.checkCurrent")}
          </button>
        </div>
      ) : null}
      {modelLoadBusy ? (
        <div className="helper-text">{t("model.firstRun")}</div>
      ) : null}
    </div>
  );

  return (
    <div className="app-shell" data-locale={locale}>
      <div
        className={`drawer-scrim ${showAdvanced ? "open" : ""}`}
        onClick={closeAdvanced}
        aria-hidden="true"
      />
      <main
        className={`container simple-content ${showAdvanced ? "blurred" : ""}`}
        aria-hidden={showAdvanced}
        inert={showAdvanced ? true : undefined}
      >
        <div className="panel hero">
        <div className="hero-glow" />
        <div className="hero-header">
          <div>
            <div className="kicker">{t("hero.kicker")}</div>
            <div className="title">{t("hero.title")}</div>
            <div className="hero-subtitle">
              {t("hero.subtitle", {
                platform: runtimePlatformId ?? t("hero.detectedMachine")
              })}
            </div>
          </div>
          <div className="hero-actions">
            <label className="locale-control">
              <span>{t("locale.label")}</span>
              <select
                aria-label={t("accessibility.languageSelect")}
                value={locale}
                onChange={(event) => setLocale(event.target.value === "fr" ? "fr" : "en")}
              >
                <option value="en">{t("locale.english")}</option>
                <option value="fr">{t("locale.french")}</option>
              </select>
            </label>
            <span className="badge">
              {t("common.status", { status: describeGatewayStatus(status, t) })}
            </span>
            <button className="btn ghost" onClick={openAdvanced}>
              {t("hero.advanced")}
            </button>
          </div>
        </div>
        <div className="hero-steps">
          <div className={`simple-step ${simpleStep1Complete ? "complete" : ""} ${simpleActiveStep === 1 ? "active" : ""}`}>
            <div className="simple-step-index">{simpleStep1Complete ? "✓" : "1"}</div>
            <div className="simple-step-content">
              <div className="simple-step-title">{t("hero.launchTitle")}</div>
              <div className="simple-step-description">
                {doctorBlockingView
                  ? doctorBlockingView.details
                  : t("hero.launchDescription")}
              </div>
              <GatewayLaunchButton
                boot={heroBootState}
                onStart={handleLaunchStart}
                onCancel={handleLaunchCancel}
                onReset={handleLaunchReset}
                disabled={!canStartGateway}
                disabledReason={doctorBlockingView?.details}
                onReadyClick={handleReadyLaunchClick}
                t={t}
              />
              {doctorBlockingView ? (
                <div className="inline-row">
                  <div className="helper-text">{t("hero.doctorRecovery")}</div>
                  <button
                    className="btn ghost"
                    onClick={runDoctor}
                    disabled={doctorRunState === "running"}
                  >
                    {t("wizard.doctor")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className={`simple-step ${simpleStep2Complete ? "complete" : ""} ${simpleActiveStep === 2 ? "active" : ""}`}>
            <div className="simple-step-index">{simpleStep2Complete ? "✓" : "2"}</div>
            <div className="simple-step-content">
              <div className="simple-step-title">{t("hero.prepareTitle")}</div>
              <div className="simple-step-description">{t("hero.prepareDescription")}</div>
              <div className="grid">
                <div>
                  <div className="label">{t("model.language")}</div>
                  <select
                    className="select"
                    aria-label={t("model.language")}
                    value={defaults.llm}
                    onChange={(event) =>
                      setDefaults((previous) => ({ ...previous, llm: event.target.value }))
                    }
                    disabled={!canChooseDefaults || modelLoadBusy}
                  >
                    <option value="">{t("model.selectLanguage")}</option>
                    {llmOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.metadata.display.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="label">{t("model.speech")}</div>
                  <select
                    className="select"
                    aria-label={t("model.speech")}
                    value={defaults.stt}
                    onChange={(event) =>
                      setDefaults((previous) => ({ ...previous, stt: event.target.value }))
                    }
                    disabled={!canChooseDefaults || modelLoadBusy}
                  >
                    <option value="">{t("model.selectSpeech")}</option>
                    {sttOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.metadata.display.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="button-row">
                <button
                  className="btn primary"
                  onClick={loadSelectedModels}
                  disabled={!defaultsComplete || modelLoadBusy || !gatewayReady}
                >
                  {modelLoadBusy
                    ? modelLoad.phase === "timed_out"
                      ? t("model.continues")
                      : t("model.preparing")
                    : selectedModelsLoaded
                      ? t("model.reload")
                      : t("model.downloadLoad")}
                </button>
                <button
                  className="btn ghost"
                  onClick={refreshModels}
                  disabled={!gatewayReady || modelLoadBusy}
                >
                  {t("common.refresh")}
                </button>
              </div>
              {modelLoadProgress}
            </div>
          </div>
          <div className={`simple-step ${simpleStep3Complete ? "complete" : ""} ${simpleActiveStep === 3 ? "active" : ""}`}>
            <div className="simple-step-index">{simpleStep3Complete ? "✓" : "3"}</div>
            <div className="simple-step-content">
              <div className="simple-step-title">{t("hero.copyTitle")}</div>
              <div className="simple-step-description">{t("hero.copyDescription")}</div>
              <div className="connection-summary">
                <span className="mono">{baseUrl}</span>
                <span className="mono pairing-value">
                  {pairing?.masked ?? t("connection.creatingKey")}
                </span>
              </div>
              <div className="button-row">
                <button
                  className="btn"
                  onClick={async () => {
                    if (await copyText(baseUrl)) {
                      setSimpleSteps((prev) => ({ ...prev, copiedUrl: true }));
                    }
                  }}
                  disabled={!selectedModelsLoaded}
                >
                  {simpleSteps.copiedUrl ? t("hero.urlCopied") : t("common.copy")}
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    if (!pairing?.token) return;
                    if (await copyText(pairing.token)) {
                      setSimpleSteps((prev) => ({ ...prev, copiedKey: true }));
                    }
                  }}
                  disabled={!selectedModelsLoaded || !pairing?.token}
                >
                  {simpleSteps.copiedKey ? t("hero.pairingCopied") : t("common.copy")}
                </button>
              </div>
            </div>
          </div>
          <div className={`simple-step ${simpleStep4Complete ? "complete" : ""} ${simpleActiveStep === 4 ? "active" : ""}`}>
            <div className="simple-step-index">{simpleStep4Complete ? "✓" : "4"}</div>
            <div className="simple-step-content">
              <div className="simple-step-title">{t("hero.settingsTitle")}</div>
              <div className="simple-step-description">{t("hero.settingsDescription")}</div>
              <div className="button-row">
                <button
                  className="btn primary"
                  onClick={async () => {
                    await openUrl(settingsUrl);
                    setSimpleSteps((prev) => ({ ...prev, openedSettings: true }));
                    logEvent(t("events.settingsOpened"));
                  }}
                  disabled={!simpleStep3Complete}
                  title={!simpleStep3Complete ? t("hero.copyBothFirst") : undefined}
                >
                  {simpleStep4Complete ? t("hero.settingsOpened") : t("hero.nextOpenSettings")}
                </button>
                <button
                  className="btn ghost"
                  onClick={async () => {
                    await openUrl(helpUrl);
                    logEvent(t("events.helpOpened"));
                  }}
                >
                  {t("connection.help")}
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </main>

      <aside
        ref={advancedDrawerRef}
        className={`advanced-drawer ${showAdvanced ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="advanced-drawer-title"
        aria-label={t("accessibility.advancedDialog")}
        aria-hidden={!showAdvanced}
        inert={!showAdvanced ? true : undefined}
        tabIndex={-1}
      >
        <div className="drawer-header">
          <div>
            <div className="kicker">{t("common.advanced")}</div>
            <div className="title" id="advanced-drawer-title">{t("hero.advanced")}</div>
          </div>
          <div className="hero-actions">
            <span className="badge">
              {t("common.status", { status: describeGatewayStatus(status, t) })}
            </span>
            <button className="btn ghost" onClick={closeAdvanced}>
              {t("common.close")}
            </button>
          </div>
        </div>
        <div className="drawer-body">
          <div className="panel header">
            <div>
              <div className="kicker">{t("hero.kicker")}</div>
              <div className="title">{t("hero.advanced")}</div>
            </div>
            <span className="badge">
              {t("common.status", { status: describeGatewayStatus(status, t) })}
            </span>
          </div>

          <div className="panel connection">
            <div className="header">
              <div>
                <div className="kicker">{t("connection.kicker")}</div>
                <div className="title">{t("connection.title")}</div>
              </div>
              <span className="badge">Port {port}</span>
            </div>
            <div className="connection-grid">
              <div className="connection-row">
                <div className="label">{t("connection.baseUrl")}</div>
                <div className="pill-row">
                  <div className="pill" title={baseUrl}>{baseUrl}</div>
                  <button className="icon-btn" onClick={() => copyText(baseUrl)}>
                    {t("common.copy")}
                  </button>
                </div>
              </div>
              <div className="connection-row">
                <div className="label">{t("connection.llmUrl")}</div>
                <div className="pill-row">
                  <div className="pill" title={llmUrl}>{llmUrl}</div>
                  <button className="icon-btn" onClick={() => copyText(llmUrl)}>
                    {t("common.copy")}
                  </button>
                </div>
              </div>
              <div className="connection-row">
                <div className="label">{t("connection.sttUrl")}</div>
                <div className="pill-row">
                  <div className="pill" title={sttUrl}>{sttUrl}</div>
                  <button className="icon-btn" onClick={() => copyText(sttUrl)}>
                    {t("common.copy")}
                  </button>
                </div>
              </div>
              <div className="connection-row">
                <div className="label">{t("connection.pairingKey")}</div>
                <div className="pill-row">
                  <div
                    className="pill pairing-value"
                    title={showPairingKey ? pairing?.token : pairing?.masked}
                  >
                    {showPairingKey
                      ? pairing?.token ?? t("connection.creatingKey")
                      : pairing?.masked ?? t("connection.creatingKey")}
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => setShowPairingKey((visible) => !visible)}
                    aria-pressed={showPairingKey}
                    disabled={!pairing}
                  >
                    {showPairingKey ? t("connection.hide") : t("connection.reveal")}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => pairing?.token && copyText(pairing.token)}
                    disabled={!pairing?.token}
                  >
                    {t("common.copy")}
                  </button>
                </div>
                <div className="helper-text">{t("connection.pairingPrivate")}</div>
                <div className="button-row">
                  <button
                    className="btn ghost"
                    onClick={rotatePairingToken}
                    disabled={pairingKeyState === "saving"}
                  >
                    {pairingKeyState === "saving"
                      ? t("connection.rotating")
                      : t("connection.rotate")}
                  </button>
                  {pairingKeyState === "saved" ? (
                    <span className="success-text">{t("connection.rotateSuccess")}</span>
                  ) : null}
                  {pairingKeyState === "error" ? (
                    <span className="error-text">{t("connection.rotateFailure")}</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="storage-card" aria-live="polite">
              <div className="helper-title">{t("connection.storageTitle")}</div>
              <dl className="storage-paths">
                <div>
                  <dt>{t("connection.configPath")}</dt>
                  <dd className="mono">{storagePaths?.config_file ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("connection.dataPath")}</dt>
                  <dd className="mono">{storagePaths?.data_dir ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("connection.cachePath")}</dt>
                  <dd className="mono">{storagePaths?.cache_dir ?? "—"}</dd>
                </div>
                <div>
                  <dt>{t("connection.logPolicy")}</dt>
                  <dd>{t("connection.metadataOnly")}</dd>
                </div>
              </dl>
            </div>
            <div className="helper-row">
              <div>
                <div className="helper-title">{t("connection.wherePaste")}</div>
                <div className="helper-text">{t("connection.wherePasteAnswer")}</div>
              </div>
              <button className="btn" onClick={() => openUrl(settingsUrl)}>
                {t("connection.openSettings")}
              </button>
            </div>
            {clipboardError ? (
              <div className="error-banner" role="alert">
                {clipboardError}
              </div>
            ) : null}
            <div className="button-row">
              <button className="btn" onClick={() => openUrl(healthUrl)}>
                {t("connection.health")}
              </button>
              <button
                className="btn"
                onClick={runQuickTests}
                disabled={
                  quickTests.status === "running" ||
                  status !== "running" ||
                  !selectedModelsLoaded
                }
                title={
                  !selectedModelsLoaded
                    ? t("hero.downloadFirst")
                    : undefined
                }
              >
                {quickTests.status === "running"
                  ? t("tests.running")
                  : t("tests.run")}
              </button>
              <button className="btn" onClick={() => copyText(llmExample)}>
                {t("connection.copyLlm")}
              </button>
              <button className="btn" onClick={() => copyText(sttExample)}>
                {t("connection.copyStt")}
              </button>
            </div>
            <div className="quick-test-results">
              <div className="helper-title">{t("tests.results")}</div>
              <div className="quick-test-row">
                <div className="quick-test-row-header">
                  <span className="text-sm">LLM</span>
                  <span className={`badge ${quickTests.llm.status === "ok" ? "badge-success" : ""}`}>
                    {describeQuickTestStatus(quickTests.llm.status, t)}
                  </span>
                  {typeof quickTests.llm.durationMs === "number" ? (
                    <span className="mono">{quickTests.llm.durationMs} ms</span>
                  ) : null}
                </div>
                {quickTests.llm.preview ? (
                  <div className="helper-text">
                    {t("tests.preview", { preview: truncatePreview(quickTests.llm.preview) })}
                  </div>
                ) : null}
                {quickTests.llm.error ? <div className="error-text">{quickTests.llm.error}</div> : null}
              </div>
              <div className="quick-test-row">
                <div className="quick-test-row-header">
                  <span className="text-sm">STT</span>
                  <span className={`badge ${quickTests.stt.status === "ok" ? "badge-success" : ""}`}>
                    {describeQuickTestStatus(quickTests.stt.status, t)}
                  </span>
                  {typeof quickTests.stt.durationMs === "number" ? (
                    <span className="mono">{quickTests.stt.durationMs} ms</span>
                  ) : null}
                </div>
                {quickTests.stt.preview ? (
                  <div className="helper-text">
                    {t("tests.preview", { preview: truncatePreview(quickTests.stt.preview) })}
                  </div>
                ) : null}
                {quickTests.stt.error ? <div className="error-text">{quickTests.stt.error}</div> : null}
              </div>
              {quickTests.status === "idle" ? (
                <div className="helper-text">{t("tests.empty")}</div>
              ) : null}
            </div>
            <div className="port-editor">
              <div>
                <div className="label">{t("port.label")}</div>
                <input
                  className="port-input"
                  aria-label={t("port.label")}
                  type="number"
                  min={1024}
                  max={65535}
                  value={portInput}
                  onChange={(event) => setPortInput(event.target.value)}
                />
                <div className="helper-text">{t("port.help")}</div>
                {!portValid ? (
                  <div className="error-text">{t("port.invalid")}</div>
                ) : null}
              </div>
              <div className="button-row">
                <button
                  className="btn primary"
                  onClick={savePort}
                  disabled={!portValid || portSaveState === "saving"}
                >
                  {portSaveState === "saving" ? t("common.saving") : t("port.save")}
                </button>
                <button className="btn" onClick={() => setPortInput("8484")}>
                  {t("port.useDefault")}
                </button>
                {portSaveState === "error" ? (
                  <span className="error-text">{portSaveError ?? t("port.saveFailed")}</span>
                ) : null}
                {portSaveState === "saved" ? (
                  <span className="success-text">{t("port.saved")}</span>
                ) : null}
              </div>
            </div>
            {portDirty && isGatewayActive ? (
              <div className="warning-banner">
                <div>{t("port.restartNotice")}</div>
              </div>
            ) : null}
          </div>

          <div className="panel wizard">
            <div className="header">
              <div>
                <div className="kicker">{t("wizard.kicker")}</div>
                <div className="title">{t("wizard.title")}</div>
              </div>
              <span className="badge">
                {t("common.stepOf", { step: activeStep, total: isSaved ? 6 : 5 })}
              </span>
            </div>

            <ol className="stepper">
              {steps.map((step) => (
                <li
                  key={step.id}
                  className={`step ${step.complete ? "complete" : ""} ${activeStep === step.id ? "active" : ""}`}
                >
                  <div className="step-index">{step.id}</div>
                  <div>
                    <div className="step-title">{step.title}</div>
                    <div className="step-description">{step.description}</div>
                  </div>
                </li>
              ))}
            </ol>

            <div className="step-card">
              <div className="step-card-header">
                <div>
                  <div className="label">{t("common.step", { step: 1 })}</div>
                  <div className="step-title">{t("wizard.startGateway")}</div>
                </div>
                <span className={`badge ${isGatewayRunning ? "badge-success" : ""}`}>
                  {isGatewayRunning
                    ? t("launch.readyTitle")
                    : isGatewayActive
                      ? t("wizard.gatewayStarting")
                      : t("wizard.gatewayStopped")}
                </span>
              </div>
              <p className="step-description">{t("wizard.launchBeforeModels")}</p>
              {doctorBlockingView ? (
                <div className="warning-banner">
                  <div>
                    {doctorBlockingView.title}: {doctorBlockingView.details}
                  </div>
                  {doctorBlockingView.fix ? (
                    <div className="helper-text">
                      {t("common.fix", { details: doctorBlockingView.fix })}
                    </div>
                  ) : null}
                  <button
                    className="btn"
                    onClick={runDoctor}
                    disabled={doctorRunState === "running"}
                  >
                    {t("wizard.doctor")}
                  </button>
                </div>
              ) : null}
              <div className="button-row">
                <button className="btn primary" onClick={startGateway} disabled={!canStartGateway}>
                  {t("wizard.start")}
                </button>
                <button className="btn" onClick={stopGateway} disabled={!isGatewayActive}>
                  {t("wizard.stop")}
                </button>
                <button
                  className="btn"
                  onClick={runDoctor}
                  disabled={doctorRunState === "running"}
                >
                  {t("wizard.doctor")}
                </button>
              </div>
              {startError ? (
                <div className="error-banner">
                  <div>{t("wizard.startFailed")}</div>
                  <div className="helper-text">{startError}</div>
                </div>
              ) : null}
            </div>

            <div className={`step-card ${canLoadModels ? "" : "is-disabled"}`}>
              <div className="step-card-header">
                <div>
                  <div className="label">{t("common.step", { step: 2 })}</div>
                  <div className="step-title">{t("wizard.discoverCompatible")}</div>
                </div>
                <span className="badge">
                  {hasModels
                    ? t("wizard.catalogCount", { count: llmOptions.length + sttOptions.length })
                    : t("wizard.noCatalog")}
                </span>
              </div>
              <p className="step-description">
                {t("wizard.platformDescription", {
                  platform: runtimePlatformId ?? t("wizard.thisPlatform")
                })}
              </p>
              <button className="btn" onClick={refreshModels} disabled={!canLoadModels}>
                {t("wizard.refreshModels")}
              </button>
            </div>

            <div className={`step-card ${canChooseDefaults ? "" : "is-disabled"}`}>
              <div className="step-card-header">
                <div>
                  <div className="label">{t("common.step", { step: 3 })}</div>
                  <div className="step-title">{t("wizard.defaults")}</div>
                </div>
                <span className="badge">
                  {defaultsComplete
                    ? t("wizard.defaultsSelected")
                    : t("wizard.waitingSelections")}
                </span>
              </div>
              <p className="step-description">{t("wizard.selectDescription")}</p>
              <div className="grid">
                <div>
                  <div className="label">{t("wizard.defaultLlm")}</div>
                  <select
                    className="select"
                    aria-label={t("model.language")}
                    value={defaults.llm}
                    onChange={(event) => setDefaults((prev) => ({ ...prev, llm: event.target.value }))}
                    disabled={!canChooseDefaults}
                  >
                    <option value="">{t("wizard.selectLlm")}</option>
                    {llmOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.metadata.display.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="label">{t("wizard.defaultStt")}</div>
                  <select
                    className="select"
                    aria-label={t("model.speech")}
                    value={defaults.stt}
                    onChange={(event) => setDefaults((prev) => ({ ...prev, stt: event.target.value }))}
                    disabled={!canChooseDefaults}
                  >
                    <option value="">{t("wizard.selectStt")}</option>
                    {sttOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.metadata.display.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className={`step-card ${defaultsComplete ? "" : "is-disabled"}`}>
              <div className="step-card-header">
                <div>
                  <div className="label">{t("common.step", { step: 4 })}</div>
                  <div className="step-title">{t("model.downloadLoad")}</div>
                </div>
                <span className={`badge ${selectedModelsLoaded ? "badge-success" : ""}`}>
                  {describeModelLoadPhase(effectiveModelLoadPhase, t)}
                </span>
              </div>
              <p className="step-description">{t("model.prepareDescription")}</p>
              <div className="button-row">
                <button
                  className="btn primary"
                  onClick={loadSelectedModels}
                  disabled={!defaultsComplete || modelLoadBusy || !isGatewayRunning}
                >
                  {modelLoadBusy
                    ? modelLoad.phase === "timed_out"
                      ? t("model.continues")
                      : t("model.preparing")
                    : selectedModelsLoaded
                      ? t("model.reload")
                      : t("model.downloadLoad")}
                </button>
                <button
                  className="btn"
                  onClick={() => void refreshRuntimeState()}
                  disabled={!isGatewayRunning || modelLoadBusy}
                >
                  {t("model.refreshReadiness")}
                </button>
              </div>
              {modelLoadProgress}
            </div>

            <div className={`step-card ${canSave ? "" : "is-disabled"}`}>
              <div className="step-card-header">
                <div>
                  <div className="label">{t("common.step", { step: 5 })}</div>
                  <div className="step-title">{t("wizard.save")}</div>
                </div>
                <span className={`badge ${isSaved ? "badge-success" : ""}`}>
                  {isSaved ? t("wizard.preferencesSaved") : t("wizard.notSaved")}
                </span>
              </div>
              <p className="step-description">{t("wizard.saveDefaultsDescription")}</p>
              <div className="inline-row">
                <input
                  id="prefer-local"
                  type="checkbox"
                  checked={preferLocal}
                  onChange={(event) => setPreferLocal(event.target.checked)}
                  disabled={!canSave}
                />
                <label htmlFor="prefer-local" className="text-sm">
                  {t("wizard.preferLocal")}
                </label>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={saveConfig} disabled={!canSave || saveState === "saving"}>
                  {saveState === "saving" ? t("common.saving") : t("wizard.save")}
                </button>
                {saveState === "error" ? (
                  <span className="error-text">{t("wizard.saveFailed")}</span>
                ) : null}
              </div>
              {isSaved ? (
                <div className="success-panel">
                  <span className="badge badge-success">{t("common.saved")}</span>
                  <span>{t("wizard.preferencesReady")}</span>
                </div>
              ) : null}
            </div>

            {isSaved ? (
              <div className="step-card">
                <div className="step-card-header">
                  <div>
                    <div className="label">{t("common.step", { step: 6 })}</div>
                    <div className="step-title">{t("wizard.nextSettings")}</div>
                  </div>
                  <span className="badge">{t("common.ready")}</span>
                </div>
                <p className="step-description">{t("wizard.finishSetup")}</p>
                <div className="button-row">
                  <button className="btn primary" onClick={() => openUrl(settingsUrl)}>
                    {t("connection.openSettings")}
                  </button>
                  <button className="btn" onClick={() => copyText(settingsUrl)}>
                    {t("wizard.copySettingsLink")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="panel">
            <div className="header">
              <div>
                <div className="kicker">{t("logs.kicker")}</div>
                <div className="title">{t("logs.title")}</div>
                <div className="helper-text">{t("logs.privacy")}</div>
              </div>
              <div className="button-row">
                <button className="btn" onClick={() => void refreshLogs()}>
                  {t("logs.refresh")}
                </button>
                <button className="btn" onClick={() => copyText(logs.join("\n"))} disabled={!logs.length}>
                  {t("logs.copy")}
                </button>
                <button className="btn" onClick={() => setLogs([])} disabled={!logs.length}>
                  {t("logs.clear")}
                </button>
                <button className="btn" onClick={() => setAutoScroll((value) => !value)}>
                  {t("logs.autoScroll", {
                    state: autoScroll ? t("common.on") : t("common.off")
                  })}
                </button>
              </div>
            </div>
            {moduleNotFound ? (
              <div className="error-banner">
                <div>{t("logs.importFailure")}</div>
                <div className="button-row">
                  <button
                    className="btn"
                    onClick={runDoctor}
                    disabled={doctorRunState === "running"}
                  >
                    {t("wizard.doctor")}
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      copyText(t("logs.fixSteps"))
                    }
                  >
                    {t("logs.copyFix")}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="log-box" ref={logBoxRef}>
              {logs.length ? logs.join("\n") : t("logs.none")}
            </div>
          </div>

          <div className="panel">
            <div className="header">
              <div>
                <div className="kicker">{t("doctor.kicker")}</div>
                <div className="title">{t("doctor.title")}</div>
              </div>
              <button
                className="btn"
                onClick={runDoctor}
                disabled={doctorRunState === "running"}
              >
                {doctorRunState === "running"
                  ? t("doctor.running")
                  : t("wizard.doctor")}
              </button>
            </div>
            {doctorRunError ? (
              <div className="error-banner" role="alert">
                <div>{doctorRunError}</div>
                <button
                  className="btn"
                  onClick={runDoctor}
                  disabled={doctorRunState === "running"}
                >
                  {t("doctor.retry")}
                </button>
              </div>
            ) : null}
            <div className="grid">
              {!doctorChecks.length ? (
                <div className="helper-text">{t("doctor.none")}</div>
              ) : null}
              {doctorChecks.map((check) => {
                const view = describeDoctorCheck(check, t);
                return (
                  <div key={`${check.code}-${check.status}`} className="panel">
                    <div className="label">{view.title}</div>
                    <div>{view.details}</div>
                    {view.fix ? <p>{t("common.fix", { details: view.fix })}</p> : null}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </aside>
    </div>
  );
};
