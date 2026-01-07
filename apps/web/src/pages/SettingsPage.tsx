import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import {
  useDeleteOpenAiKeyMutation,
  useGetMeSettingsQuery,
  useUpdateMeSettingsMutation,
  useUpdateOpenAiKeyMutation,
  useValidateOpenAiKeyMutation
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { hydrateSettings, setHasOpenAiKey } from "../store/settingsSlice";

type DiagnosticStatus = "idle" | "running" | "ok" | "error";

type DiagnosticSnapshot = {
  status: DiagnosticStatus;
  detail?: string;
  timestamp?: number;
};

type LocalRuntimeDiagnostics = {
  health: DiagnosticSnapshot;
  responses: DiagnosticSnapshot;
  stt: DiagnosticSnapshot;
};

type DiagnosticKey = keyof LocalRuntimeDiagnostics;

const SAMPLE_WAV_BASE64 =
  "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";

const createEmptyDiagnostics = (): LocalRuntimeDiagnostics => ({
  health: { status: "idle" },
  responses: { status: "idle" },
  stt: { status: "idle" }
});

const normalizeUrlValue = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const extractOrigin = (value?: string | null) => {
  const normalized = normalizeUrlValue(value);
  if (!normalized) return null;
  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
};

const hasApiPath = (value: string) => {
  try {
    const { pathname } = new URL(value);
    return /\/v1\/[a-z]/i.test(pathname);
  } catch {
    return false;
  }
};

const resolveApiUrl = (overrideUrl: string | null, fallbackBase: string | null, path: string) => {
  const candidate = normalizeUrlValue(overrideUrl) ?? normalizeUrlValue(fallbackBase);
  if (!candidate) {
    throw new Error("Missing URL for local runtime.");
  }
  if (!/^https?:\/\//i.test(candidate)) {
    throw new Error(`Invalid URL: ${candidate}`);
  }
  const normalized = stripTrailingSlash(candidate);
  if (hasApiPath(candidate)) {
    return normalized;
  }
  return `${normalized}${path}`;
};

const decodeSampleAudio = () => {
  const binary = atob(SAMPLE_WAV_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const createSampleAudioFile = () => {
  const bytes = decodeSampleAudio();
  const blob = new Blob([bytes], { type: "audio/wav" });
  if (typeof File !== "undefined") {
    return new File([blob], "diagnostic.wav", { type: "audio/wav" });
  }
  return blob;
};

const truncate = (value: string, limit = 140) => (value.length > limit ? `${value.slice(0, limit)}…` : value);

const summarizeResponsesPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    id?: string;
  };
  if (record.output_text) {
    return truncate(record.output_text);
  }
  const output = record.output ?? [];
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return truncate(content.text.trim());
      }
    }
  }
  return record.id ? `Response #${record.id}` : null;
};

const summarizeTranscriptionPayload = (payload: unknown) => {
  if (typeof payload === "string") {
    return truncate(payload);
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as { text?: string; segments?: Array<{ text?: string }> };
  if (record.text) {
    return truncate(record.text);
  }
  const firstSegment = record.segments?.find((segment) => typeof segment.text === "string" && segment.text.trim());
  return firstSegment ? truncate(firstSegment.text!.trim()) : null;
};

export const SettingsPage = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data, isLoading, isError } = useGetMeSettingsQuery();
  const location = useLocation();
  const settings = useAppSelector((state) => state.settings);
  const [saveSettings, { isLoading: isSavingSettings }] = useUpdateMeSettingsMutation();
  const [updateKey, { isLoading: isSavingKey }] = useUpdateOpenAiKeyMutation();
  const [deleteKey, { isLoading: isDeletingKey }] = useDeleteOpenAiKeyMutation();
  const [validateKey, { isLoading: isValidatingKey }] = useValidateOpenAiKeyMutation();

  const [aiMode, setAiMode] = useState(settings.aiMode);
  const [localAiBaseUrl, setLocalAiBaseUrl] = useState(settings.localAiBaseUrl ?? "");
  const [localSttUrl, setLocalSttUrl] = useState("");
  const [localLlmUrl, setLocalLlmUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [storeAudio, setStoreAudio] = useState(settings.privacy.storeAudio);
  const [diagnostics, setDiagnostics] = useState<LocalRuntimeDiagnostics>(() => createEmptyDiagnostics());
  const [openAiKey, setOpenAiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<string | null>(null);
  const openAiKeyRef = useRef<HTMLInputElement | null>(null);
  const localModeEnabled = aiMode === "local_prefer" || aiMode === "local_only";
  const normalizedBaseUrl = normalizeUrlValue(localAiBaseUrl);
  const normalizedLlmUrl = normalizeUrlValue(localLlmUrl);
  const normalizedSttUrl = normalizeUrlValue(localSttUrl);
  const derivedHealthBase = normalizedBaseUrl ?? extractOrigin(localLlmUrl) ?? extractOrigin(localSttUrl);
  const responsesBaseCandidate = normalizedLlmUrl ?? derivedHealthBase;
  const sttBaseCandidate = normalizedSttUrl ?? derivedHealthBase;
  const hasLocalOverrides = Boolean(normalizedLlmUrl || normalizedSttUrl);
  const diagnosticsAvailable = Boolean(derivedHealthBase || normalizedLlmUrl || normalizedSttUrl);
  const diagnosticsBusy = Object.values(diagnostics).some((check) => check.status === "running");
  const statusBadgeClasses: Record<DiagnosticStatus, string> = {
    idle: "bg-slate-800/70 text-slate-300",
    running: "bg-indigo-500/30 text-indigo-100",
    ok: "bg-emerald-500/30 text-emerald-100",
    error: "bg-rose-500/30 text-rose-100"
  };
  const handleLocalBaseChange = (value: string) => {
    setLocalAiBaseUrl(value);
    if (value.trim()) {
      setLocalLlmUrl("");
      setLocalSttUrl("");
      setShowAdvanced(false);
    }
  };
  const handleLocalLlmChange = (value: string) => {
    if (value.trim()) {
      setLocalAiBaseUrl("");
      setShowAdvanced(true);
    }
    setLocalLlmUrl(value);
  };
  const handleLocalSttChange = (value: string) => {
    if (value.trim()) {
      setLocalAiBaseUrl("");
      setShowAdvanced(true);
    }
    setLocalSttUrl(value);
  };

  useEffect(() => {
    if (data) {
      dispatch(hydrateSettings(data));
    }
  }, [data, dispatch]);

  useEffect(() => {
    setAiMode(settings.aiMode);
    const llm = settings.localEndpoints.llm ?? "";
    const stt = settings.localEndpoints.stt ?? "";
    const baseUrl = settings.localAiBaseUrl ?? "";
    const hasOverrides = Boolean(llm || stt);
    setLocalAiBaseUrl(hasOverrides ? "" : baseUrl);
    setLocalLlmUrl(llm);
    setLocalSttUrl(stt);
    setShowAdvanced(hasOverrides);
    setStoreAudio(settings.privacy.storeAudio);
  }, [
    settings.aiMode,
    settings.localAiBaseUrl,
    settings.localEndpoints.llm,
    settings.localEndpoints.stt,
    settings.privacy.storeAudio
  ]);

  useEffect(() => {
    if (location.hash !== "#openai-key") return;
    const input = openAiKeyRef.current;
    if (!input) return;
    const focusTimer = window.setTimeout(() => {
      input.focus();
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [location.hash]);

  useEffect(() => {
    if (!localModeEnabled) {
      setDiagnostics(createEmptyDiagnostics());
    }
  }, [localModeEnabled]);

  const handleSaveSettings = async () => {
    setSaveStatus(null);
    try {
      const trimmedBase = localAiBaseUrl.trim();
      const trimmedLlm = localLlmUrl.trim();
      const trimmedStt = localSttUrl.trim();
      const hasOverrides = Boolean(trimmedLlm || trimmedStt);
      const result = await saveSettings({
        aiMode,
        localAiBaseUrl: !hasOverrides && trimmedBase ? trimmedBase : null,
        localSttUrl: hasOverrides ? (trimmedStt ? trimmedStt : null) : null,
        localLlmUrl: hasOverrides ? (trimmedLlm ? trimmedLlm : null) : null,
        storeAudio
      }).unwrap();
      dispatch(hydrateSettings(result));
      setSaveStatus(t("settings.status.saved"));
    } catch (error) {
      setSaveStatus(t("settings.status.saveError"));
    }
  };

  const handleSaveKey = async () => {
    setKeyStatus(null);
    setValidationStatus(null);
    if (!openAiKey.trim()) {
      setKeyStatus(t("settings.openAi.keyStatus.missing"));
      return;
    }
    try {
      const result = await updateKey({ openaiApiKey: openAiKey.trim() }).unwrap();
      dispatch(setHasOpenAiKey(result.hasOpenAiKey));
      setOpenAiKey("");
      setKeyStatus(t("settings.openAi.keyStatus.saved"));
    } catch (error) {
      setKeyStatus(t("settings.openAi.keyStatus.saveError"));
    }
  };

  const handleRemoveKey = async () => {
    setKeyStatus(null);
    setValidationStatus(null);
    if (!window.confirm(t("settings.openAi.confirmRemove"))) {
      return;
    }
    try {
      const result = await deleteKey().unwrap();
      dispatch(setHasOpenAiKey(result.hasOpenAiKey));
      setKeyStatus(t("settings.openAi.keyStatus.removed"));
    } catch (error) {
      setKeyStatus(t("settings.openAi.keyStatus.removeError"));
    }
  };

  const handleValidateKey = async () => {
    setValidationStatus(null);
    const typed = openAiKey.trim();

    if (!typed && !settings.hasOpenAiKey) {
      setValidationStatus(t("settings.openAi.validateStatus.missing"));
      return;
    }

    try {
      const result = await validateKey(typed ? { openaiApiKey: typed } : {}).unwrap();
      if (result.ok) {
        setValidationStatus(t("settings.openAi.validateStatus.valid"));
      } else {
        setValidationStatus(result.error ?? t("settings.openAi.validateStatus.invalidFallback"));
      }
    } catch (error) {
      setValidationStatus(t("settings.openAi.validateStatus.error"));
    }
  };

  const updateDiagnostic = (key: DiagnosticKey, updates: Partial<DiagnosticSnapshot>) => {
    setDiagnostics((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...updates,
        ...(updates.status && updates.status !== "running" ? { timestamp: Date.now() } : {})
      }
    }));
  };

  const runHealthCheck = async () => {
    if (!derivedHealthBase) {
      updateDiagnostic("health", { status: "error", detail: t("settings.localDiagnostics.messages.missingBase") });
      return;
    }
    updateDiagnostic("health", { status: "running", detail: undefined });
    try {
      const url = resolveApiUrl(null, derivedHealthBase, "/health");
      const response = await fetch(url);
      const contentType = response.headers.get("content-type") ?? "";
      let payload: Record<string, unknown> | string | null = null;
      if (contentType.includes("application/json")) {
        payload = (await response.json()) as Record<string, unknown>;
      } else {
        payload = await response.text();
      }
      if (!response.ok) {
        const detail =
          typeof payload === "string"
            ? payload || response.statusText
            : ((payload as { detail?: string })?.detail ?? response.statusText);
        throw new Error(detail);
      }
      const record = (payload as {
        status?: string;
        platform_id?: string;
        defaults?: Record<string, string>;
      }) ?? { status: response.status };
      const summary: string[] = [];
      if (record.status) {
        summary.push(`${t("settings.localDiagnostics.healthSummary.status")}: ${record.status}`);
      }
      if (record.platform_id) {
        summary.push(`${t("settings.localDiagnostics.healthSummary.platform")}: ${record.platform_id}`);
      }
      if (record.defaults && typeof record.defaults === "object") {
        const defaultsList = Object.entries(record.defaults)
          .map(([endpoint, model]) => `${endpoint}→${model}`)
          .join(", ");
        if (defaultsList) {
          summary.push(`${t("settings.localDiagnostics.healthSummary.defaults")}: ${defaultsList}`);
        }
      }
      updateDiagnostic("health", {
        status: "ok",
        detail: summary.join(" • ") || t("settings.localDiagnostics.messages.healthOk")
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateDiagnostic("health", {
        status: "error",
        detail: t("settings.localDiagnostics.messages.healthError", { error: message })
      });
    }
  };

  const runResponsesCheck = async () => {
    if (!responsesBaseCandidate) {
      updateDiagnostic("responses", {
        status: "error",
        detail: t("settings.localDiagnostics.messages.missingResponsesUrl")
      });
      return;
    }
    updateDiagnostic("responses", { status: "running", detail: undefined });
    try {
      const url = resolveApiUrl(normalizedLlmUrl, derivedHealthBase, "/v1/responses");
      const payload = {
        stream: false,
        messages: [
          { role: "system", content: "You are a latency probe. Reply with a single short acknowledgement." },
          { role: "user", content: "Respond with the word 'connected' if this request reached you." }
        ]
      };
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");
      const body = isJson ? await response.json() : await response.text();
      if (!response.ok) {
        const message =
          typeof body === "string"
            ? body || response.statusText
            : (body as { error?: string; message?: string }).error ??
              (body as { message?: string }).message ??
              response.statusText;
        throw new Error(message);
      }
      const detail =
        (isJson ? summarizeResponsesPayload(body) : null) ??
        (typeof body === "string" ? truncate(body) : null) ??
        t("settings.localDiagnostics.messages.responsesOk");
      updateDiagnostic("responses", { status: "ok", detail });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateDiagnostic("responses", {
        status: "error",
        detail: t("settings.localDiagnostics.messages.responsesError", { error: message })
      });
    }
  };

  const runSttCheck = async () => {
    if (!sttBaseCandidate) {
      updateDiagnostic("stt", {
        status: "error",
        detail: t("settings.localDiagnostics.messages.missingSttUrl")
      });
      return;
    }
    updateDiagnostic("stt", { status: "running", detail: undefined });
    try {
      const url = resolveApiUrl(normalizedSttUrl, derivedHealthBase, "/v1/audio/transcriptions");
      const fileBlob = createSampleAudioFile();
      const formData = new FormData();
      const fallbackName = "diagnostic.wav";
      const fileName =
        typeof File !== "undefined" && fileBlob instanceof File && fileBlob.name ? fileBlob.name : fallbackName;
      formData.append("file", fileBlob, fileName);
      formData.append("response_format", "json");
      formData.append("stream", "false");
      const response = await fetch(url, {
        method: "POST",
        body: formData
      });
      const contentType = response.headers.get("content-type") ?? "";
      const isJson = contentType.includes("application/json");
      const body = isJson ? await response.json() : await response.text();
      if (!response.ok) {
        const message =
          typeof body === "string"
            ? body || response.statusText
            : (body as { error?: string; detail?: string }).error ??
              (body as { detail?: string }).detail ??
              response.statusText;
        throw new Error(message);
      }
      const detail =
        (isJson ? summarizeTranscriptionPayload(body) : typeof body === "string" ? truncate(body) : null) ??
        t("settings.localDiagnostics.messages.sttOk");
      updateDiagnostic("stt", { status: "ok", detail });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateDiagnostic("stt", {
        status: "error",
        detail: t("settings.localDiagnostics.messages.sttError", { error: message })
      });
    }
  };

  const runAllChecks = async () => {
    await runHealthCheck();
    await runResponsesCheck();
    await runSttCheck();
  };

  const diagnosticCards: Array<{
    key: DiagnosticKey;
    title: string;
    description: string;
    actionLabel: string;
    onClick: () => Promise<void> | void;
    enabled: boolean;
  }> = [
    {
      key: "health",
      title: t("settings.localDiagnostics.checks.health.title"),
      description: t("settings.localDiagnostics.checks.health.description"),
      actionLabel: t("settings.localDiagnostics.actions.health"),
      onClick: runHealthCheck,
      enabled: Boolean(derivedHealthBase)
    },
    {
      key: "responses",
      title: t("settings.localDiagnostics.checks.responses.title"),
      description: t("settings.localDiagnostics.checks.responses.description"),
      actionLabel: t("settings.localDiagnostics.actions.responses"),
      onClick: runResponsesCheck,
      enabled: Boolean(responsesBaseCandidate)
    },
    {
      key: "stt",
      title: t("settings.localDiagnostics.checks.stt.title"),
      description: t("settings.localDiagnostics.checks.stt.description"),
      actionLabel: t("settings.localDiagnostics.actions.stt"),
      onClick: runSttCheck,
      enabled: Boolean(sttBaseCandidate)
    }
  ];


  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{t("settings.tagline")}</p>
        <h2 className="mt-3 text-3xl font-semibold">{t("settings.title")}</h2>
        <p className="mt-3 text-sm text-slate-300">{t("settings.subtitle")}</p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-8">
        {isLoading && <p className="text-sm text-slate-400">{t("settings.loading")}</p>}
        {isError && (
          <p className="text-sm text-rose-300">{t("settings.error")}</p>
        )}
        <div className="space-y-6">
          <div className="space-y-3">
            <label className="text-sm font-semibold">{t("settings.aiMode.label")}</label>
            <p className="text-xs text-slate-400">{t("settings.aiMode.helper")}</p>
            <select
              className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
              value={aiMode}
              onChange={(event) => setAiMode(event.target.value as typeof aiMode)}
            >
              <option value="local_prefer">{t("settings.aiMode.options.localPrefer")}</option>
              <option value="openai_only">{t("settings.aiMode.options.openaiOnly")}</option>
              <option value="local_only">{t("settings.aiMode.options.localOnly")}</option>
            </select>
          </div>

          <div className="space-y-4">
            <div className="space-y-3">
              <label className="text-sm font-semibold">{t("settings.localAiBase.label")}</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
                value={localAiBaseUrl}
                onChange={(event) => handleLocalBaseChange(event.target.value)}
                placeholder={t("settings.localAiBase.placeholder")}
              />
              <p className="text-xs text-slate-400">{t("settings.localAiBase.helper")}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-xs text-slate-300">
              {t("settings.localAiBase.callout")}
            </div>
            <button
              className="text-left text-xs font-semibold text-teal-200 underline decoration-dashed"
              onClick={() => setShowAdvanced((value) => !value)}
            >
              {showAdvanced ? t("settings.localAiBase.advancedHide") : t("settings.localAiBase.advancedShow")}
            </button>
            {!showAdvanced && hasLocalOverrides ? (
              <p className="text-xs text-amber-200">{t("settings.localAiBase.overrideActive")}</p>
            ) : null}
            {showAdvanced ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <label className="text-sm font-semibold">{t("settings.localAiBase.overrideLlmLabel")}</label>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
                    value={localLlmUrl}
                    onChange={(event) => handleLocalLlmChange(event.target.value)}
                    placeholder={t("settings.localAiBase.overrideLlmPlaceholder")}
                  />
                  <p className="text-xs text-slate-400">{t("settings.localAiBase.overrideLlmHelper")}</p>
                </div>
                <div className="space-y-3">
                  <label className="text-sm font-semibold">{t("settings.localAiBase.overrideSttLabel")}</label>
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
                    value={localSttUrl}
                    onChange={(event) => handleLocalSttChange(event.target.value)}
                    placeholder={t("settings.localAiBase.overrideSttPlaceholder")}
                  />
                  <p className="text-xs text-slate-400">{t("settings.localAiBase.overrideSttHelper")}</p>
                </div>
              </div>
            ) : null}
          </div>

          {localModeEnabled ? (
            <div className="rounded-2xl border border-teal-400/30 bg-slate-950/40 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.35em] text-teal-200">
                    {t("settings.localDiagnostics.title")}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">{t("settings.localDiagnostics.subtitle")}</p>
                </div>
                <button
                  className="rounded-full bg-teal-400/90 px-5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={runAllChecks}
                  disabled={!diagnosticsAvailable || diagnosticsBusy}
                >
                  {diagnosticsBusy
                    ? t("settings.localDiagnostics.actions.runAllLoading")
                    : t("settings.localDiagnostics.actions.runAll")}
                </button>
              </div>
              {!diagnosticsAvailable ? (
                <p className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
                  {t("settings.localDiagnostics.missingConfig")}
                </p>
              ) : (
                <div className="mt-6 grid gap-4 lg:grid-cols-3">
                  {diagnosticCards.map((card) => {
                    const snapshot = diagnostics[card.key];
                    return (
                      <div key={card.key} className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{card.title}</p>
                            <p className="text-xs text-slate-400">{card.description}</p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-semibold ${statusBadgeClasses[snapshot.status]}`}
                          >
                            {t(`settings.localDiagnostics.statusLabel.${snapshot.status}`)}
                          </span>
                        </div>
                        <p className="mt-3 min-h-[32px] text-xs text-slate-200">
                          {snapshot.detail ?? t("settings.localDiagnostics.waiting")}
                        </p>
                        <button
                          className="mt-4 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40"
                          onClick={() => card.onClick()}
                          disabled={!card.enabled || diagnosticsBusy}
                        >
                          {card.actionLabel}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="mt-5 text-[11px] uppercase tracking-[0.35em] text-slate-500">
                {t("settings.localDiagnostics.footnote")}
              </p>
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 p-4">
            <div>
              <p className="text-sm font-semibold">{t("settings.storeAudio.label")}</p>
              <p className="text-xs text-slate-400">{t("settings.storeAudio.helper")}</p>
            </div>
            <button
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                storeAudio ? "bg-emerald-400 text-slate-950" : "bg-slate-800 text-slate-200"
              }`}
              onClick={() => setStoreAudio((value) => !value)}
            >
              {storeAudio ? t("settings.storeAudio.enabled") : t("settings.storeAudio.disabled")}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-full bg-teal-400 px-6 py-2 text-sm font-semibold text-slate-950"
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
            >
              {isSavingSettings ? t("settings.actions.saving") : t("settings.actions.save")}
            </button>
            {saveStatus && <span className="text-xs text-slate-300">{saveStatus}</span>}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{t("settings.openAi.title")}</h3>
            <p className="text-sm text-slate-300">
              {settings.hasOpenAiKey
                ? t("settings.openAi.connected")
                : t("settings.openAi.disconnected")}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              settings.hasOpenAiKey ? "bg-emerald-400/20 text-emerald-300" : "bg-amber-400/20 text-amber-200"
            }`}
          >
            {settings.hasOpenAiKey ? t("settings.openAi.status.connected") : t("settings.openAi.status.disconnected")}
          </span>
        </div>

          <div className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <input
                id="openai-key"
                ref={openAiKeyRef}
                className="flex-1 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
                type={showKey ? "text" : "password"}
              placeholder={t("settings.openAi.placeholder")}
              value={openAiKey}
              onChange={(event) => setOpenAiKey(event.target.value)}
            />
            <button
              className="rounded-full border border-white/10 px-4 py-2 text-xs text-slate-200"
              onClick={() => setShowKey((value) => !value)}
            >
              {showKey ? t("settings.openAi.hide") : t("settings.openAi.reveal")}
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full bg-slate-100 px-6 py-2 text-sm font-semibold text-slate-950"
              onClick={handleSaveKey}
              disabled={isSavingKey}
            >
              {isSavingKey ? t("settings.openAi.saveLoading") : t("settings.openAi.save")}
            </button>
            <button
              className="rounded-full border border-white/10 px-6 py-2 text-sm text-slate-200"
              onClick={handleValidateKey}
              disabled={isValidatingKey}
            >
              {isValidatingKey ? t("settings.openAi.validateLoading") : t("settings.openAi.validate")}
            </button>
            <button
              className="rounded-full border border-rose-400/40 px-6 py-2 text-sm text-rose-200"
              onClick={handleRemoveKey}
              disabled={isDeletingKey}
            >
              {isDeletingKey ? t("settings.openAi.removeLoading") : t("settings.openAi.remove")}
            </button>
          </div>
          {keyStatus && <p className="text-xs text-slate-300">{keyStatus}</p>}
          {validationStatus && <p className="text-xs text-slate-300">{validationStatus}</p>}
          <p className="text-xs text-slate-500">
            {t("settings.openAi.securityNote")}
          </p>
        </div>
      </section>
    </div>
  );
};
