import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useGetTaskQuery,
  useGetPracticeSessionsQuery,
  usePrefetchPatientAudioMutation,
  useRunPracticeMutation,
  useStartSessionMutation
} from "../store/api";
import { TalkingPatientCanvas } from "../components/TalkingPatientCanvas";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  resetSessionState,
  setAudioBlobRef,
  setCurrentIndex,
  setEvaluation,
  setRecordingState,
  setSession,
  setTranscript
} from "../store/practiceSlice";

const blobToBase64 = (blob: Blob, errorMessage: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(errorMessage));
        return;
      }
      const base64 = reader.result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error(errorMessage));
    };
    reader.readAsDataURL(blob);
  });

export const PracticePage = () => {
  const { t } = useTranslation();
  const { taskId } = useParams();
  const { data: task } = useGetTaskQuery(taskId ?? "");
  const [startSession, { isLoading: isStartingSession }] = useStartSessionMutation();
  const [runPractice, { isLoading }] = useRunPracticeMutation();
  const [prefetchPatientAudio] = usePrefetchPatientAudioMutation();
  const {
    data: sessionHistory = [],
    isLoading: isLoadingSessions,
    refetch: refetchSessions
  } = useGetPracticeSessionsQuery(
    { task_id: taskId },
    { skip: !taskId }
  );
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<
    Array<{ stage: string; message: string }> | null
  >(null);
  const [nextDifficulty, setNextDifficulty] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [practiceMode, setPracticeMode] = useState<"standard" | "real_time">("standard");
  const [patientAudioStatus, setPatientAudioStatus] = useState<
    "idle" | "generating" | "ready" | "error"
  >("idle");
  const [patientAudioUrl, setPatientAudioUrl] = useState<string | null>(null);
  const [patientCacheKey, setPatientCacheKey] = useState<string | null>(null);
  const [patientSpeaking, setPatientSpeaking] = useState(false);
  const [canRecord, setCanRecord] = useState(true);
  const [hidePatientText, setHidePatientText] = useState(true);
  const [autoPlayPatientAudio, setAutoPlayPatientAudio] = useState(true);
  const [patientAudioError, setPatientAudioError] = useState<string | null>(null);
  const [patientPlay, setPatientPlay] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const patientAudioRef = useRef<HTMLAudioElement | null>(null);
  const previousTaskIdRef = useRef<string | null>(null);
  const hasInitializedRef = useRef(false);
  const dispatch = useAppDispatch();
  const practice = useAppSelector((state) => state.practice);
  const settings = useAppSelector((state) => state.settings);
  const currentItem = practice.sessionItems[practice.currentIndex];
  const currentExampleId = currentItem?.example_id;
  const patientLine = currentItem?.patient_text ?? "";
  const hasCoachReview = Boolean(practice.evaluation);
  const hasPreviousExample = practice.currentIndex > 0;
  const hasNextExample = practice.currentIndex + 1 < practice.sessionItems.length;
  const nextArrowAttention = hasCoachReview && hasNextExample;
  const criterionMap = useMemo(() => {
    const entries = task?.criteria?.map((criterion) => [criterion.id, criterion]) ?? [];
    return new Map(entries);
  }, [task?.criteria]);
  const canStartRecording = practiceMode === "standard" || canRecord;
  const sessionIndexKey = useCallback(
    (sessionId: string) => `practiceSessionProgress:${sessionId}`,
    []
  );
  const formatDate = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }),
    []
  );
  const latestSession = useMemo(() => {
    if (sessionHistory.length === 0) return null;
    return [...sessionHistory].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
  }, [sessionHistory]);
  const activeSession = useMemo(() => {
    if (practice.sessionId) {
      return sessionHistory.find((session) => session.id === practice.sessionId) ?? null;
    }
    return latestSession;
  }, [latestSession, practice.sessionId, sessionHistory]);

  useEffect(() => {
    return () => {
      if (practice.audioBlobRef) {
        URL.revokeObjectURL(practice.audioBlobRef);
      }
    };
  }, [practice.audioBlobRef]);

  const resetSessionUI = useCallback(() => {
    setError(null);
    setResponseErrors(null);
    setNextDifficulty(null);
    setRequestId(null);
    setPatientAudioError(null);
    setPatientAudioStatus("idle");
    setPatientAudioUrl(null);
    setPatientCacheKey(null);
    setPatientSpeaking(false);
    setPatientPlay(false);
    setCanRecord(practiceMode === "standard");
  }, [practiceMode]);

  const startNewSession = useCallback(async () => {
    if (!taskId) return;
    try {
      const result = await startSession({
        mode: "single_task",
        task_id: taskId,
        item_count: 5
      }).unwrap();
      dispatch(resetSessionState());
      dispatch(setSession({ sessionId: result.session_id, items: result.items }));
      dispatch(setCurrentIndex(0));
      resetSessionUI();
      await refetchSessions();
    } catch (err) {
      setError(t("practice.error.sessionFailed"));
    }
  }, [dispatch, refetchSessions, resetSessionUI, startSession, t, taskId]);

  const loadSession = useCallback(
    (sessionId: string, items: typeof practice.sessionItems, fallbackIndex: number) => {
      dispatch(resetSessionState());
      dispatch(setSession({ sessionId, items }));
      const cachedIndex = Number(window.localStorage.getItem(sessionIndexKey(sessionId)));
      const safeIndex =
        Number.isFinite(cachedIndex) && cachedIndex >= 0 && cachedIndex < items.length
          ? cachedIndex
          : fallbackIndex;
      dispatch(setCurrentIndex(safeIndex));
      resetSessionUI();
    },
    [dispatch, resetSessionUI, sessionIndexKey]
  );

  useEffect(() => {
    if (!taskId) return;
    if (!hasInitializedRef.current) {
      dispatch(resetSessionState());
      hasInitializedRef.current = true;
    }
  }, [dispatch, taskId]);

  useEffect(() => {
    if (!taskId) return;
    if (previousTaskIdRef.current && previousTaskIdRef.current !== taskId) {
      dispatch(resetSessionState());
    }
    previousTaskIdRef.current = taskId;
  }, [dispatch, taskId]);

  useEffect(() => {
    if (!taskId) return;
    if (practice.sessionId) return;
    if (isLoadingSessions) return;
    if (latestSession) {
      const fallbackIndex = Math.min(
        latestSession.completed_count,
        Math.max(latestSession.items.length - 1, 0)
      );
      loadSession(latestSession.id, latestSession.items, fallbackIndex);
      return;
    }
    void startNewSession();
  }, [
    isLoadingSessions,
    latestSession,
    loadSession,
    practice.sessionId,
    startNewSession,
    taskId
  ]);

  useEffect(() => {
    if (!practice.sessionId) return;
    window.localStorage.setItem(
      sessionIndexKey(practice.sessionId),
      practice.currentIndex.toString()
    );
  }, [practice.currentIndex, practice.sessionId, sessionIndexKey]);

  useEffect(() => {
    setPatientAudioStatus("idle");
    setPatientAudioUrl(null);
    setPatientCacheKey(null);
    setPatientAudioError(null);
    setPatientSpeaking(false);
    setCanRecord(practiceMode === "standard");
    setPatientPlay(false);
    if (practiceMode === "standard" && patientAudioRef.current) {
      patientAudioRef.current.pause();
      patientAudioRef.current.currentTime = 0;
    }
  }, [practiceMode, currentExampleId]);

  useEffect(() => {
    setPatientPlay(false);
  }, [patientLine]);

  useEffect(() => {
    if (practiceMode !== "real_time" || !taskId || !currentExampleId) return;
    let cancelled = false;
    const runPrefetch = async () => {
      setPatientAudioStatus("generating");
      setPatientAudioError(null);
      setCanRecord(false);
      let attempts = 0;
      while (attempts < 10 && !cancelled) {
        attempts += 1;
        try {
          const result = await prefetchPatientAudio({
            exercise_id: taskId,
            practice_mode: "real_time",
            statement_id: currentExampleId
          }).unwrap();
          if (cancelled) return;
          setPatientCacheKey(result.cache_key);
          if (result.status === "ready" && result.audio_url) {
            setPatientAudioStatus("ready");
            setPatientAudioUrl(result.audio_url);
            return;
          }
          setPatientAudioStatus("generating");
          const retryAfter = result.retry_after_ms ?? 500;
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
        } catch (err) {
          if (cancelled) return;
          setPatientAudioStatus("error");
          setPatientAudioError("Unable to prepare patient audio.");
          setCanRecord(true);
          return;
        }
      }
      if (!cancelled) {
        setPatientAudioStatus("error");
        setPatientAudioError("Patient audio took too long to generate.");
        setCanRecord(true);
      }
    };
    runPrefetch();
    return () => {
      cancelled = true;
    };
  }, [currentExampleId, practiceMode, prefetchPatientAudio, taskId]);

  useEffect(() => {
    if (practiceMode !== "real_time") return;
    if (!autoPlayPatientAudio) return;
    if (patientAudioStatus !== "ready") return;
    if (!patientAudioRef.current) return;
    patientAudioRef.current
      .play()
      .catch(() => setPatientAudioError("Autoplay was blocked. Tap play to begin."));
  }, [autoPlayPatientAudio, patientAudioStatus, practiceMode, patientAudioUrl]);

  const startRecording = async () => {
    setError(null);
    setResponseErrors(null);
    if (practiceMode === "real_time" && !canRecord) {
      setError("Wait for the patient audio to finish before recording.");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      dispatch(setAudioBlobRef(url));
    };
    recorderRef.current = recorder;
    recorder.start();
    dispatch(setRecordingState("recording"));
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    dispatch(setRecordingState("processing"));
  };

  const runEvaluation = async () => {
    if (!currentItem || !practice.audioBlobRef) return;
    try {
      dispatch(setRecordingState("processing"));
      setError(null);
      setResponseErrors(null);
      const response = await fetch(practice.audioBlobRef);
      const blob = await response.blob();
      if (!blob.size) {
        setError(t("practice.error.noAudio"));
        dispatch(setRecordingState("ready"));
        return;
      }
      const base64 = await blobToBase64(blob, t("practice.error.readAudio"));
      const turnContext =
        practiceMode === "real_time"
          ? {
              patient_cache_key: patientCacheKey ?? undefined,
              patient_statement_id: currentExampleId
            }
          : undefined;
      const result = await runPractice({
        session_item_id: currentItem.session_item_id,
        audio: base64,
        mode: settings.aiMode,
        practice_mode: practiceMode,
        turn_context: turnContext
      }).unwrap();
      setRequestId(result.requestId ?? null);
      setResponseErrors(result.errors ?? null);
      setNextDifficulty(result.next_recommended_difficulty ?? null);
      dispatch(setEvaluation(result.scoring?.evaluation));
      dispatch(setTranscript(result.transcript?.text));
      dispatch(setRecordingState("ready"));
    } catch (err) {
      const message =
        typeof err === "object" && err && "data" in err && (err as { data?: { error?: string } }).data
          ? (err as { data?: { error?: string } }).data?.error
          : null;
      const errorData =
        typeof err === "object" && err && "data" in err
          ? (err as {
              data?: {
                requestId?: string;
                errors?: Array<{ stage: string; message: string }>;
              };
            }).data
          : undefined;
      if (errorData?.requestId) {
        setRequestId(errorData.requestId);
      }
      if (errorData?.errors) {
        setResponseErrors(errorData.errors);
      }
      setError(message ?? t("practice.error.evaluateFailed"));
      dispatch(setEvaluation(undefined));
      dispatch(setTranscript(undefined));
      dispatch(setRecordingState("ready"));
    }
  };

  const handleNextExample = () => {
    const nextIndex = practice.currentIndex + 1;
    if (nextIndex < practice.sessionItems.length) {
      dispatch(setCurrentIndex(nextIndex));
      dispatch(setEvaluation(undefined));
      dispatch(setTranscript(undefined));
      setResponseErrors(null);
      setRequestId(null);
      setNextDifficulty(null);
    }
  };

  const handlePreviousExample = () => {
    const prevIndex = practice.currentIndex - 1;
    if (prevIndex >= 0) {
      dispatch(setCurrentIndex(prevIndex));
      dispatch(setEvaluation(undefined));
      dispatch(setTranscript(undefined));
      setResponseErrors(null);
      setRequestId(null);
      setNextDifficulty(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          {practiceMode === "standard" ? (
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/90 to-slate-900/70 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.8)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Patient prompt</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Previous example"
                    className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={handlePreviousExample}
                    disabled={!hasPreviousExample}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:-translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-200 shadow-[0_0_15px_rgba(45,212,191,0.25)]">
                    {t("practice.itemProgress", {
                      index: practice.currentIndex + 1,
                      total: practice.sessionItems.length || 0
                    })}
                  </span>
                  <button
                    type="button"
                    aria-label="Next example"
                    className={`group relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-teal-400/30 via-white/5 to-transparent text-slate-100 shadow-[0_0_15px_rgba(45,212,191,0.35)] transition hover:border-teal-200/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                      nextArrowAttention ? "animate-[pulse_3s_ease-in-out_infinite]" : ""
                    }`}
                    onClick={handleNextExample}
                    disabled={!hasNextExample}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    {nextArrowAttention && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
                    )}
                  </button>
                </div>
              </div>
              <p className="mt-6 text-2xl font-semibold leading-relaxed text-slate-100 md:text-3xl">
                {currentItem?.patient_text ?? t("practice.loadingScenario")}
              </p>
            </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/90 to-slate-900/70 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.8)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Patient audio</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Previous patient turn"
                    className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={handlePreviousExample}
                    disabled={!hasPreviousExample}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:-translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-200 shadow-[0_0_15px_rgba(45,212,191,0.25)]">
                    {t("practice.itemProgress", {
                      index: practice.currentIndex + 1,
                      total: practice.sessionItems.length || 0
                    })}
                  </span>
                  <button
                    type="button"
                    aria-label="Next patient turn"
                    className={`group relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-teal-400/30 via-white/5 to-transparent text-slate-100 shadow-[0_0_15px_rgba(45,212,191,0.35)] transition hover:border-teal-200/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                      nextArrowAttention ? "animate-[pulse_3s_ease-in-out_infinite]" : ""
                    }`}
                    onClick={handleNextExample}
                    disabled={!hasNextExample}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    {nextArrowAttention && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(45,212,191,0.8)]" />
                    )}
                  </button>
                </div>
              </div>
              {!hidePatientText && (
                <p className="mt-6 text-2xl font-semibold leading-relaxed text-slate-100 md:text-3xl">
                  {currentItem?.patient_text ?? t("practice.loadingScenario")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase text-slate-400">
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-3 py-1 text-xs hover:border-white/40"
                  onClick={() => setHidePatientText((prev) => !prev)}
                >
                  {hidePatientText ? "Show transcript" : "Hide transcript"}
                </button>
                {patientSpeaking && <span className="text-amber-200">Patient speaking…</span>}
              </div>
              <div className="mt-5 space-y-4">
                <TalkingPatientCanvas
                  text={patientLine}
                  play={patientPlay}
                  reaction={practice.patientReaction}
                  onDone={() => setPatientPlay(false)}
                />
                {patientAudioStatus === "generating" && (
                  <p className="text-sm text-slate-300">Generating patient audio…</p>
                )}
                {patientAudioError && (
                  <p className="text-sm text-rose-300">{patientAudioError}</p>
                )}
                {patientAudioUrl && (
                  <div className="space-y-3">
                    <audio
                      ref={patientAudioRef}
                      className="audio-player w-full"
                      controls
                      src={patientAudioUrl}
                      onPlay={() => {
                        setPatientSpeaking(true);
                        setPatientPlay(true);
                        setCanRecord(false);
                      }}
                      onPause={() => {
                        setPatientSpeaking(false);
                        setPatientPlay(false);
                      }}
                      onEnded={() => {
                        setPatientSpeaking(false);
                        setPatientPlay(false);
                        setCanRecord(true);
                      }}
                    />
                    <button
                      type="button"
                      className="rounded-full border border-white/20 px-4 py-2 text-xs hover:border-white/40"
                      onClick={() =>
                        patientAudioRef.current
                          ?.play()
                          .catch(() => setPatientAudioError("Unable to play patient audio."))
                      }
                    >
                      Play patient
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{t("practice.responseLabel")}</p>
            {practiceMode === "real_time" && !canRecord && (
              <p className="mt-2 text-xs text-slate-400">Listen to the patient before recording.</p>
            )}
            <div className="mt-4 flex flex-wrap gap-3">
              {practice.recordingState !== "recording" ? (
                <button
                  className="rounded-full bg-teal-400 px-6 py-2 text-sm font-semibold text-slate-950"
                  onClick={startRecording}
                  disabled={!canStartRecording}
                >
                  {t("practice.startRecording")}
                </button>
              ) : (
                <button
                  className="rounded-full bg-rose-400 px-6 py-2 text-sm font-semibold text-slate-950"
                  onClick={stopRecording}
                >
                  {t("practice.stopRecording")}
                </button>
              )}
              <button
                className="rounded-full border border-white/20 px-6 py-2 text-sm"
                onClick={runEvaluation}
                disabled={!practice.audioBlobRef || isLoading || isStartingSession || !currentItem}
              >
                {isLoading ? t("practice.evaluating") : t("practice.runEvaluation")}
              </button>
            </div>
            {practice.audioBlobRef && (
              <audio className="audio-player mt-4 w-full" controls src={practice.audioBlobRef} />
            )}
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{t("practice.transcriptTitle")}</h3>
              <button
                className="rounded-full border border-white/20 px-4 py-1 text-xs"
                onClick={() => practice.transcript && navigator.clipboard.writeText(practice.transcript)}
                disabled={!practice.transcript}
              >
                {t("practice.copyTranscript")}
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">
              {practice.transcript || t("practice.transcriptPlaceholder")}
            </p>
            {requestId && (
              <p className="mt-3 text-xs text-slate-400">{t("practice.requestId", { id: requestId })}</p>
            )}
          </div>
          {(responseErrors?.length ?? 0) > 0 && (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-6">
              <h3 className="text-lg font-semibold text-rose-100">{t("practice.snagTitle")}</h3>
              <ul className="mt-3 space-y-2 text-sm text-rose-100">
                {responseErrors?.map((entry, index) => (
                  <li key={`${entry.stage}-${index}`}>
                    <span className="font-semibold uppercase text-xs">{entry.stage}</span>:{" "}
                    {entry.message}
                  </li>
                ))}
              </ul>
              {requestId && (
                <p className="mt-3 text-xs text-rose-100/80">{t("practice.requestId", { id: requestId })}</p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-6">
          <details className="group rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-white">
              <span>{task?.title ?? "Loading exercise..."}</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-slate-200 transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-5 space-y-4 text-sm text-slate-300">
              {task?.description && <p className="text-sm text-slate-200">{task.description}</p>}
              {task?.general_objective && (
                <p className="text-xs text-slate-400">{task.general_objective}</p>
              )}
              <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1">
                  Base difficulty: {task?.base_difficulty ?? "--"}
                </span>
                {task?.skill_domain && (
                  <span className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1">
                    {task.skill_domain}
                  </span>
                )}
                {(task?.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </details>
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Task criteria</p>
              <div className="mt-4 space-y-3">
                {task?.criteria?.map((criterion, index) => (
                  <div
                    key={criterion.id}
                    className="rounded-2xl border border-white/10 bg-slate-900/50 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-teal-300/40 bg-teal-400/10 text-xs font-semibold text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.35)]">
                        {index + 1}
                      </span>
                      <p className="text-sm font-semibold text-white">{criterion.label}</p>
                    </div>
                    <p className="mt-2 text-xs text-slate-300">{criterion.description}</p>
                  </div>
                ))}
                {!task?.criteria?.length && (
                  <p className="text-xs text-slate-400">No criteria available.</p>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold">{t("practice.title")}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  practiceMode === "standard"
                    ? "bg-teal-400 text-slate-950"
                    : "border border-white/20 text-slate-200"
                }`}
                onClick={() => setPracticeMode("standard")}
              >
                Standard
              </button>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  practiceMode === "real_time"
                    ? "bg-teal-400 text-slate-950"
                    : "border border-white/20 text-slate-200"
                }`}
                onClick={() => setPracticeMode("real_time")}
              >
                Real Time Mode
              </button>
            </div>
            {practiceMode === "real_time" && (
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-200">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoPlayPatientAudio}
                    onChange={(event) => setAutoPlayPatientAudio(event.target.checked)}
                  />
                  Auto-play patient audio
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hidePatientText}
                    onChange={(event) => setHidePatientText(event.target.checked)}
                  />
                  Hide patient text (audio only)
                </label>
              </div>
            )}
          </div>
          <details className="group rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-white">
              <span>Session history</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-slate-200 transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-4 space-y-3">
              {activeSession && (
                <div className="rounded-2xl border border-teal-400/40 bg-teal-500/10 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      Session {activeSession.id.slice(0, 6).toUpperCase()}
                    </p>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                      {activeSession.completed_count >= activeSession.item_count
                        ? "Completed"
                        : "In progress"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>{formatDate.format(new Date(activeSession.created_at))}</span>
                    <span>
                      {activeSession.completed_count}/{activeSession.item_count} examples
                    </span>
                  </div>
                </div>
              )}
              {!activeSession && isLoadingSessions && (
                <p className="text-sm text-slate-400">Loading sessions…</p>
              )}
              {!activeSession && !isLoadingSessions && (
                <p className="text-sm text-slate-400">No sessions yet.</p>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-300">Browse all sessions or start a new one.</p>
              <button
                type="button"
                className="rounded-full bg-teal-400 px-4 py-2 text-xs font-semibold text-slate-950"
                onClick={startNewSession}
                disabled={isStartingSession}
              >
                New session
              </button>
            </div>
            <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-2">
              {isLoadingSessions && sessionHistory.length === 0 && (
                <p className="text-sm text-slate-400">Loading sessions…</p>
              )}
              {!isLoadingSessions && sessionHistory.length === 0 && (
                <p className="text-sm text-slate-400">No sessions yet.</p>
              )}
              {sessionHistory.map((session) => {
                const isActive = session.id === practice.sessionId;
                const fallbackIndex = Math.min(
                  session.completed_count,
                  Math.max(session.items.length - 1, 0)
                );
                return (
                  <button
                    key={session.id}
                    type="button"
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-teal-400/70 bg-teal-500/10"
                        : "border-white/10 bg-slate-900/40 hover:border-white/30"
                    }`}
                    onClick={() => loadSession(session.id, session.items, fallbackIndex)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-white">
                        Session {session.id.slice(0, 6).toUpperCase()}
                      </p>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase text-slate-300">
                        {session.completed_count >= session.item_count ? "Completed" : "In progress"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      <span>{formatDate.format(new Date(session.created_at))}</span>
                      <span>
                        {session.completed_count}/{session.item_count} examples
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </details>
          {practice.evaluation && (
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold">{t("practice.coachFeedback")}</h3>
              <p className="mt-3 text-sm text-slate-300">{practice.evaluation.overall.summary_feedback}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {practice.evaluation.overall.what_to_improve_next.map((tip) => (
                  <span key={tip} className="rounded-full border border-white/10 px-3 py-1 text-xs">
                    {tip}
                  </span>
                ))}
              </div>
              {typeof nextDifficulty === "number" && (
                <p className="mt-3 text-xs text-slate-400">
                  {t("practice.recommendedDifficulty", { difficulty: nextDifficulty })}
                </p>
              )}
              {practice.evaluation && (
                <button
                  type="button"
                  className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm"
                  onClick={handleNextExample}
                  disabled={practice.currentIndex + 1 >= practice.sessionItems.length}
                >
                  {practiceMode === "real_time" ? "Next patient turn" : t("practice.nextExample")}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {practice.evaluation && (
        <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h3 className="text-lg font-semibold">{t("practice.scoringTitle")}</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {practice.evaluation.criterion_scores.map((score) => {
              const criterion = criterionMap.get(score.criterion_id);
              return (
              <div key={score.criterion_id} className="rounded-2xl border border-white/10 p-4">
                <p className="text-sm font-semibold">
                  {criterion?.label ?? t("practice.criterionLabel", { id: score.criterion_id })}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("practice.scoreLabel", { score: score.score })}
                </p>
                <p className="mt-2 text-sm text-slate-200">{score.rationale_short}</p>
              </div>
            )})}
          </div>
        </section>
      )}
    </div>
  );
};
