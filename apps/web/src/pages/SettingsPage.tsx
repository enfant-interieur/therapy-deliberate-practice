import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDeleteOpenAiKeyMutation,
  useGetMeSettingsQuery,
  useUpdateMeSettingsMutation,
  useUpdateOpenAiKeyMutation,
  useValidateOpenAiKeyMutation
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { hydrateSettings, setHasOpenAiKey } from "../store/settingsSlice";

export const SettingsPage = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { data, isLoading, isError } = useGetMeSettingsQuery();
  const settings = useAppSelector((state) => state.settings);
  const [saveSettings, { isLoading: isSavingSettings }] = useUpdateMeSettingsMutation();
  const [updateKey, { isLoading: isSavingKey }] = useUpdateOpenAiKeyMutation();
  const [deleteKey, { isLoading: isDeletingKey }] = useDeleteOpenAiKeyMutation();
  const [validateKey, { isLoading: isValidatingKey }] = useValidateOpenAiKeyMutation();

  const [aiMode, setAiMode] = useState(settings.aiMode);
  const [localSttUrl, setLocalSttUrl] = useState(settings.localEndpoints.stt);
  const [localLlmUrl, setLocalLlmUrl] = useState(settings.localEndpoints.llm);
  const [storeAudio, setStoreAudio] = useState(settings.privacy.storeAudio);
  const [openAiKey, setOpenAiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<string | null>(null);
  const [validationStatus, setValidationStatus] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      dispatch(hydrateSettings(data));
    }
  }, [data, dispatch]);

  useEffect(() => {
    setAiMode(settings.aiMode);
    setLocalSttUrl(settings.localEndpoints.stt);
    setLocalLlmUrl(settings.localEndpoints.llm);
    setStoreAudio(settings.privacy.storeAudio);
  }, [settings.aiMode, settings.localEndpoints.llm, settings.localEndpoints.stt, settings.privacy.storeAudio]);

  const handleSaveSettings = async () => {
    setSaveStatus(null);
    try {
      const result = await saveSettings({
        aiMode,
        localSttUrl: localSttUrl.trim() ? localSttUrl.trim() : null,
        localLlmUrl: localLlmUrl.trim() ? localLlmUrl.trim() : null,
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

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm font-semibold">{t("settings.localStt.label")}</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
                value={localSttUrl}
                onChange={(event) => setLocalSttUrl(event.target.value)}
                placeholder={t("settings.localStt.placeholder")}
              />
              <p className="text-xs text-slate-400">{t("settings.localStt.helper")}</p>
            </div>
            <div className="space-y-3">
              <label className="text-sm font-semibold">{t("settings.localLlm.label")}</label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
                value={localLlmUrl}
                onChange={(event) => setLocalLlmUrl(event.target.value)}
                placeholder={t("settings.localLlm.placeholder")}
              />
              <p className="text-xs text-slate-400">{t("settings.localLlm.helper")}</p>
            </div>
          </div>

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
