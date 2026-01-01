import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  useGetTaskQuery,
  usePrefetchPatientAudioMutation,
  useRunPracticeMutation,
  useStartSessionMutation
} from "../store/api";
import { PatientCanvas } from "../components/PatientCanvas";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
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
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const patientAudioRef = useRef<HTMLAudioElement | null>(null);
  const dispatch = useAppDispatch();
  const practice = useAppSelector((state) => state.practice);
  const settings = useAppSelector((state) => state.settings);
  const currentItem = practice.sessionItems[practice.currentIndex];
  const currentExampleId = currentItem?.example_id;
  const criterionMap = useMemo(() => {
    const entries = task?.criteria?.map((criterion) => [criterion.id, criterion]) ?? [];
    return new Map(entries);
  }, [task?.criteria]);
  const canStartRecording = practiceMode === "standard" || canRecord;

  useEffect(() => {
    return () => {
      if (practice.audioBlobRef) {
        URL.revokeObjectURL(practice.audioBlobRef);
      }
    };
  }, [practice.audioBlobRef]);

  useEffect(() => {
    if (!taskId) return;
    if (practice.sessionId) return;
    const cached = window.localStorage.getItem(`practiceSession:${taskId}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          session_id: string;
          items: Array<{
            session_item_id: string;
            task_id: string;
            example_id: string;
            target_difficulty: number;
            patient_text: string;
          }>;
          current_index?: number;
        };
        if (parsed.session_id && parsed.items?.length) {
          dispatch(setSession({ sessionId: parsed.session_id, items: parsed.items }));
          if (typeof parsed.current_index === "number" && parsed.current_index < parsed.items.length) {
            dispatch(setCurrentIndex(parsed.current_index));
          }
          return;
        }
      } catch {
        window.localStorage.removeItem(`practiceSession:${taskId}`);
      }
    }
  }, [dispatch, practice.sessionId, taskId]);

  useEffect(() => {
    if (!taskId) return;
    if (practice.sessionId && practice.sessionItems.length > 0) return;
    (async () => {
      try {
        const result = await startSession({
          mode: "single_task",
          task_id: taskId,
          item_count: 5
        }).unwrap();
        dispatch(setSession({ sessionId: result.session_id, items: result.items }));
        window.localStorage.setItem(
          `practiceSession:${taskId}`,
          JSON.stringify({ session_id: result.session_id, items: result.items, current_index: 0 })
        );
      } catch (err) {
        setError(t("practice.error.sessionFailed"));
      }
    })();
  }, [dispatch, practice.sessionId, practice.sessionItems.length, startSession, t, taskId]);

  useEffect(() => {
    if (!taskId || !practice.sessionId || !practice.sessionItems.length) return;
    window.localStorage.setItem(
      `practiceSession:${taskId}`,
      JSON.stringify({
        session_id: practice.sessionId,
        items: practice.sessionItems,
        current_index: practice.currentIndex
      })
    );
  }, [practice.currentIndex, practice.sessionId, practice.sessionItems, taskId]);

  useEffect(() => {
    setPatientAudioStatus("idle");
    setPatientAudioUrl(null);
    setPatientCacheKey(null);
    setPatientAudioError(null);
    setPatientSpeaking(false);
    setCanRecord(practiceMode === "standard");
    if (practiceMode === "standard" && patientAudioRef.current) {
      patientAudioRef.current.pause();
      patientAudioRef.current.currentTime = 0;
    }
  }, [practiceMode, currentExampleId]);

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

  return (
    <div className="space-y-8">
      <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-2xl font-semibold">{t("practice.title")}</h2>
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

          {practiceMode === "standard" ? (
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold">Scenario</h3>
              <p className="mt-2 text-sm text-slate-300">
                {currentItem?.patient_text ?? t("practice.loadingScenario")}
              </p>
              <p className="mt-3 text-xs uppercase text-slate-400">
                {t("practice.itemProgress", {
                  index: practice.currentIndex + 1,
                  total: practice.sessionItems.length || 0
                })}
              </p>
            </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Patient</h3>
                <span className="text-xs uppercase text-slate-400">
                  {t("practice.itemProgress", {
                    index: practice.currentIndex + 1,
                    total: practice.sessionItems.length || 0
                  })}
                </span>
              </div>
              {!hidePatientText && (
                <p className="mt-2 text-sm text-slate-300">
                  {currentItem?.patient_text ?? t("practice.loadingScenario")}
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs uppercase text-slate-400">
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-3 py-1 text-xs"
                  onClick={() => setHidePatientText((prev) => !prev)}
                >
                  {hidePatientText ? "Show transcript" : "Hide transcript"}
                </button>
                {patientSpeaking && <span className="text-amber-200">Patient speaking…</span>}
              </div>
              {patientAudioStatus === "generating" && (
                <p className="mt-3 text-sm text-slate-300">Generating patient audio…</p>
              )}
              {patientAudioError && <p className="mt-3 text-sm text-rose-300">{patientAudioError}</p>}
              {patientAudioUrl && (
                <div className="mt-4 space-y-3">
                  <audio
                    ref={patientAudioRef}
                    className="w-full"
                    controls
                    src={patientAudioUrl}
                    onPlay={() => {
                      setPatientSpeaking(true);
                      setCanRecord(false);
                    }}
                    onPause={() => setPatientSpeaking(false)}
                    onEnded={() => {
                      setPatientSpeaking(false);
                      setCanRecord(true);
                    }}
                  />
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-4 py-2 text-xs"
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
              <audio className="mt-4 w-full" controls src={practice.audioBlobRef} />
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
          <PatientCanvas reaction={practice.patientReaction} />
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
