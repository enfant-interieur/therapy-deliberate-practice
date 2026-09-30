import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Translator } from "../i18n";
import { confirmModelPreparation } from "../lib/modelPreparation";

export type InventoryModel = {
  id: string; title: string; kind: string; endpoint: string; compatible: boolean;
  ram_gb: number; memory_suitable: boolean; provider: string; license: string;
  languages: string[]; revision: string; source: string; loaded: boolean;
  loading: boolean; active_requests: number;
  assets: { state: "cached" | "partial" | "missing"; completed_bytes: number; total_bytes: number };
};
export type ModelInventory = {
  platform_id: string;
  resources: { memory_bytes: number | null; cache_free_bytes: number };
  models: InventoryModel[];
};
type PreparationJob = {
  id: string; status: string; cancellation_requested?: boolean;
  models: { model_id: string; status: string; stage: string; completed_bytes: number; total_bytes: number; error?: string }[];
};

const formatBytes = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(2)} GB`;

export function ModelLibrary({ enabled, selected, onChoose, onChanged, busy, t }: {
  enabled: boolean; selected: { llm: string; stt: string };
  onChoose: (selection: { llm: string; stt: string }) => void;
  onChanged: () => Promise<unknown>; busy: boolean; t: Translator;
}) {
  const [inventory, setInventory] = useState<ModelInventory | null>(null);
  const [job, setJob] = useState<PreparationJob | null>(null);
  const [action, setAction] = useState(false);
  const [inventoryError, setInventoryError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const mounted = useRef(true);
  const connectionEpoch = useRef(0);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    const epoch = connectionEpoch.current;
    try {
      const next = await invoke<ModelInventory>("gateway_model_inventory");
      if (mounted.current && epoch === connectionEpoch.current && next?.models) { setInventory(next); setInventoryError(false); }
    } catch { if (mounted.current && epoch === connectionEpoch.current) setInventoryError(true); }
  }, [enabled]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    connectionEpoch.current += 1;
    if (!enabled) { setInventory(null); setJob(null); setAction(false); return; }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { connectionEpoch.current += 1; window.clearInterval(timer); };
  }, [enabled, refresh]);
  useEffect(() => {
    if (!enabled || !job || !["pending", "running"].includes(job.status)) return;
    const epoch = connectionEpoch.current;
    const timer = window.setInterval(() => {
      void invoke<PreparationJob>("gateway_model_load_status", { payload: { job_id: job.id } }).then(async (next) => {
        if (!mounted.current || epoch !== connectionEpoch.current) return;
        setJob(next);
        if (!["pending", "running"].includes(next.status)) { await refresh(); await onChanged(); }
      }).catch(() => { if (mounted.current && epoch === connectionEpoch.current) { setInventoryError(true); setJob((previous) => previous ? { ...previous, status: "interrupted" } : null); } });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, job, onChanged, refresh]);
  const working = action || busy || Boolean(job && ["pending", "running"].includes(job.status));
  const compatible = inventory?.models.filter((model) => model.compatible) ?? [];
  const resolveProfile = (quality: boolean) => {
    const llm = compatible.find((model) => model.id === (quality ? "local//llm/qwen35-9b-mlx" : "local//llm/qwen35-2b-mlx"))
      ?? compatible.find((model) => model.kind === "llm");
    const stt = compatible.find((model) => model.id === (quality ? "local//stt/parakeet-mlx" : "local//stt/faster-whisper"))
      ?? compatible.find((model) => model.kind === "stt");
    return stt ? { llm, stt } : null;
  };
  const compact = resolveProfile(false);
  const quality = resolveProfile(true);
  const selectProfile = (profile: ReturnType<typeof resolveProfile>) => {
    if (profile) onChoose({ llm: profile.llm?.id ?? "", stt: profile.stt.id });
  };
  const actionErrorKey = (failure: unknown) => {
    const message = failure instanceof Error ? failure.message : String(failure);
    for (const key of ["library.memoryWarning", "library.diskWarning"]) if (message === t(key)) return key;
    return /409|busy|active inference|still loading/i.test(message) ? "library.busyError" : "library.prepareError";
  };
  const prepare = async (model: InventoryModel) => {
    const epoch = connectionEpoch.current;
    setAction(true); setActionError(null);
    try {
      if (!await confirmModelPreparation([model.id], t)) return;
      if (!mounted.current || epoch !== connectionEpoch.current) return;
      const created = await invoke<{ status: PreparationJob }>("gateway_load_models", { payload: { models: [model.id] } });
      if (!mounted.current || epoch !== connectionEpoch.current) return;
      setJob(created.status);
      await refresh();
    } catch (failure) { if (mounted.current && epoch === connectionEpoch.current) setActionError(actionErrorKey(failure)); } finally { if (mounted.current && epoch === connectionEpoch.current) setAction(false); }
  };
  const unload = async (model: InventoryModel) => {
    const epoch = connectionEpoch.current;
    setAction(true); setActionError(null);
    try {
      await invoke("gateway_unload_model", { payload: { model: model.id } });
      if (!mounted.current || epoch !== connectionEpoch.current) return;
      await refresh(); await onChanged();
    } catch (failure) { if (mounted.current && epoch === connectionEpoch.current) setActionError(actionErrorKey(failure)); } finally { if (mounted.current && epoch === connectionEpoch.current) setAction(false); }
  };
  return <section className="model-library" aria-label={t("library.title")}>
    <div className="library-heading"><div><div className="kicker">{t("library.kicker")}</div><h2>{t("library.title")}</h2></div>
      {inventory ? <div className="resource-pills"><span>{t("library.memory", { size: inventory.resources.memory_bytes ? formatBytes(inventory.resources.memory_bytes) : t("library.unknown") })}</span><span>{t("library.disk", { size: formatBytes(inventory.resources.cache_free_bytes) })}</span></div> : null}
    </div>
    <p className="helper-text">{t("library.intro")}</p>
    {!enabled ? <p className="library-empty">{t("library.startFirst")}</p> : inventory ? <>
      <div className="profile-options">
        <button className="profile-option" disabled={working} onClick={() => selectProfile(compact)}><strong>{t(compact?.llm ? "library.compact" : "library.speechProfile")}</strong><span>{[compact?.llm?.title, compact?.stt.title].filter(Boolean).join(" + ")}</span></button>
        {quality && (quality.llm?.id !== compact?.llm?.id || quality.stt.id !== compact?.stt.id) ? <button className="profile-option" disabled={working} onClick={() => selectProfile(quality)}><strong>{t("library.quality")}</strong><span>{[quality.llm?.title, quality.stt.title].filter(Boolean).join(" + ")}</span></button> : null}
      </div>
      {!compatible.some((model) => model.kind === "llm") ? <p className="notice">{t("library.speechOnly")}</p> : null}
      <div className="model-card-grid">{compatible.map((model) => {
        const selectedModel = model.id === selected.llm || model.id === selected.stt;
        const progress = job?.models.find((item) => item.model_id === model.id);
        return <article className={`model-card ${selectedModel ? "selected" : ""}`} key={model.id}>
          <div className="model-card-top"><span className="model-kind">{t(model.kind === "llm" ? "library.language" : "library.speech")}</span><span className="model-state">{t(model.loaded ? "library.loaded" : model.loading ? "library.loading" : `library.${model.assets.state}`)}</span></div>
          <h3>{model.title}</h3><p className="model-facts">{formatBytes(model.assets.total_bytes)} · {t("library.ram", { size: model.ram_gb })} · {model.provider.toUpperCase()}</p>
          <p className="model-license">{model.languages.join(" / ").toUpperCase()} · {model.license}</p>
          {!model.memory_suitable ? <p className="error-text">{t("library.memoryWarning")}</p> : null}
          {progress && ["pending", "loading"].includes(progress.status) ? <div className="asset-progress" role="status"><span>{t(`library.stage.${progress.stage || "pending"}`)}</span>{progress.total_bytes > 0 ? <><progress max={progress.total_bytes} value={progress.completed_bytes} /><small>{t("library.completedFiles", { done: formatBytes(progress.completed_bytes), total: formatBytes(progress.total_bytes) })}</small></> : null}</div> : null}
          {progress?.error ? <p className="error-text">{t("library.prepareError")}</p> : null}
          <div className="model-card-actions"><button className="btn ghost" disabled={working || selectedModel} onClick={() => onChoose({ ...selected, [model.kind === "llm" ? "llm" : "stt"]: model.id })}>{t(selectedModel ? "library.selected" : "library.select")}</button>
            {model.loaded ? <button className="btn" disabled={working || model.active_requests > 0} onClick={() => void unload(model)}>{t("library.unload")}</button> : <button className="btn" disabled={working || model.loading || !model.memory_suitable} onClick={() => void prepare(model)}>{t(model.assets.state === "cached" ? "library.load" : "library.download")}</button>}
          </div>
        </article>;
      })}</div>
      {job && ["pending", "running"].includes(job.status) ? <div className="preparation-footer"><p>{t(job.cancellation_requested ? "library.cancelRequested" : "library.cancelBoundary")}</p><button className="btn ghost" disabled={job.cancellation_requested} onClick={() => void invoke<PreparationJob>("gateway_cancel_model_load", { payload: { job_id: job.id } }).then(setJob).catch((failure) => setActionError(actionErrorKey(failure)))}>{t("library.cancel")}</button></div> : null}
      {job?.status === "cancelled" ? <p role="status">{t("library.cancelled")}</p> : null}
    </> : <p role="status">{t("library.checking")}</p>}
    {inventoryError ? <div className="library-error" role="alert"><p>{t("library.inventoryError")}</p><button className="btn" onClick={() => void refresh()}>{t("common.refresh")}</button></div> : null}
    {actionError ? <p className="error-text" role="alert">{t(actionError)}</p> : null}
    <p className="privacy-note">{t("library.privacy")}</p>
  </section>;
}
