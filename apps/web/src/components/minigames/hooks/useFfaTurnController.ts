import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EvaluationResult } from "@deliberate/shared";
import type { MinigameRound } from "../../../store/api";
import { useStartMinigameRoundMutation } from "../../../store/api";
import { useAudioRecorder } from "./useAudioRecorder";
import {
  useResponseTiming,
  MIN_RESPONSE_TIMER_NEGATIVE,
} from "./useResponseTiming";
import type { PatientAudioBankHandle } from "../../../patientAudio/usePatientAudioBank";
import {
  applyTimingPenalty,
  createTimeoutEvaluation,
  normalizeSubmitResponse,
} from "./turnSubmit";
import { useMinigameAttemptRunner } from "./useMinigameAttemptRunner";

export type TurnState =
  | "idle"
  | "activation_error"
  | "patient_loading"
  | "patient_ready"
  | "patient_playing"
  | "awaiting_response_window"
  | "requesting_permission"
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
  responseTimerEnabled: boolean;
  responseTimerSeconds?: number;
  maxResponseEnabled: boolean;
  maxResponseSeconds?: number;
  patientAudio: PatientAudioBankHandle;
  onTranscript?: (payload: { transcript?: string; attemptId?: string }) => void;
  onResult: (payload: {
    transcript?: string;
    evaluation?: EvaluationResult;
    score?: number;
    attemptId?: string;
    timingPenalty?: number;
    scoreTrust?: "cloud_trusted" | "local_unverified";
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
  onTranscript,
  onResult,
}: FfaTurnControllerOptions) => {
  const { t } = useTranslation();
  const [startRound] = useStartMinigameRoundMutation();
  const runAttempt = useMinigameAttemptRunner();
  const { recordingState, startRecording, stopRecording, cancelRecording } =
    useAudioRecorder();
  const [patientEndedAt, setPatientEndedAt] = useState<number | null>(null);
  const playTokenRef = useRef(0);
  const { getEntry, ensureReady, play, pause, stopAndRewind, bank } =
    patientAudio;
  const roundTaskId = round?.task_id;
  const roundExampleId = round?.example_id;
  const entry =
    roundTaskId && roundExampleId
      ? getEntry(roundTaskId, roundExampleId)
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
    patientEndedAt,
  });
  const {
    responseCountdown,
    maxDurationRemaining,
    recordResponseStart,
    recordResponseStop,
    reset: resetTiming,
    getTimingSnapshot,
  } = timing;
  const [state, setState] = useState<TurnState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startedRoundRef = useRef<string | null>(null);
  const lastAudioStatusRef = useRef(audioStatus);
  const autoStopRef = useRef(false);
  const autoFailRef = useRef<string | null>(null);
  const activationGenerationRef = useRef(0);
  const recordingRequestGenerationRef = useRef(0);
  const recordingRequestInFlightRef = useRef(false);

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
      activationGenerationRef.current += 1;
      recordingRequestGenerationRef.current += 1;
      recordingRequestInFlightRef.current = false;
      cancelRecording();
      if (audioElement) {
        stopAndRewind(audioElement);
      }
    }
  }, [audioElement, cancelRecording, resetTiming, round?.id, stopAndRewind]);

  useEffect(() => {
    if (!enabled || !roundTaskId || !roundExampleId) return;
    const controller = new AbortController();
    void ensureReady(roundTaskId, roundExampleId, {
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [enabled, ensureReady, roundExampleId, roundTaskId]);

  useEffect(() => {
    if (audioStatus === "playing") {
      setState("patient_playing");
    }
    if (lastAudioStatusRef.current === "playing" && audioStatus !== "playing") {
      if (!patientEndedAt) {
        setPatientEndedAt(Date.now());
      }
      if (
        responseTimerEnabled &&
        responseCountdown != null &&
        responseCountdown > 0
      ) {
        setState("awaiting_response_window");
      } else {
        setState("patient_ready");
      }
    }
    lastAudioStatusRef.current = audioStatus;
  }, [audioStatus, patientEndedAt, responseTimerEnabled, responseCountdown]);

  useEffect(() => {
    if (
      state === "awaiting_response_window" &&
      responseCountdown != null &&
      responseCountdown <= 0
    ) {
      setState("patient_ready");
    }
  }, [responseCountdown, state]);

  const startRoundOrMatch = useCallback(async () => {
    if (!enabled || !round || !playerId || !audioElement) return false;
    if (startedRoundRef.current === round.id) return true;
    setSubmitError(null);
    setState("patient_loading");
    const activationGeneration = activationGenerationRef.current;
    try {
      await startRound({ sessionId, roundId: round.id }).unwrap();
      if (activationGeneration !== activationGenerationRef.current) {
        return false;
      }
      await ensureReady(round.task_id, round.example_id);
      if (activationGeneration !== activationGenerationRef.current) {
        return false;
      }
      const readyEntry = bank.getEntry(round.task_id, round.example_id);
      if (readyEntry?.status !== "ready" || !readyEntry.blobUrl) {
        throw new Error(t("minigameUi.audioStatus.error"));
      }
      startedRoundRef.current = round.id;
      setState("patient_ready");
      const token = (playTokenRef.current += 1);
      await play(round.task_id, round.example_id, audioElement, {
        shouldPlay: () => playTokenRef.current === token,
        onEnded: () => setPatientEndedAt(Date.now()),
      });
      return true;
    } catch {
      if (activationGeneration !== activationGenerationRef.current) {
        return false;
      }
      startedRoundRef.current = null;
      setSubmitError(t("minigameUi.roundActivationFailed"));
      setState("activation_error");
      return false;
    }
  }, [
    audioElement,
    bank,
    enabled,
    ensureReady,
    play,
    playerId,
    round,
    sessionId,
    startRound,
    t,
  ]);

  useEffect(() => {
    if (!round || !playerId || state !== "idle") return;
    if (!enabled) return;
    if (!audioElement) return;
    void startRoundOrMatch();
  }, [audioElement, enabled, playerId, round, startRoundOrMatch, state]);

  const playPatient = useCallback(async () => {
    if (!enabled || !round || !playerId || !audioElement) return;
    if (!startedRoundRef.current) {
      const started = await startRoundOrMatch();
      if (!started) return;
    }
    setState("patient_ready");
    const token = (playTokenRef.current += 1);
    await play(round.task_id, round.example_id, audioElement, {
      shouldPlay: () => playTokenRef.current === token,
      onEnded: () => setPatientEndedAt(Date.now()),
    });
  }, [audioElement, enabled, play, playerId, round, startRoundOrMatch]);

  const stopPatient = useCallback(() => {
    if (!enabled) return;
    playTokenRef.current += 1;
    pause(audioElement);
    setPatientEndedAt(Date.now());
    if (round) {
      bank.updateEntry(round.task_id, round.example_id, { status: "ready" });
    }
  }, [audioElement, bank, enabled, pause, round]);

  const startRecordingSafe = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    if (startedRoundRef.current !== round.id) return;
    if (state !== "patient_ready" && state !== "awaiting_response_window") {
      return;
    }
    if (recordingRequestInFlightRef.current) return;
    recordingRequestInFlightRef.current = true;
    const requestGeneration = (recordingRequestGenerationRef.current += 1);
    setSubmitError(null);
    setState("requesting_permission");
    try {
      const started = await startRecording();
      if (requestGeneration !== recordingRequestGenerationRef.current) return;
      if (!started) {
        setState("patient_ready");
        return;
      }
      playTokenRef.current += 1;
      stopAndRewind(audioElement);
      bank.updateEntry(round.task_id, round.example_id, { status: "ready" });
      recordResponseStart();
      autoStopRef.current = false;
      setState("recording");
    } catch {
      if (requestGeneration !== recordingRequestGenerationRef.current) return;
      setSubmitError(t("practice.error.microphoneAccess"));
      setState("patient_ready");
    } finally {
      if (requestGeneration === recordingRequestGenerationRef.current) {
        recordingRequestInFlightRef.current = false;
      }
    }
  }, [
    audioElement,
    bank,
    enabled,
    playerId,
    recordResponseStart,
    round,
    startRecording,
    state,
    stopAndRewind,
    t,
  ]);

  const stopAndSubmit = useCallback(async () => {
    if (!enabled || !round || !playerId) return;
    if (
      state === "requesting_permission" ||
      recordingState === "requesting_permission"
    ) {
      recordingRequestGenerationRef.current += 1;
      recordingRequestInFlightRef.current = false;
      cancelRecording();
      setState("patient_ready");
      return;
    }
    const recorded = await stopRecording();
    if (!recorded) {
      setState("patient_ready");
      return;
    }
    setState("transcribing");
    recordResponseStop();
    const timingSnapshot = getTimingSnapshot();
    const turnContext = {
      patient_cache_key: patientCacheKey,
      patient_statement_id: round.example_id,
      timing: {
        response_delay_ms: timingSnapshot.responseDelayMs,
        response_duration_ms: timingSnapshot.responseDurationMs,
        response_timer_seconds: responseTimerEnabled
          ? responseTimerSeconds
          : undefined,
        max_response_duration_seconds: maxResponseEnabled
          ? maxResponseSeconds
          : undefined,
      },
    };
    try {
      const response = await runAttempt({
        sessionId,
        roundId: round.id,
        taskId: round.task_id,
        exampleId: round.example_id,
        playerId,
        recorded,
        turnContext,
        onTranscript: (transcriptionResponse) => {
          const parsedTranscript = normalizeSubmitResponse(
            transcriptionResponse,
          );
          onTranscript?.({
            transcript: parsedTranscript.transcript,
            attemptId: parsedTranscript.attemptId,
          });
        },
        onEvaluating: () => setState("evaluating"),
      });
      const parsed = normalizeSubmitResponse(response);
      const timingPenalty = parsed.timingPenalty ?? timingSnapshot.penalty;
      const adjustedScore = applyTimingPenalty({
        score: parsed.score,
        timingPenalty,
      });
      onResult({
        transcript: parsed.transcript,
        evaluation: parsed.evaluation,
        score: response.adjusted_score ?? adjustedScore ?? parsed.score,
        attemptId: parsed.attemptId,
        timingPenalty,
        scoreTrust: response.score_trust,
      });
      setState("complete");
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t("minigameUi.submissionFailed"),
      );
      setState("patient_ready");
    }
  }, [
    enabled,
    maxResponseEnabled,
    maxResponseSeconds,
    onTranscript,
    onResult,
    patientCacheKey,
    playerId,
    responseTimerEnabled,
    responseTimerSeconds,
    round,
    runAttempt,
    sessionId,
    stopRecording,
    getTimingSnapshot,
    recordResponseStop,
    cancelRecording,
    recordingState,
    state,
    t,
  ]);

  const abortTurn = useCallback(
    (reason?: string) => {
      if (!enabled) return;
      if (reason) {
        console.info("[minigames] abort_turn", {
          reason,
          roundId: round?.id,
          playerId,
        });
      }
      playTokenRef.current += 1;
      activationGenerationRef.current += 1;
      stopAndRewind(audioElement);
      recordingRequestGenerationRef.current += 1;
      recordingRequestInFlightRef.current = false;
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
    [
      audioElement,
      bank,
      cancelRecording,
      enabled,
      playerId,
      resetTiming,
      round,
      stopAndRewind,
    ],
  );

  useEffect(() => {
    if (state !== "recording" || maxDurationRemaining == null) return;
    if (maxDurationRemaining <= 0 && !autoStopRef.current) {
      autoStopRef.current = true;
      void stopAndSubmit();
    }
  }, [maxDurationRemaining, state, stopAndSubmit]);

  const micMode = useMemo<"record" | "stop" | "disabled" | "locked">(() => {
    if (!round || !playerId) return "disabled";
    if (state === "recording" && recordingState === "recording") return "stop";
    if (
      recordingState === "requesting_permission" ||
      recordingState === "stopping" ||
      recordingState === "processing"
    ) {
      return "locked";
    }
    if (
      startedRoundRef.current === round.id &&
      (state === "patient_ready" || state === "awaiting_response_window")
    ) {
      return "record";
    }
    return "locked";
  }, [playerId, recordingState, round, state]);

  const responseCountdownLabel = useMemo(() => {
    if (responseCountdown == null) return undefined;
    if (
      state === "requesting_permission" ||
      state === "recording" ||
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    ) {
      return undefined;
    }
    return t(
      responseCountdown > 0
        ? "minigameUi.waitSeconds"
        : "minigameUi.lateSeconds",
      { seconds: Math.abs(responseCountdown).toFixed(1) },
    );
  }, [responseCountdown, state, t]);

  const maxDurationProgress = useMemo(() => {
    if (
      !maxResponseEnabled ||
      !maxResponseSeconds ||
      maxDurationRemaining == null
    )
      return 0;
    return maxDurationRemaining / maxResponseSeconds;
  }, [maxDurationRemaining, maxResponseEnabled, maxResponseSeconds]);

  const processingStage: "transcribing" | "evaluating" | null =
    state === "transcribing"
      ? "transcribing"
      : state === "evaluating"
        ? "evaluating"
        : null;

  const responseCountdownActive = useMemo(() => {
    if (
      state === "requesting_permission" ||
      state === "recording" ||
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    ) {
      return null;
    }
    return responseCountdown;
  }, [responseCountdown, state]);

  const micAccent = useMemo<"teal" | "rose">(() => {
    if (
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    )
      return "teal";
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
    if (
      state === "requesting_permission" ||
      state === "recording" ||
      state === "transcribing" ||
      state === "evaluating" ||
      state === "complete"
    ) {
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
      state === "requesting_permission" ||
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
      attemptId,
      copy: {
        transcript: t("minigameUi.timeout.transcript"),
        summaryFeedback: t("minigameUi.timeout.summaryFeedback"),
        improveNext: t("minigameUi.timeout.improveNext"),
        patientReaction: t("minigameUi.timeout.patientReaction"),
      },
    });
    onResult({
      transcript: evaluation.transcript.text,
      evaluation,
      score: 0,
      attemptId,
      timingPenalty: 0,
    });
    setState("complete");
  }, [onResult, playerId, responseCountdown, round, state, t]);

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
    abortTurn,
  };
};
