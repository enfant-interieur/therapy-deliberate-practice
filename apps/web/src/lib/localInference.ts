import type { EvaluationInput, PracticeRunInput } from "@deliberate/shared";
import type { LocalRuntimeClient } from "./localRuntimeClient";

export type ClientTranscriptPayload = NonNullable<PracticeRunInput["client_transcript"]>;
export type ClientEvaluationPayload = NonNullable<PracticeRunInput["client_evaluation"]>;

export const fallbackLocalSttProvider: ClientTranscriptPayload["provider"] = {
  kind: "local",
  model: "local//stt"
};

export const runLocalTranscription = async ({
  client,
  blob,
  mimeType
}: {
  client: LocalRuntimeClient;
  blob: Blob;
  mimeType?: string | null;
}): Promise<ClientTranscriptPayload> => {
  const localResult = await client.transcribeAudio(blob, { mimeType });
  return {
    text: localResult.text,
    provider: localResult.provider,
    duration_ms: localResult.durationMs
  };
};

export const runLocalEvaluation = async ({
  client,
  input
}: {
  client: LocalRuntimeClient;
  input: EvaluationInput;
}): Promise<ClientEvaluationPayload & { requestId?: string }> => {
  const localResult = await client.evaluateDeliberatePractice(input);
  return {
    evaluation: localResult.evaluation,
    provider: localResult.provider,
    duration_ms: localResult.durationMs,
    requestId: localResult.requestId
  };
};
