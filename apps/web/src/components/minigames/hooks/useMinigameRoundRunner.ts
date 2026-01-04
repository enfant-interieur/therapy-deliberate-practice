import { useCallback, useState } from "react";
import type { MinigameRound } from "../../../store/api";
import { useStartMinigameRoundMutation, useSubmitMinigameRoundMutation } from "../../../store/api";
import { useAudioRecorder } from "./useAudioRecorder";
import type { PatientAudioBankHandle } from "../../../patientAudio/usePatientAudioBank";

type RoundRunnerOptions = {
  sessionId: string;
  round?: MinigameRound;
  playerId?: string;
  audioElement?: HTMLAudioElement | null;
  patientAudio: PatientAudioBankHandle;
  onTranscript?: (payload: { transcript?: string; attemptId?: string }) => void;
  onResult: (payload: {
    transcript?: string;
    evaluation?: unknown;
    score?: number;
    attemptId?: string;
  }) => void;
};

export const useMinigameRoundRunner = ({
  sessionId,
  round,
  playerId,
  audioElement,
  patientAudio,
  onTranscript,
  onResult
}: RoundRunnerOptions) => {
  const [startRound] = useStartMinigameRoundMutation();
  const [submitRound] = useSubmitMinigameRoundMutation();
  const { recordingState, startRecording, stopRecording } = useAudioRecorder();
  const entry = round
    ? patientAudio.getEntry(round.task_id, round.example_id)
    : undefined;
  const audioStatus = entry?.status ?? "idle";
  const audioError = entry?.error ?? null;
  const [status, setStatus] = useState<"idle" | "playing" | "ready" | "submitting" | "complete">(
    "idle"
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const startTurn = useCallback(async () => {
    if (!round || !playerId) return;
    setSubmitError(null);
    await startRound({ sessionId, roundId: round.id });
    setStatus("playing");
    await patientAudio.ensureReady(round.task_id, round.example_id);
    await patientAudio.play(round.task_id, round.example_id, audioElement);
    setStatus("ready");
  }, [audioElement, patientAudio, playerId, round, sessionId, startRound]);

  const stopAndSubmit = useCallback(async () => {
    if (!round || !playerId) return;
    const recorded = await stopRecording();
    if (!recorded) return;
    setStatus("submitting");
    try {
      const transcriptionResponse = await submitRound({
        sessionId,
        roundId: round.id,
        player_id: playerId,
        audio_base64: recorded.base64,
        audio_mime: recorded.mimeType,
        practice_mode: "real_time",
        skip_scoring: true,
        turn_context: { patient_statement_id: round.example_id }
      }).unwrap();
      onTranscript?.({
        transcript: transcriptionResponse.transcript?.text,
        attemptId: transcriptionResponse.attemptId
      });
      if (!transcriptionResponse.transcript?.text || !transcriptionResponse.attemptId) {
        throw new Error("Transcription missing.");
      }
      const response = await submitRound({
        sessionId,
        roundId: round.id,
        player_id: playerId,
        transcript_text: transcriptionResponse.transcript.text,
        attempt_id: transcriptionResponse.attemptId,
        practice_mode: "real_time",
        turn_context: { patient_statement_id: round.example_id }
      }).unwrap();
      onResult({
        transcript: response.transcript?.text,
        evaluation: response.scoring?.evaluation,
        score: response.scoring?.evaluation?.overall?.score,
        attemptId: response.attemptId
      });
      setStatus("complete");
    } catch (error) {
      setSubmitError("Submission failed. Please try again.");
      setStatus("ready");
    }
  }, [onResult, onTranscript, playerId, round, sessionId, stopRecording, submitRound]);

  return {
    status,
    recordingState,
    isPlaying: status === "playing",
    audioError,
    audioStatus,
    submitError,
    startTurn,
    startRecording,
    stopAndSubmit
  };
};
