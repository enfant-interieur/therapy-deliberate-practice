import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGetTaskQuery, useRunPracticeMutation, useStartSessionMutation } from "../store/api";
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
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<
    Array<{ stage: string; message: string }> | null
  >(null);
  const [nextDifficulty, setNextDifficulty] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const dispatch = useAppDispatch();
  const practice = useAppSelector((state) => state.practice);
  const settings = useAppSelector((state) => state.settings);
  const currentItem = practice.sessionItems[practice.currentIndex];
  const criterionMap = useMemo(() => {
    const entries = task?.criteria?.map((criterion) => [criterion.id, criterion]) ?? [];
    return new Map(entries);
  }, [task?.criteria]);

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

  const startRecording = async () => {
    setError(null);
    setResponseErrors(null);
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
      const result = await runPractice({
        session_item_id: currentItem.session_item_id,
        audio: base64,
        mode: settings.aiMode
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
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{t("practice.responseLabel")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {practice.recordingState !== "recording" ? (
                <button
                  className="rounded-full bg-teal-400 px-6 py-2 text-sm font-semibold text-slate-950"
                  onClick={startRecording}
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
                  {t("practice.nextExample")}
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
