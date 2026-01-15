import { z } from "zod";
import type { SttTranscribeOptions, Transcript } from "@deliberate/shared";
import { buildStrictJsonSchema } from "@deliberate/shared";
import { attemptJsonRepair } from "../utils/jsonRepair";
import { safeTruncate } from "../utils/logger";
import { createProviderError } from "./providerErrors";
import type { TtsFormat } from "./tts";

/*
  Local Runtime Suite (OpenAI-compatible) endpoints:
  - GET  {base}/health
  - GET  {base}/v1/models
  - POST {base}/v1/responses
  - POST {base}/v1/audio/transcriptions
  - POST {base}/v1/audio/speech

  Source: services/local-runtime-suite/python/local_runtime/main.py
*/

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, "");

const buildUrl = (baseUrl: string, path: string) => `${normalizeBaseUrl(baseUrl)}${path}`;

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

const mimeTypeToFilename = (mimeType?: string) => {
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

const resolveResponseFormat = (opts?: SttTranscribeOptions) => {
  const isDiarize = opts?.model === "gpt-4o-transcribe-diarize";
  return opts?.responseFormat ?? (isDiarize ? "diarized_json" : undefined);
};

const extractOutputText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }
  const output = record.output ?? [];
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
};

export const localSuiteHealthCheck = async (baseUrl: string) => {
  try {
    const response = await fetch(buildUrl(baseUrl, "/health"));
    return response.ok;
  } catch {
    return false;
  }
};

export const localSuiteTranscribe = async ({
  baseUrl,
  audioBase64,
  opts
}: {
  baseUrl: string;
  audioBase64: string;
  opts?: SttTranscribeOptions;
}): Promise<{ transcript: Transcript }> => {
  const mimeType = opts?.mimeType ?? "audio/webm";
  const filename = mimeTypeToFilename(opts?.mimeType);
  const file = createFile(base64ToUint8Array(audioBase64), filename, mimeType);
  const formData = new FormData();
  formData.append("file", file);
  if (opts?.model) {
    formData.append("model", opts.model);
  }
  if (opts?.language) {
    formData.append("language", opts.language);
  }
  if (opts?.prompt) {
    formData.append("prompt", opts.prompt);
  }
  const responseFormat = resolveResponseFormat(opts);
  if (responseFormat) {
    formData.append("response_format", responseFormat);
  }

  const response = await fetch(buildUrl(baseUrl, "/v1/audio/transcriptions"), {
    method: "POST",
    body: formData
  });
  if (!response.ok) {
    const body = safeTruncate(await response.text(), 200);
    throw new Error(`Local STT failed (${response.status}): ${body}`);
  }

  if (responseFormat === "text") {
    const text = await response.text();
    return { transcript: { text } };
  }

  const payload = (await response.json()) as {
    text?: string;
    segments?: Array<Record<string, unknown> & { text?: string }>;
  };
  const segments = normalizeSegments(payload.segments);
  const text =
    payload.text ??
    segments?.map((segment) => segment.text).filter((value) => value.length > 0).join("\n") ??
    "";
  return { transcript: segments ? { text, segments } : { text } };
};

const formatToContentType: Record<TtsFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm"
};

export const localSuiteSynthesize = async ({
  baseUrl,
  text,
  voice,
  format,
  instructions
}: {
  baseUrl: string;
  text: string;
  voice: string;
  format: TtsFormat;
  instructions?: string;
}) => {
  const response = await fetch(buildUrl(baseUrl, "/v1/audio/speech"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      voice,
      response_format: format,
      ...(instructions ? { instructions } : {})
    })
  });

  if (!response.ok) {
    const body = safeTruncate(await response.text(), 200);
    throw new Error(`Local TTS failed (${response.status}): ${body}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType =
    response.headers.get("content-type") ?? formatToContentType[format] ?? "audio/mpeg";
  return { bytes, contentType };
};

export const localSuiteStructuredResponse = async <T>({
  baseUrl,
  instructions,
  input,
  temperature,
  schemaName,
  schema
}: {
  baseUrl: string;
  instructions?: string;
  input: string;
  temperature?: number;
  schemaName: string;
  schema: z.ZodSchema<T>;
}): Promise<{ value: T; responseId?: string; responseObjectId?: string }> => {
  const jsonSchema = buildStrictJsonSchema(schema, schemaName);
  const response = await fetch(buildUrl(baseUrl, "/v1/responses"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input,
      instructions,
      temperature,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          schema: jsonSchema,
          strict: true
        }
      }
    })
  });

  if (!response.ok) {
    const body = safeTruncate(await response.text(), 200);
    throw createProviderError(`Local responses failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as {
    id?: string;
    request_id?: string;
    _request_id?: string;
  };
  const responseId = payload._request_id ?? payload.request_id;
  const responseObjectId = payload.id;
  const rawText = extractOutputText(payload);
  if (!rawText) {
    throw createProviderError(
      `Local responses returned empty output${responseId ? ` [${responseId}]` : ""}`,
      { requestId: responseId }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const repaired = attemptJsonRepair(rawText);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw createProviderError(
        `Local responses returned invalid JSON${
          responseId ? ` [${responseId}]` : ""
        }: ${safeTruncate(String(error), 120)}`,
        { requestId: responseId }
      );
    }
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw createProviderError(
      `Local responses schema validation failed${
        responseId ? ` [${responseId}]` : ""
      }: ${safeTruncate(validated.error.message, 200)}`,
      { requestId: responseId }
    );
  }

  return { value: validated.data, responseId, responseObjectId };
};
