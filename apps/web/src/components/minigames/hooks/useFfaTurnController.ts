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
  const entry = round
    ? patientAudio.getEntry(round.task_id, round.example_id)
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
      timing.reset();
      autoStopRef.current = false;
      setPatientEndedAt(null);
      playTokenRef.current += 1;
      if (audioElement) {
        patientAudio.stop(audioElement);
      }
    }
  }, [audioElement, patientAudio, round?.id, timing]);

  useEffect(() => {
    if (!enabled || !round) return;
    const controller = new AbortController();
    void patientAudio.ensureReady(round.task_id, round.example_id, { signal: controller.signal });
    return () => controller.abort();
  }, [enabled, patientAudio, round]);

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
      if (responseTimerEnabled && timing.responseCountdown != null && timing.responseCountdown > 0) {
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
    timing.responseCountdown
  ]);

  useEffect(() => {
    if (state === "awaiting_response_window" && timing.responseCountdown === 0) {
      setState("patient_ready");
    }
  }, [state, timing.responseCountdown]);

  const startRoundOrMatch = useCallback(async () => {
    if (!enabled || !round || !playerId || !audioElement) return;
    if (startedRoundRef.current === round.id) return;
    setSubmitError(null);
    setState("patient_loading");
    await startRound({ sessionId, roundId: round.id });
    startedRoundRef.current = round.id;
    await patientAudio.ensureReady(round.task_id, round.example_id);
    setState("patient_ready");
    const token = (playTokenRef.current += 1);
    await patientAudio.play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now())
    });
  }, [audioElement, enabled, patientAudio, playerId, round, sessionId, startRound]);

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
    await patientAudio.play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now())
    });
  }, [audioElement, enabled, patientAudio, playerId, round, startRoundOrMatch]);

  const stopPatient = useCallback(() => {
    if (!enabled) return;
    playTokenRef.current += 1;
    patientAudio.stop(audioElement);
    setPatientEndedAt(Date.now());
    if (round) {
      patientAudio.bank.updateEntry(round.task_id, round.example_id, { status: "ready" });
    }
  }, [audioElement, enabled, patientAudio, round]);

  const startRecordingSafe = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    if (!startedRoundRef.current) {
      await startRoundOrMatch();
    }
    stopPatient();
    timing.recordResponseStart();
    autoStopRef.current = false;
    await startRecording();
    setState("recording");
  }, [enabled, playerId, round, startRecording, stopPatient, timing]);

  const stopAndSubmit = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    const recorded = await stopRecording();
    if (!recorded) return;
    setState("submitting");
    timing.recordResponseStop();
    const timingSnapshot = timing.getTimingSnapshot();
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
    timing
  ]);

  useEffect(() => {
    if (state !== "recording" || timing.maxDurationRemaining == null) return;
    if (timing.maxDurationRemaining <= 0 && !autoStopRef.current) {
      autoStopRef.current = true;
      void stopAndSubmit();
    }
  }, [state, stopAndSubmit, timing.maxDurationRemaining]);

  const micMode = useMemo(() => {
    if (!round || !playerId) return "disabled";
    if (state === "recording") return "stop";
    if (state === "submitting") return "locked";
    return "record";
  }, [playerId, round, state]);

  const responseCountdownLabel = useMemo(() => {
    if (state !== "awaiting_response_window" || timing.responseCountdown == null) return undefined;
    return `${timing.responseCountdown.toFixed(1)}s`;
  }, [state, timing.responseCountdown]);

  const maxDurationProgress = useMemo(() => {
    if (!maxResponseEnabled || !maxResponseSeconds || timing.maxDurationRemaining == null) return 0;
    return timing.maxDurationRemaining / maxResponseSeconds;
  }, [maxResponseEnabled, maxResponseSeconds, timing.maxDurationRemaining]);

  return {
    state,
    micMode,
    recordingState,
    audioStatus,
    audioError,
    submitError,
    responseCountdownLabel,
    maxDurationRemaining: timing.maxDurationRemaining,
    maxDurationProgress,
    patientEndedAt,
    startRoundOrMatch,
    playPatient,
    stopPatient,
    startRecording: startRecordingSafe,
    stopAndSubmit
  };
};
