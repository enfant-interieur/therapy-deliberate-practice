import type { SttProvider } from "@deliberate/shared";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";

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
  model: "whisper-large-v3",
  healthCheck: () => healthCheck(env.localSttUrl),
  transcribe: async (audio) => {
    const start = Date.now();
    logger?.("info", "stt.transcribe.http_start", {
      provider: { kind: "local", model: "whisper-large-v3" }
    });
    const response = await fetch(`${env.localSttUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio })
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "stt.transcribe.http_error", {
        provider: { kind: "local", model: "whisper-large-v3" },
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`Local STT failed (${response.status})`);
    }
    logger?.("info", "stt.transcribe.http_ok", {
      provider: { kind: "local", model: "whisper-large-v3" },
      duration_ms: Date.now() - start
    });
    return response.json();
  }
});

export const OpenAISttProvider = (
  { apiKey }: { apiKey: string },
  logger?: LogFn
): SttProvider => ({
  kind: "openai",
  model: "whisper-1",
  healthCheck: async () => Boolean(apiKey),
  transcribe: async (audio) => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const start = Date.now();
    logger?.("info", "stt.transcribe.http_start", {
      provider: { kind: "openai", model: "whisper-1" }
    });
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: (() => {
        const form = new FormData();
        form.append("model", "whisper-1");
        form.append("file", new Blob([base64ToUint8Array(audio)]), "audio.webm");
        return form;
      })()
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "stt.transcribe.http_error", {
        provider: { kind: "openai", model: "whisper-1" },
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`OpenAI STT failed (${response.status})`);
    }
    const data = (await response.json()) as { text: string };
    logger?.("info", "stt.transcribe.http_ok", {
      provider: { kind: "openai", model: "whisper-1" },
      duration_ms: Date.now() - start
    });
    return { text: data.text };
  }
});
