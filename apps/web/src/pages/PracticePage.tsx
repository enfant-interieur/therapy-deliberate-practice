import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useGetExerciseQuery, useRunPracticeMutation } from "../store/api";
import { PatientCanvas } from "../components/PatientCanvas";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  setAudioBlobRef,
  setEvaluation,
  setRecordingState,
  setTranscript
} from "../store/practiceSlice";

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to read audio data."));
        return;
      }
      const base64 = reader.result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Unable to read audio data."));
    };
    reader.readAsDataURL(blob);
  });

export const PracticePage = () => {
  const { id } = useParams();
  const { data: exercise } = useGetExerciseQuery(id ?? "");
  const [runPractice, { isLoading }] = useRunPracticeMutation();
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<
    Array<{ stage: string; message: string }> | null
  >(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const dispatch = useAppDispatch();
  const practice = useAppSelector((state) => state.practice);
  const settings = useAppSelector((state) => state.settings);

  useEffect(() => {
    return () => {
      if (practice.audioBlobRef) {
        URL.revokeObjectURL(practice.audioBlobRef);
      }
    };
  }, [practice.audioBlobRef]);

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
    if (!exercise || !practice.audioBlobRef) return;
    try {
      dispatch(setRecordingState("processing"));
      setError(null);
      setResponseErrors(null);
      const response = await fetch(practice.audioBlobRef);
      const blob = await response.blob();
      if (!blob.size) {
        setError("No audio captured. Please record again.");
        dispatch(setRecordingState("ready"));
        return;
      }
      const base64 = await blobToBase64(blob);
      const result = await runPractice({
        exercise_id: exercise.id,
        audio: base64,
        mode: settings.aiMode
      }).unwrap();
      setRequestId(result.requestId ?? null);
      setResponseErrors(result.errors ?? null);
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
      setError(message ?? "Unable to evaluate response. Please try again.");
      dispatch(setEvaluation(undefined));
      dispatch(setTranscript(undefined));
      dispatch(setRecordingState("ready"));
    }
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-2xl font-semibold">Practice session</h2>
            <p className="mt-2 text-sm text-slate-300">
              {exercise?.example_prompt ?? "Loading scenario..."}
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Your response</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {practice.recordingState !== "recording" ? (
                <button
                  className="rounded-full bg-teal-400 px-6 py-2 text-sm font-semibold text-slate-950"
                  onClick={startRecording}
                >
                  Start recording
                </button>
              ) : (
                <button
                  className="rounded-full bg-rose-400 px-6 py-2 text-sm font-semibold text-slate-950"
                  onClick={stopRecording}
                >
                  Stop recording
                </button>
              )}
              <button
                className="rounded-full border border-white/20 px-6 py-2 text-sm"
                onClick={runEvaluation}
                disabled={!practice.audioBlobRef || isLoading}
              >
                {isLoading ? "Evaluating..." : "Run evaluation"}
              </button>
            </div>
            {practice.audioBlobRef && (
              <audio className="mt-4 w-full" controls src={practice.audioBlobRef} />
            )}
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Transcript</h3>
              <button
                className="rounded-full border border-white/20 px-4 py-1 text-xs"
                onClick={() => practice.transcript && navigator.clipboard.writeText(practice.transcript)}
                disabled={!practice.transcript}
              >
                Copy transcript
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-200 whitespace-pre-wrap">
              {practice.transcript || "Your transcript will appear here after evaluation."}
            </p>
            {requestId && (
              <p className="mt-3 text-xs text-slate-400">Request ID: {requestId}</p>
            )}
          </div>
          {(responseErrors?.length ?? 0) > 0 && (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-6">
              <h3 className="text-lg font-semibold text-rose-100">We hit a snag</h3>
              <ul className="mt-3 space-y-2 text-sm text-rose-100">
                {responseErrors?.map((entry, index) => (
                  <li key={`${entry.stage}-${index}`}>
                    <span className="font-semibold uppercase text-xs">{entry.stage}</span>:{" "}
                    {entry.message}
                  </li>
                ))}
              </ul>
              {requestId && (
                <p className="mt-3 text-xs text-rose-100/80">Request ID: {requestId}</p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-6">
          <PatientCanvas reaction={practice.patientReaction} />
          {practice.evaluation && (
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold">Coach feedback</h3>
              <p className="mt-3 text-sm text-slate-300">{practice.evaluation.overall.summary_feedback}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {practice.evaluation.overall.what_to_improve_next.map((tip) => (
                  <span key={tip} className="rounded-full border border-white/10 px-3 py-1 text-xs">
                    {tip}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {practice.evaluation && (
        <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h3 className="text-lg font-semibold">Scoring matrix</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {practice.evaluation.objective_scores.map((score) => (
              <div key={score.objective_id} className="rounded-2xl border border-white/10 p-4">
                <p className="text-sm font-semibold">Objective {score.objective_id}</p>
                <p className="mt-1 text-xs text-slate-400">Score {score.score} / 4</p>
                <p className="mt-2 text-sm text-slate-200">{score.rationale_short}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
