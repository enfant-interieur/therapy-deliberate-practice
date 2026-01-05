import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinigameRound } from "../../../store/api";
import { useStartMinigameRoundMutation, useSubmitMinigameRoundMutation } from "../../../store/api";
import { useAudioRecorder } from "./useAudioRecorder";
import { useResponseTiming, MIN_RESPONSE_TIMER_NEGATIVE } from "./useResponseTiming";
import type { PatientAudioBankHandle } from "../../../patientAudio/usePatientAudioBank";
import { applyTimingPenalty, createTimeoutEvaluation, normalizeSubmitResponse } from "./turnSubmit";

export type MatchState =
  | "idle"
  | "intro"
  | "patient_loading"
  | "patient_ready"
  | "patient_playing"
  | "awaiting_response_window"
  | "recording"
  | "transcribing"
  | "evaluating"
  | "between_players"
  | "complete";

type TdmMatchControllerOptions = {
  sessionId: string;
  round?: MinigameRound;
  audioElement?: HTMLAudioElement | null;
  enabled?: boolean;
  aiMode?: string;
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
    playerId: string;
  }) => void;
};

export const useTdmMatchController = ({
  sessionId,
  round,
  audioElement,
  enabled = true,
  aiMode,
  responseTimerEnabled,
  responseTimerSeconds,
  maxResponseEnabled,
  maxResponseSeconds,
  patientAudio,
  onTranscript,
  onResult
}: TdmMatchControllerOptions) => {
  const [startRound] = useStartMinigameRoundMutation();
  const [submitRound] = useSubmitMinigameRoundMutation();
  const { recordingState, startRecording, stopRecording } = useAudioRecorder();
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
  const [state, setState] = useState<MatchState>("idle");
  const [introOpen, setIntroOpen] = useState(false);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startedRoundRef = useRef<string | null>(null);
  const introShownRef = useRef<string | null>(null);
  const lastAudioStatusRef = useRef(audioStatus);
  const autoStopRef = useRef(false);
  const autoFailRef = useRef<string | null>(null);

  useEffect(() => {
    if (!round?.id) return;
    if (startedRoundRef.current !== round.id) {
      startedRoundRef.current = null;
      introShownRef.current = null;
      setActivePlayerId(round.player_a_id);
      setState("idle");
      setIntroOpen(false);
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
  }, [audioElement, resetTiming, round?.id, round?.player_a_id, stop]);

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
    if (state === "awaiting_response_window" && responseCountdown != null && responseCountdown <= 0) {
      setState("patient_ready");
    }
  }, [responseCountdown, state]);

  const preparePatientAudio = useCallback(async () => {
    if (!enabled || !round) return;
    await ensureReady(round.task_id, round.example_id);
    setState("patient_ready");
  }, [enabled, ensureReady, round]);

  const startRoundOrMatch = useCallback(async () => {
    if (!enabled || !round || !audioElement) return;
    if (startedRoundRef.current === round.id) {
      if (state === "between_players") {
        resetTiming();
        setState("patient_ready");
      }
      return;
    }
    setSubmitError(null);
    setState("patient_loading");
    await startRound({ sessionId, roundId: round.id });
    startedRoundRef.current = round.id;
    await preparePatientAudio();
    if (introShownRef.current !== round.id) {
      introShownRef.current = round.id;
      setIntroOpen(true);
      setState("intro");
    } else {
      setState("patient_ready");
      const token = (playTokenRef.current += 1);
      await play(round.task_id, round.example_id, audioElement, {
        shouldPlay: () => playTokenRef.current === token,
        onEnded: () => setPatientEndedAt(Date.now())
      });
    }
  }, [
    audioElement,
    enabled,
    preparePatientAudio,
    round,
    sessionId,
    startRound,
    state,
    play,
    resetTiming
  ]);

  useEffect(() => {
    if (!round || state !== "idle") return;
    if (!enabled) return;
    if (!audioElement) return;
    void startRoundOrMatch();
  }, [audioElement, enabled, round, startRoundOrMatch, state]);

  const handleIntroComplete = useCallback(async () => {
    if (!enabled || !round || !audioElement) return;
    setIntroOpen(false);
    setState("patient_ready");
    const token = (playTokenRef.current += 1);
    await play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now())
    });
  }, [audioElement, enabled, play, round]);

  const playPatient = useCallback(async () => {
    if (!enabled || !round || !audioElement) return;
    if (!startedRoundRef.current) {
      await startRoundOrMatch();
      return;
    }
    setState("patient_ready");
    const token = (playTokenRef.current += 1);
    await play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now())
    });
  }, [audioElement, enabled, play, round, startRoundOrMatch]);

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
    if (!enabled || !round || !activePlayerId) return;
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
    activePlayerId,
    enabled,
    recordResponseStart,
    round,
    startRecording,
    startRoundOrMatch,
    stopPatient
  ]);

  const stopAndSubmit = useCallback(async () => {
    if (!enabled || !round || !activePlayerId) return;
    const recorded = await stopRecording();
    if (!recorded) return;
    setState("transcribing");
    recordResponseStop();
    const timingSnapshot = getTimingSnapshot();
    try {
      const transcriptionResponse = await submitRound({
        sessionId,
        roundId: round.id,
        player_id: activePlayerId,
        audio_base64: recorded.base64,
        audio_mime: recorded.mimeType,
        mode: aiMode,
        practice_mode: "real_time",
        skip_scoring: true,
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
      }).unwrap();
      const parsedTranscript = normalizeSubmitResponse(transcriptionResponse);
      onTranscript?.({
        transcript: parsedTranscript.transcript,
        attemptId: parsedTranscript.attemptId
      });
      if (!parsedTranscript.transcript || !parsedTranscript.attemptId) {
        throw new Error("Transcription missing.");
      }
      setState("evaluating");
      const response = await submitRound({
        sessionId,
        roundId: round.id,
        player_id: activePlayerId,
        transcript_text: parsedTranscript.transcript,
        attempt_id: parsedTranscript.attemptId,
        mode: aiMode,
        practice_mode: "real_time",
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
      }).unwrap();
      const parsed = normalizeSubmitResponse(response);
      const timingPenalty = parsed.timingPenalty ?? timingSnapshot.penalty;
      const adjustedScore = applyTimingPenalty({ score: parsed.score, timingPenalty });
      onResult({
        transcript: parsed.transcript,
        evaluation: parsed.evaluation,
        score: response.adjusted_score ?? adjustedScore ?? parsed.score,
        attemptId: parsed.attemptId,
        timingPenalty,
        playerId: activePlayerId
      });
      resetTiming();
      if (round.player_b_id && activePlayerId === round.player_a_id) {
        setActivePlayerId(round.player_b_id);
        setState("between_players");
        playTokenRef.current += 1;
        stop(audioElement);
      } else {
        setState("complete");
      }
    } catch (error) {
      setSubmitError("Submission failed. Please try again.");
      setState("patient_ready");
    }
  }, [
    activePlayerId,
    aiMode,
    audioElement,
    enabled,
    maxResponseEnabled,
    maxResponseSeconds,
    onTranscript,
    onResult,
    patientCacheKey,
    responseTimerEnabled,
    responseTimerSeconds,
    round,
    sessionId,
    stopRecording,
    submitRound,
    getTimingSnapshot,
    recordResponseStop,
    resetTiming,
    stop
  ]);

  useEffect(() => {
    if (state !== "recording" || maxDurationRemaining == null) return;
    if (maxDurationRemaining <= 0 && !autoStopRef.current) {
      autoStopRef.current = true;
      void stopAndSubmit();
    }
  }, [maxDurationRemaining, state, stopAndSubmit]);

  const micMode = useMemo(() => {
    if (!round || !activePlayerId) return "disabled";
    if (state === "recording") return "stop";
    if (state === "transcribing" || state === "evaluating") return "locked";
    return "record";
  }, [activePlayerId, round, state]);

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
    if (!round || !activePlayerId) return;
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
    const autoFailKey = `${round.id}-${activePlayerId}`;
    if (autoFailRef.current === autoFailKey) return;
    autoFailRef.current = autoFailKey;
    const attemptId = `timeout-${round.id}-${activePlayerId}-${Date.now()}`;
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
      timingPenalty: 0,
      playerId: activePlayerId
    });
    resetTiming();
    if (round.player_b_id && activePlayerId === round.player_a_id) {
      setActivePlayerId(round.player_b_id);
      setState("between_players");
      playTokenRef.current += 1;
      stop(audioElement);
    } else {
      setState("complete");
    }
  }, [activePlayerId, audioElement, onResult, resetTiming, responseCountdown, round, state, stop]);

  return {
    state,
    introOpen,
    activePlayerId,
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
    handleIntroComplete,
    playPatient,
    stopPatient,
    startRecording: startRecordingSafe,
    stopAndSubmit
  };
};
