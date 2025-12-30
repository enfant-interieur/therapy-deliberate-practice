import type { SttProvider } from "@deliberate/shared";
import type { RuntimeEnv } from "../env";

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

export const LocalWhisperSttProvider = (env: RuntimeEnv): SttProvider => ({
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

export const OpenAISttProvider = (env: RuntimeEnv): SttProvider => ({
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
        form.append("file", new Blob([base64ToUint8Array(audio)]), "audio.webm");
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
