import OpenAI from "openai";
import type { SttTranscribeOptions, Transcript } from "@deliberate/shared";
import { getOpenAIClient } from "./openaiClient";
import { createProviderError, getErrorRequestId } from "./providerErrors";
import { safeTruncate } from "../utils/logger";

export type OpenAiSttResult = {
  transcript: Transcript;
  requestId?: string;
};

const base64ToUint8Array = (input: string) => {
  if (typeof atob === "function") {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return Uint8Array.from(Buffer.from(input, "base64"));
};

export const mimeTypeToFilename = (mimeType?: string) => {
  if (!mimeType) return "audio.webm";
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("audio/mp4") || normalized.includes("audio/aac")) {
    return "audio.m4a";
  }
  if (normalized.includes("audio/mpeg")) {
    return "audio.mp3";
  }
  if (normalized.includes("audio/wav")) {
    return "audio.wav";
  }
  if (normalized.includes("audio/webm")) {
    return "audio.webm";
  }
  return "audio.webm";
};

const createFile = (bytes: Uint8Array, filename: string, mimeType: string) => {
  const blob = new Blob([bytes], { type: mimeType });
  if (typeof File !== "undefined") {
    return new File([blob], filename, { type: mimeType });
  }
  const fileLike = blob as Blob & { name?: string };
  fileLike.name = filename;
  return fileLike;
};

const normalizeSegments = (segments?: Array<Record<string, unknown> & { text?: string }>) =>
  Array.isArray(segments)
    ? segments.map((segment) => ({ ...segment, text: segment.text ?? "" }))
    : undefined;

export const transcribeWithOpenAI = async (
  input: {
    apiKey: string;
    audioBase64: string;
    opts?: SttTranscribeOptions;
  },
  client?: OpenAI
): Promise<OpenAiSttResult> => {
  const openai = client ?? getOpenAIClient(input.apiKey);
  const model = input.opts?.model ?? "gpt-4o-mini-transcribe";
  const isDiarize = model === "gpt-4o-transcribe-diarize";
  const responseFormat = input.opts?.responseFormat ?? (isDiarize ? "diarized_json" : undefined);
  const mimeType = input.opts?.mimeType ?? "audio/webm";
  const filename = mimeTypeToFilename(input.opts?.mimeType);
  const file = createFile(base64ToUint8Array(input.audioBase64), filename, mimeType);

  try {
    const response = await openai.audio.transcriptions.create({
      file,
      model,
      ...(input.opts?.prompt &&
      (model === "gpt-4o-mini-transcribe" || model === "gpt-4o-transcribe")
        ? { prompt: input.opts.prompt }
        : {}),
      ...(responseFormat && responseFormat !== "json" ? { response_format: responseFormat } : {}),
      ...(isDiarize && responseFormat === "diarized_json"
        ? {
            chunking_strategy: input.opts?.chunkingStrategy ?? "auto",
            extra_body: {
              ...(input.opts?.knownSpeakerNames
                ? { known_speaker_names: input.opts.knownSpeakerNames }
                : {}),
              ...(input.opts?.knownSpeakerReferences
                ? { known_speaker_references: input.opts.knownSpeakerReferences }
                : {})
            }
          }
        : {})
    });

    const requestId = (response as { _request_id?: string })._request_id;
    if (typeof response === "string") {
      return { transcript: { text: response }, requestId };
    }

    if (responseFormat === "text") {
      const text = (response as { text?: string }).text ?? "";
      return { transcript: { text }, requestId };
    }

    const responseRecord = response as {
      text?: string;
      segments?: Array<Record<string, unknown> & { text?: string }>;
    };

    if (isDiarize && responseFormat === "diarized_json") {
      const segments = normalizeSegments(responseRecord.segments);
      const text =
        responseRecord.text ??
        segments?.map((segment) => segment.text).filter((value) => value.length > 0).join("\n") ??
        "";
      return { transcript: segments ? { text, segments } : { text }, requestId };
    }

    return { transcript: { text: responseRecord.text ?? "" }, requestId };
  } catch (error) {
    const requestId = getErrorRequestId(error);
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status?: number }).status
        : undefined;
    const message =
      error instanceof Error ? safeTruncate(error.message, 200) : safeTruncate(String(error), 200);
    throw createProviderError(
      `OpenAI STT failed${status ? ` (${status})` : ""}${
        requestId ? ` [${requestId}]` : ""
      }: ${message}`,
      {
        requestId,
        logFields: status ? { status } : undefined
      }
    );
  }
};
