import OpenAI from "openai";
import { getOpenAIClient } from "./openaiClient";
import { createProviderError, getErrorRequestId } from "./providerErrors";
import { safeTruncate } from "../utils/logger";
import type { TtsFormat } from "./tts";

const formatToContentType: Record<TtsFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm"
};

export type OpenAiTtsResult = {
  bytes: Uint8Array;
  contentType: string;
  requestId?: string;
};

export const synthesizeWithOpenAI = async (
  input: {
    apiKey: string;
    model: string;
    voice: string;
    format: TtsFormat;
    text: string;
    instructions?: string;
  },
  client?: OpenAI
): Promise<OpenAiTtsResult> => {
  const openai = client ?? getOpenAIClient(input.apiKey);
  try {
    const response = await openai.audio.speech.create({
      model: input.model,
      voice: input.voice,
      input: input.text,
      response_format: input.format,
      ...(input.instructions ? { instructions: input.instructions } : {})
    });

    const buffer = new Uint8Array(await response.arrayBuffer());
    const headers = response.headers;
    const contentType =
      headers?.get("content-type") ?? formatToContentType[input.format] ?? "audio/mpeg";
    const requestId =
      response.headers?.get("x-request-id") ??
      response.headers?.get("openai-request-id") ??
      undefined;

    return { bytes: buffer, contentType, requestId };
  } catch (error) {
    const requestId = getErrorRequestId(error);
    const status =
      error && typeof error === "object" && "status" in error
        ? (error as { status?: number }).status
        : undefined;
    const message =
      error instanceof Error ? safeTruncate(error.message, 200) : safeTruncate(String(error), 200);
    throw createProviderError(
      `OpenAI TTS failed${status ? ` (${status})` : ""}${
        requestId ? ` [${requestId}]` : ""
      }: ${message}`,
      {
        requestId,
        logFields: status ? { status } : undefined
      }
    );
  }
};
