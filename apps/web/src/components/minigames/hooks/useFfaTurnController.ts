import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EvaluationInput, Task } from "@deliberate/shared";
import type { MinigameRound } from "../../../store/api";
import { useStartMinigameRoundMutation, useSubmitMinigameRoundMutation } from "../../../store/api";
import { useAudioRecorder } from "./useAudioRecorder";
import { useResponseTiming, MIN_RESPONSE_TIMER_NEGATIVE } from "./useResponseTiming";
import type { PatientAudioBankHandle } from "../../../patientAudio/usePatientAudioBank";
import {
  applyTimingPenalty,
  createTimeoutEvaluation,
  normalizeSubmitResponse
} from "./turnSubmit";
import {
  runLocalEvaluation,
  runLocalTranscription,
  fallbackLocalSttProvider,
  type ClientTranscriptPayload
} from "../../../lib/localInference";
import type { LocalRuntimeClient } from "../../../lib/localRuntimeClient";
import { buildExampleForRound } from "./localRoundUtils";

export type TurnState =
  | "idle"
  | "patient_loading"
  | "patient_ready"
  | "patient_playing"
  | "awaiting_response_window"
  | "recording"
  | "transcribing"
  | "evaluating"
  | "complete";

type FfaTurnControllerOptions = {
  sessionId: string;
  round?: MinigameRound;
  playerId?: string;
  audioElement?: HTMLAudioElement | null;
  enabled?: boolean;
  aiMode?: string;
  task?: Task | null;
  localRuntimeClient?: LocalRuntimeClient | null;
  responseTimerEnabled: boolean;
  responseTimerSeconds?: number;
  maxResponseEnabled: boolean;
  maxResponseSeconds?: number;
  patientAudio: PatientAudioBankHandle;
  onTranscript?: (payload: { transcript?: string; attemptId?: string }) => void;
  onResult: (payload: {
    transcript?: string;
    evaluation?: unknown;
    score?: number;
    attemptId?: string;
    timingPenalty?: number;
  }) => void;
};

export const useFfaTurnController = ({
  sessionId,
  round,
  playerId,
  audioElement,
  enabled = true,
  aiMode,
  task,
  localRuntimeClient,
  responseTimerEnabled,
  responseTimerSeconds,
  maxResponseEnabled,
  maxResponseSeconds,
  patientAudio,
  onTranscript,
  onResult
}: FfaTurnControllerOptions) => {
  const [startRound] = useStartMinigameRoundMutation();
  const [submitRound] = useSubmitMinigameRoundMutation();
  const shouldUseLocalGateway = aiMode === "local_only";
  const { recordingState, startRecording, stopRecording, cancelRecording } = useAudioRecorder();
  const [patientEndedAt, setPatientEndedAt] = useState<number | null>(null);
  const playTokenRef = useRef(0);
  const { getEntry, ensureReady, play, stop, bank } = patientAudio;
  const entry = round
    ? getEntry(round.task_id, round.example_id)
    : undefined;
  const patientCacheKey =
    (entry as unknown as { cacheKey?: string | null })?.cacheKey ?? undefined;
  const audioStatus = entry?.status ?? "idle";
  const audioError = entry?.error ?? null;
  const timing = useResponseTiming({
    responseTimerEnabled,
    responseTimerSeconds,
    maxResponseEnabled,
    maxResponseSeconds,
    patientEndedAt
  });
  const {
    responseCountdown,
    maxDurationRemaining,
    recordResponseStart,
    recordResponseStop,
    reset: resetTiming,
    getTimingSnapshot
  } = timing;
  const [state, setState] = useState<TurnState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startedRoundRef = useRef<string | null>(null);
  const lastAudioStatusRef = useRef(audioStatus);
  const autoStopRef = useRef(false);
  const autoFailRef = useRef<string | null>(null);

  useEffect(() => {
    if (!round?.id) return;
    if (startedRoundRef.current !== round.id) {
      startedRoundRef.current = null;
      setState("idle");
      setSubmitError(null);
      resetTiming();
      autoStopRef.current = false;
      autoFailRef.current = null;
      setPatientEndedAt(null);
      playTokenRef.current += 1;
      if (audioElement) {
        stop(audioElement);
      }
    }
  }, [audioElement, resetTiming, round?.id, stop]);

  useEffect(() => {
    if (!enabled || !round) return;
    const controller = new AbortController();
    void ensureReady(round.task_id, round.example_id, { signal: controller.signal });
    return () => controller.abort();
  }, [enabled, ensureReady, round?.example_id, round?.task_id]);

  useEffect(() => {
    const audioStateLocked =
      state === "recording" || state === "transcribing" || state === "evaluating";
    if (audioStatus === "playing" && !audioStateLocked) {
      setState("patient_playing");
    }
    if (
      !audioStateLocked &&
      lastAudioStatusRef.current === "playing" &&
      audioStatus !== "playing"
    ) {
      if (!patientEndedAt) {
        setPatientEndedAt(Date.now());
      }
      if (responseTimerEnabled && responseCountdown != null && responseCountdown > 0) {
        setState("awaiting_response_window");
      } else {
        setState("patient_ready");
      }
    }
    lastAudioStatusRef.current = audioStatus;
  }, [
    audioStatus,
    patientEndedAt,
    responseTimerEnabled,
    responseCountdown,
    state
  ]);

  useEffect(() => {
    if (state === "awaiting_response_window" && responseCountdown != null && responseCountdown <= 0) {
      setState("patient_ready");
    }
  }, [responseCountdown, state]);

  const startRoundOrMatch = useCallback(async () => {
    if (!enabled || !round || !playerId || !audioElement) return;
    if (startedRoundRef.current === round.id) return;
    setSubmitError(null);
    setState("patient_loading");
    await startRound({ sessionId, roundId: round.id });
    startedRoundRef.current = round.id;
    await ensureReady(round.task_id, round.example_id);
    setState("patient_ready");
    const token = (playTokenRef.current += 1);
    await play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now())
    });
  }, [audioElement, enabled, ensureReady, play, playerId, round, sessionId, startRound]);

  useEffect(() => {
    if (!round || !playerId || state !== "idle") return;
    if (!enabled) return;
    if (!audioElement) return;
    void startRoundOrMatch();
  }, [audioElement, enabled, playerId, round, startRoundOrMatch, state]);

  const playPatient = useCallback(async () => {
    if (!enabled || !round || !playerId || !audioElement) return;
    if (!startedRoundRef.current) {
      await startRoundOrMatch();
    }
    setState("patient_ready");
    const token = (playTokenRef.current += 1);
    await play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now())
    });
  }, [audioElement, enabled, play, playerId, round, startRoundOrMatch]);

  const stopPatient = useCallback(() => {
    if (!enabled) return;
    playTokenRef.current += 1;
    stop(audioElement);
    setPatientEndedAt(Date.now());
    if (round) {
      bank.updateEntry(round.task_id, round.example_id, { status: "ready" });
    }
  }, [audioElement, bank, enabled, round, stop]);

  const startRecordingSafe = useCallback(() => {
    if (!enabled || !round || !playerId) return;
    const startPromise = startRecording();
    if (!startedRoundRef.current) {
      void startRoundOrMatch();
    }
    stopPatient();
    recordResponseStart();
    autoStopRef.current = false;
    setState("recording");
    startPromise.catch(() => {
      setSubmitError("Microphone access failed. Please try again.");
      setState("patient_ready");
    });
  }, [
    enabled,
    playerId,
    recordResponseStart,
    round,
    startRecording,
    startRoundOrMatch,
    stopPatient
  ]);

  const stopAndSubmit = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    const recorded = await stopRecording();
    if (!recorded) return;
    setState("transcribing");
    recordResponseStop();
    const timingSnapshot = getTimingSnapshot();
    try {
      const submitBase = {
        sessionId,
        roundId: round.id,
        player_id: playerId,
        mode: aiMode,
        practice_mode: "real_time" as const,
        turn_context: {
          patient_cache_key: patientCacheKey,
          patient_statement_id: round.example_id,
          timing: {
            response_delay_ms: timingSnapshot.responseDelayMs,
            response_duration_ms: timingSnapshot.responseDurationMs,
            response_timer_seconds: responseTimerEnabled ? responseTimerSeconds : undefined,
            max_response_duration_seconds: maxResponseEnabled ? maxResponseSeconds : undefined
          }
        }
      };
      let clientTranscript: ClientTranscriptPayload | null = null;
      const transcriptionResponse = shouldUseLocalGateway
        ? await (async () => {
            if (!localRuntimeClient) {
              throw new Error("Local runtime client unavailable.");
            }
            clientTranscript = await runLocalTranscription({
              client: localRuntimeClient,
              blob: recorded.blob,
              mimeType: recorded.mimeType
            });
            return submitRound({
              ...submitBase,
              skip_scoring: true,
              client_transcript: clientTranscript
            }).unwrap();
          })()
        : await submitRound({
            ...submitBase,
            skip_scoring: true,
            audio_base64: recorded.base64,
            audio_mime: recorded.mimeType
          }).unwrap();
      const parsedTranscript = normalizeSubmitResponse(transcriptionResponse);
      const transcriptText = parsedTranscript.transcript ?? clientTranscript?.text;
      const attemptId = parsedTranscript.attemptId;
      onTranscript?.({
        transcript: transcriptText,
        attemptId
      });
      if (!transcriptText || !attemptId) {
        throw new Error("Transcription missing.");
      }
      setState("evaluating");
      const evaluationResponse = shouldUseLocalGateway
        ? await (async () => {
            if (!localRuntimeClient) {
              throw new Error("Local runtime client unavailable.");
            }
            if (!task) {
              throw new Error("Task data unavailable for local evaluation.");
            }
            const example = buildExampleForRound(round, task);
            const evaluationInput: EvaluationInput = {
              task,
              example,
              attempt_id: attemptId,
              transcript: { text: transcriptText }
            };
            const localEval = await runLocalEvaluation({
              client: localRuntimeClient,
              input: evaluationInput
            });
            const transcriptPayload: ClientTranscriptPayload =
              clientTranscript ?? {
                text: transcriptText,
                provider: fallbackLocalSttProvider,
                duration_ms: 0
              };
            return submitRound({
              ...submitBase,
              attempt_id: attemptId,
              client_transcript: transcriptPayload,
              client_evaluation: {
                evaluation: localEval.evaluation,
                provider: localEval.provider,
                duration_ms: localEval.duration_ms
              }
            }).unwrap();
          })()
        : await submitRound({
            ...submitBase,
            attempt_id: attemptId,
            transcript_text: transcriptText
          }).unwrap();
      const parsed = normalizeSubmitResponse(evaluationResponse);
      const timingPenalty = parsed.timingPenalty ?? timingSnapshot.penalty;
      const adjustedScore = applyTimingPenalty({ score: parsed.score, timingPenalty });
      onResult({
        transcript: parsed.transcript ?? transcriptText,
        evaluation: parsed.evaluation,
        score: evaluationResponse.adjusted_score ?? adjustedScore ?? parsed.score,
        attemptId: parsed.attemptId ?? attemptId,
        timingPenalty
      });
      setState("complete");
    } catch (error) {
      console.error("[minigames] stop_and_submit_error", error);
      setSubmitError("Submission failed. Please try again.");
      setState("patient_ready");
    }
  }, [
    aiMode,
    enabled,
    getTimingSnapshot,
    localRuntimeClient,
    maxResponseEnabled,
    maxResponseSeconds,
    onResult,
    onTranscript,
    patientCacheKey,
    playerId,
    recordResponseStop,
    responseTimerEnabled,
    responseTimerSeconds,
    round,
    sessionId,
    shouldUseLocalGateway,
    stopRecording,
    submitRound,
    task
  ]);

  const abortTurn = useCallback(
    (reason?: string) => {
      if (!enabled) return;
      if (reason) {
        console.info("[minigames] abort_turn", { reason, roundId: round?.id, playerId });
      }
      playTokenRef.current += 1;
      stop(audioElement);
      cancelRecording();
      resetTiming();
      startedRoundRef.current = null;
      setState("idle");
      setSubmitError(null);
      setPatientEndedAt(null);
      autoStopRef.current = false;
      autoFailRef.current = null;
      if (round) {
        bank.updateEntry(round.task_id, round.example_id, { status: "ready" });
      }
    },
    [audioElement, bank, cancelRecording, enabled, playerId, resetTiming, round, stop]
  );

  useEffect(() => {
    if (state !== "recording" || maxDurationRemaining == null) return;
    if (maxDurationRemaining <= 0 && !autoStopRef.current) {
      autoStopRef.current = true;
      void stopAndSubmit();
    }
  }, [maxDurationRemaining, state, stopAndSubmit]);

  const micMode = useMemo(() => {
    if (!round || !playerId) return "disabled";
    if (state === "recording") return "stop";
    if (state === "transcribing" || state === "evaluating") return "locked";
    return "record";
  }, [playerId, round, state]);

  const responseCountdownLabel = useMemo(() => {
    if (responseCountdown == null) return undefined;
    if (
      state === "recording" ||
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    ) {
      return undefined;
    }
    const label = responseCountdown > 0 ? "WAIT" : "LATE";
    return `${label} ${Math.abs(responseCountdown).toFixed(1)}s`;
  }, [responseCountdown, state]);

  const maxDurationProgress = useMemo(() => {
    if (!maxResponseEnabled || !maxResponseSeconds || maxDurationRemaining == null) return 0;
    return maxDurationRemaining / maxResponseSeconds;
  }, [maxDurationRemaining, maxResponseEnabled, maxResponseSeconds]);

  const processingStage =
    state === "transcribing" ? "transcribing" : state === "evaluating" ? "evaluating" : null;

  const responseCountdownActive = useMemo(() => {
    if (
      state === "recording" ||
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    ) {
      return null;
    }
    return responseCountdown;
  }, [responseCountdown, state]);

  const micAccent = useMemo(() => {
    if (state === "transcribing" || state === "evaluating" || state === "complete") return "teal";
    if (state === "recording") return "rose";
    if (
      responseCountdown != null &&
      responseCountdown <= 0 &&
      responseCountdown > -MIN_RESPONSE_TIMER_NEGATIVE
    ) {
      return "rose";
    }
    return "teal";
  }, [responseCountdown, state]);

  const micAttention = useMemo(() => {
    if (state === "recording" || state === "transcribing" || state === "evaluating" || state === "complete") {
      return false;
    }
    return (
      responseCountdown != null &&
      responseCountdown <= 0 &&
      responseCountdown > -MIN_RESPONSE_TIMER_NEGATIVE
    );
  }, [responseCountdown, state]);

  useEffect(() => {
    if (!round || !playerId) return;
    if (responseCountdown == null) return;
    if (responseCountdown > -MIN_RESPONSE_TIMER_NEGATIVE) return;
    if (
      state === "recording" ||
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    ) {
      return;
    }
    const autoFailKey = `${round.id}-${playerId}`;
    if (autoFailRef.current === autoFailKey) return;
    autoFailRef.current = autoFailKey;
    const attemptId = `timeout-${round.id}-${playerId}-${Date.now()}`;
    const evaluation = createTimeoutEvaluation({
      taskId: round.task_id,
      exampleId: round.example_id,
      attemptId
    });
    onResult({
      transcript: evaluation.transcript.text,
      evaluation,
      score: 0,
      attemptId,
      timingPenalty: 0
    });
    setState("complete");
  }, [onResult, playerId, responseCountdown, round, state]);

  return {
    state,
    micMode,
    recordingState,
    audioStatus,
    audioError,
    submitError,
    processingStage,
    responseCountdownLabel,
    responseCountdown: responseCountdownActive,
    micAccent,
    micAttention,
    maxDurationRemaining,
    maxDurationProgress,
    patientEndedAt,
    startRoundOrMatch,
    playPatient,
    stopPatient,
    startRecording: startRecordingSafe,
    stopAndSubmit,
    abortTurn
  };
};
