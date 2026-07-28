import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { PracticeRunResponse } from "@deliberate/shared";
import type { MicRecorderResult } from "../../../hooks/useMicRecorder";
import {
  type LocalPracticePreparation,
  useCommitLocalMinigameRoundMutation,
  useCommitLocalPracticeMutation,
  usePrepareLocalPracticeMutation,
  useSubmitMinigameRoundMutation,
} from "../../../store/api";
import { useAppSelector } from "../../../store/hooks";
import {
  checkLocalRuntimeHealth,
  evaluateWithLocalRuntime,
  isLocalRuntimePairingError,
  requireLocalRuntimePairingKey,
  resolveLocalRuntimeGatewayOrigin,
  transcribeWithLocalRuntime,
} from "../../../localRuntime/client";

export type MinigameTurnContext = {
  patient_cache_key?: string;
  patient_statement_id?: string;
  timing?: {
    response_delay_ms?: number | null;
    response_duration_ms?: number | null;
    response_timer_seconds?: number;
    max_response_duration_seconds?: number;
  };
};

type RunMinigameAttemptInput = {
  sessionId: string;
  roundId: string;
  taskId: string;
  exampleId: string;
  playerId: string;
  recorded: MicRecorderResult;
  turnContext: MinigameTurnContext;
  onTranscript?: (response: PracticeRunResponse) => void;
  onEvaluating?: () => void;
};

export const useMinigameAttemptRunner = () => {
  const { t } = useTranslation();
  const settings = useAppSelector((state) => state.settings);
  const [submitRound] = useSubmitMinigameRoundMutation();
  const [prepareLocalPractice] = usePrepareLocalPracticeMutation();
  const [commitLocalPractice] = useCommitLocalPracticeMutation();
  const [commitLocalRound] = useCommitLocalMinigameRoundMutation();

  return useCallback(
    async ({
      sessionId,
      roundId,
      taskId,
      exampleId,
      playerId,
      recorded,
      turnContext,
      onTranscript,
      onEvaluating,
    }: RunMinigameAttemptInput): Promise<PracticeRunResponse> => {
      const finishWithOpenAi = async ({
        attemptId,
        transcript,
      }: {
        attemptId?: string;
        transcript?: string;
      } = {}) => {
        let resolvedAttemptId = attemptId;
        let resolvedTranscript = transcript;
        if (!resolvedAttemptId || !resolvedTranscript) {
          const transcription = await submitRound({
            sessionId,
            roundId,
            player_id: playerId,
            audio_base64: recorded.base64,
            audio_mime: recorded.mimeType,
            mode: "openai_only",
            practice_mode: "real_time",
            skip_scoring: true,
            turn_context: turnContext,
          }).unwrap();
          onTranscript?.(transcription);
          resolvedAttemptId = transcription.attemptId;
          resolvedTranscript = transcription.transcript?.text;
        }
        if (!resolvedAttemptId || !resolvedTranscript) {
          throw new Error(t("practice.error.transcriptionMissing"));
        }
        onEvaluating?.();
        return submitRound({
          sessionId,
          roundId,
          player_id: playerId,
          transcript_text: resolvedTranscript,
          attempt_id: resolvedAttemptId,
          mode: "openai_only",
          practice_mode: "real_time",
          turn_context: turnContext,
        }).unwrap();
      };

      if (settings.aiMode === "openai_only") {
        return finishWithOpenAi();
      }

      let localRuntime: {
        transcript: { text: string; model: string; durationMs: number };
        preparation: LocalPracticePreparation;
        token: string;
        llmBaseUrl: string;
      };
      try {
        const gatewayOrigin = resolveLocalRuntimeGatewayOrigin({
          baseUrl: settings.localAiBaseUrl,
          sttUrl: settings.localEndpoints.stt,
          llmUrl: settings.localEndpoints.llm,
        });
        const token = requireLocalRuntimePairingKey(gatewayOrigin);
        const health = await checkLocalRuntimeHealth(gatewayOrigin);
        if (health.status !== "ready") {
          throw new Error(
            t("practice.error.localRuntimeStatus", { status: health.status }),
          );
        }
        const transcript = await transcribeWithLocalRuntime({
          baseUrl: gatewayOrigin,
          token,
          audio: recorded.blob,
        });
        const preparation = await prepareLocalPractice({
          task_id: taskId,
          example_id: exampleId,
          input_mode: "audio",
          transcript: {
            text: transcript.text,
            model: transcript.model,
            duration_ms: transcript.durationMs,
          },
          minigame: {
            session_id: sessionId,
            round_id: roundId,
            player_id: playerId,
          },
        }).unwrap();
        localRuntime = {
          transcript,
          preparation,
          token,
          llmBaseUrl: gatewayOrigin,
        };
        onTranscript?.({
          requestId: preparation.requestId,
          attemptId: preparation.attemptId,
          score_trust: "local_unverified",
          transcript: {
            text: transcript.text,
            provider: { kind: "local", model: transcript.model },
            duration_ms: transcript.durationMs,
          },
        });
      } catch (error) {
        if (isLocalRuntimePairingError(error)) {
          throw new Error(t("practice.localRuntime.pairAgain"), {
            cause: error,
          });
        }
        if (settings.aiMode === "local_only" || !settings.hasOpenAiKey) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            t("practice.error.localTranscriptionFailed", { detail }),
            { cause: error },
          );
        }
        return finishWithOpenAi();
      }

      onEvaluating?.();
      let localEvaluation;
      try {
        localEvaluation = await evaluateWithLocalRuntime({
          baseUrl: localRuntime.llmBaseUrl,
          token: localRuntime.token,
          task: localRuntime.preparation.task,
          example: localRuntime.preparation.example,
          attemptId: localRuntime.preparation.attemptId,
          transcript: localRuntime.transcript.text,
        });
      } catch (error) {
        if (isLocalRuntimePairingError(error)) {
          throw new Error(t("practice.localRuntime.pairAgain"), {
            cause: error,
          });
        }
        if (settings.aiMode === "local_only" || !settings.hasOpenAiKey) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            t("practice.error.localEvaluationFailed", { detail }),
            { cause: error },
          );
        }
        return finishWithOpenAi({
          attemptId: localRuntime.preparation.attemptId,
          transcript: localRuntime.transcript.text,
        });
      }

      await commitLocalPractice({
        attempt_id: localRuntime.preparation.attemptId,
        input_mode: "audio",
        transcript: {
          text: localRuntime.transcript.text,
          model: localRuntime.transcript.model,
          duration_ms: localRuntime.transcript.durationMs,
        },
        evaluation: localEvaluation.evaluation,
        llm: {
          model: localEvaluation.model,
          duration_ms: localEvaluation.durationMs,
        },
        practice_mode: "real_time",
        turn_context: turnContext,
      }).unwrap();
      return commitLocalRound({
        sessionId,
        roundId,
        player_id: playerId,
        attempt_id: localRuntime.preparation.attemptId,
        turn_context: turnContext,
      }).unwrap();
    },
    [
      commitLocalPractice,
      commitLocalRound,
      prepareLocalPractice,
      settings.aiMode,
      settings.hasOpenAiKey,
      settings.localAiBaseUrl,
      settings.localEndpoints.llm,
      settings.localEndpoints.stt,
      submitRound,
      t,
    ],
  );
};
