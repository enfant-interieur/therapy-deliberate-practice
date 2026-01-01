import type { LogFn } from "../utils/logger";
import { safeTruncate } from "../utils/logger";
import { OPENAI_TTS_FORMAT, OPENAI_TTS_MODEL } from "./models";

export type TtsProvider = {
  kind: "local" | "openai";
  model: string;
  voice: string;
  format: "mp3" | "wav";
  healthCheck: () => Promise<boolean>;
  synthesize: (input: { text: string }) => Promise<{ bytes: Uint8Array; contentType: string }>;
};

export const OpenAITtsProvider = (
  {
    apiKey,
    model = OPENAI_TTS_MODEL,
    voice = "alloy",
    format = OPENAI_TTS_FORMAT
  }: { apiKey: string; model?: string; voice?: string; format?: "mp3" | "wav" },
  logger?: LogFn
): TtsProvider => ({
  kind: "openai",
  model,
  voice,
  format,
  healthCheck: async () => Boolean(apiKey),
  synthesize: async ({ text }) => {
    if (!apiKey) {
      throw new Error("OpenAI key missing");
    }
    const start = Date.now();
    logger?.("info", "tts.synthesize.http_start", {
      provider: { kind: "openai", model, voice, format },
      text_length: text.length
    });
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        voice,
        input: text,
        format
      })
    });
    if (!response.ok) {
      const body = safeTruncate(await response.text(), 200);
      logger?.("error", "tts.synthesize.http_error", {
        provider: { kind: "openai", model, voice, format },
        duration_ms: Date.now() - start,
        status: response.status,
        body
      });
      throw new Error(`OpenAI TTS failed (${response.status})`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "audio/mpeg";
    logger?.("info", "tts.synthesize.http_ok", {
      provider: { kind: "openai", model, voice, format },
      duration_ms: Date.now() - start,
      bytes: buffer.length
    });
    return { bytes: buffer, contentType };
  }
});
