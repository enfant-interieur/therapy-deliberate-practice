import type { SttProvider } from "@deliberate/shared";
import { env } from "../env";

const healthCheck = async (url: string) => {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

export const LocalWhisperSttProvider = (): SttProvider => ({
  kind: "local",
  model: "whisper-large-v3",
  healthCheck: () => healthCheck(env.localSttUrl),
  transcribe: async (audio) => {
    const response = await fetch(`${env.localSttUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio })
    });
    if (!response.ok) {
      throw new Error("Local STT failed");
    }
    return response.json();
  }
});

export const OpenAISttProvider = (): SttProvider => ({
  kind: "openai",
  model: "whisper-1",
  healthCheck: async () => Boolean(env.openaiApiKey),
  transcribe: async (audio) => {
    if (!env.openaiApiKey) {
      throw new Error("OpenAI key missing");
    }
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`
      },
      body: (() => {
        const form = new FormData();
        form.append("model", "whisper-1");
        form.append("file", new Blob([Buffer.from(audio, "base64")]), "audio.webm");
        return form;
      })()
    });
    if (!response.ok) {
      throw new Error("OpenAI STT failed");
    }
    const data = (await response.json()) as { text: string };
    return { text: data.text };
  }
});
