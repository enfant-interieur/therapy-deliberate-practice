import type { SttProvider } from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { LOCAL_STT_MODEL, OPENAI_STT_MODEL } from "./models";

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

const base64ToUint8Array = (input: string) => {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const LocalWhisperSttProvider = (
  env: RuntimeEnv,
  logger?: LogFn
): SttProvider => ({
  kind: "local",
  model: LOCAL_STT_MODEL,
  healthCheck: () => healthCheck(env.localSttUrl),
  transcribe: async (audio) => {
    const start = Date.now();
    logger?.("info", "stt.transcribe.http_start", {
      provider: { kind: "local", model: LOCAL_STT_MODEL }
    });
    const response = await fetch(`${env.localSttUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio })
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "stt.transcribe.http_error", {
        provider: { kind: "local", model: LOCAL_STT_MODEL },
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`Local STT failed (${response.status})`);
    }
    logger?.("info", "stt.transcribe.http_ok", {
      provider: { kind: "local", model: LOCAL_STT_MODEL },
      duration_ms: Date.now() - start
    });
    return response.json();
  }
});

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

export const OpenAISttProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn
): SttProvider => ({
  kind: "openai",
  model: OPENAI_STT_MODEL,
  healthCheck: async () => Boolean(apiKey),
  transcribe: async (audio, opts) => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const model = opts?.model ?? OPENAI_STT_MODEL;
    const isDiarize = model === "gpt-4o-transcribe-diarize";
    const responseFormat = opts?.responseFormat ?? (isDiarize ? "diarized_json" : undefined);
    const start = Date.now();
    const logContext = {
      provider: { kind: "openai", model },
      ...(opts?.model ? { model_override: opts.model } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {})
    };
    logger?.("info", "stt.transcribe.http_start", logContext);
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: (() => {
        const form = new FormData();
        form.append("model", model);
        if (opts?.prompt && (model === "gpt-4o-mini-transcribe" || model === "gpt-4o-transcribe")) {
          form.append("prompt", opts.prompt);
        }
        if (responseFormat && responseFormat !== "json") {
          form.append("response_format", responseFormat);
        }
        if (isDiarize && responseFormat === "diarized_json") {
          form.append("chunking_strategy", opts?.chunkingStrategy ?? "auto");
          opts?.knownSpeakerNames?.forEach((name) => {
            form.append("known_speaker_names[]", name);
          });
          opts?.knownSpeakerReferences?.forEach((reference) => {
            form.append("known_speaker_references[]", reference);
          });
        }
        const filename = mimeTypeToFilename(opts?.mimeType);
        form.append(
          "file",
          new Blob([base64ToUint8Array(audio)], {
            type: opts?.mimeType ?? "audio/webm"
          }),
          filename
        );
        return form;
      })()
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "stt.transcribe.http_error", {
        ...logContext,
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`OpenAI STT failed (${response.status})`);
    }
    if (responseFormat === "text") {
      const text = await response.text();
      logger?.("info", "stt.transcribe.http_ok", {
        provider: { kind: "openai", model },
        duration_ms: Date.now() - start
      });
      return { text };
    }
    const data = (await response.json()) as {
      text?: string;
      segments?: Array<Record<string, unknown> & { text?: string }>;
    };
    if (isDiarize && responseFormat === "diarized_json") {
      const segments = Array.isArray(data.segments)
        ? data.segments.map((segment) => ({ ...segment, text: segment.text ?? "" }))
        : undefined;
      const text =
        data.text ??
        segments?.map((segment) => segment.text).filter((value) => value.length > 0).join("\n") ??
        "";
      logger?.("info", "stt.transcribe.http_ok", {
        provider: { kind: "openai", model },
        duration_ms: Date.now() - start
      });
      return segments ? { text, segments } : { text };
    }
    logger?.("info", "stt.transcribe.http_ok", {
      provider: { kind: "openai", model },
      duration_ms: Date.now() - start
    });
    return { text: data.text ?? "" };
  }
});
