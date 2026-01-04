import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinigameRound } from "../../../store/api";
import { useStartMinigameRoundMutation, useSubmitMinigameRoundMutation } from "../../../store/api";
import { useAudioRecorder } from "./useAudioRecorder";
import { useResponseTiming } from "./useResponseTiming";
import type { PatientAudioBankHandle } from "../../../patientAudio/usePatientAudioBank";

export type TurnState =
  | "idle"
  | "patient_loading"
  | "patient_ready"
  | "patient_playing"
  | "awaiting_response_window"
  | "recording"
  | "submitting"
  | "complete";

type FfaTurnControllerOptions = {
  sessionId: string;
  round?: MinigameRound;
  playerId?: string;
  audioElement?: HTMLAudioElement | null;
  enabled?: boolean;
  responseTimerEnabled: boolean;
  responseTimerSeconds?: number;
  maxResponseEnabled: boolean;
  maxResponseSeconds?: number;
  patientAudio: PatientAudioBankHandle;
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
  responseTimerEnabled,
  responseTimerSeconds,
  maxResponseEnabled,
  maxResponseSeconds,
  patientAudio,
  onResult
}: FfaTurnControllerOptions) => {
  const [startRound] = useStartMinigameRoundMutation();
  const [submitRound] = useSubmitMinigameRoundMutation();
  const { recordingState, startRecording, stopRecording } = useAudioRecorder();
  const [patientEndedAt, setPatientEndedAt] = useState<number | null>(null);
  const playTokenRef = useRef(0);
  const { getEntry, ensureReady, play, stop, bank } = patientAudio;
  const entry = round
    ? getEntry(round.task_id, round.example_id)
    : undefined;
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

  useEffect(() => {
    if (!round?.id) return;
    if (startedRoundRef.current !== round.id) {
      startedRoundRef.current = null;
      setState("idle");
      setSubmitError(null);
      resetTiming();
      autoStopRef.current = false;
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
    if (audioStatus === "playing") {
      setState("patient_playing");
    }
    if (
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
    responseCountdown
  ]);

  useEffect(() => {
    if (state === "awaiting_response_window" && responseCountdown === 0) {
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

  const startRecordingSafe = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    if (!startedRoundRef.current) {
      await startRoundOrMatch();
    }
    stopPatient();
    recordResponseStart();
    autoStopRef.current = false;
    await startRecording();
    setState("recording");
  }, [enabled, playerId, recordResponseStart, round, startRecording, stopPatient]);

  const stopAndSubmit = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    const recorded = await stopRecording();
    if (!recorded) return;
    setState("submitting");
    recordResponseStop();
    const timingSnapshot = getTimingSnapshot();
    try {
      const response = await submitRound({
        sessionId,
        roundId: round.id,
        player_id: playerId,
        audio_base64: recorded.base64,
        audio_mime: recorded.mimeType,
        practice_mode: "real_time",
        turn_context: {
          patient_statement_id: round.example_id,
          timing: {
            response_delay_ms: timingSnapshot.responseDelayMs,
            response_duration_ms: timingSnapshot.responseDurationMs,
            response_timer_seconds: responseTimerEnabled ? responseTimerSeconds : undefined,
            max_response_duration_seconds: maxResponseEnabled ? maxResponseSeconds : undefined
          }
        }
      }).unwrap();
      const rawScore =
        response.scoring && "evaluation" in response.scoring
          ? response.scoring.evaluation?.overall?.score
          : undefined;
      const timingPenalty = response.timing_penalty ?? timingSnapshot.penalty;
      const adjustedScore =
        rawScore != null ? Math.max(0, rawScore - (timingPenalty ?? 0)) : undefined;
      onResult({
        transcript: response.transcript?.text,
        evaluation: response.scoring?.evaluation,
        score: response.adjusted_score ?? adjustedScore ?? rawScore,
        attemptId: response.attemptId,
        timingPenalty
      });
      setState("complete");
    } catch (error) {
      setSubmitError("Submission failed. Please try again.");
      setState("patient_ready");
    }
  }, [
    enabled,
    maxResponseEnabled,
    maxResponseSeconds,
    onResult,
    playerId,
    responseTimerEnabled,
    responseTimerSeconds,
    round,
    sessionId,
    stopRecording,
    submitRound,
    getTimingSnapshot,
    recordResponseStop
  ]);

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
    if (state === "submitting") return "locked";
    return "record";
  }, [playerId, round, state]);

  const responseCountdownLabel = useMemo(() => {
    if (state !== "awaiting_response_window" || responseCountdown == null) return undefined;
    return `${responseCountdown.toFixed(1)}s`;
  }, [responseCountdown, state]);

  const maxDurationProgress = useMemo(() => {
    if (!maxResponseEnabled || !maxResponseSeconds || maxDurationRemaining == null) return 0;
    return maxDurationRemaining / maxResponseSeconds;
  }, [maxDurationRemaining, maxResponseEnabled, maxResponseSeconds]);

  return {
    state,
    micMode,
    recordingState,
    audioStatus,
    audioError,
    submitError,
    responseCountdownLabel,
    maxDurationRemaining,
    maxDurationProgress,
    patientEndedAt,
    startRoundOrMatch,
    playPatient,
    stopPatient,
    startRecording: startRecordingSafe,
    stopAndSubmit
  };
};
