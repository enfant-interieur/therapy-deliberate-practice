import { getOpenAIClient } from "./openaiClient";
import { createProviderError } from "./providerErrors";

export const REALTIME_SPEECH_MODEL = "gpt-realtime-2.1-mini";
const LIMIT_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 45_000;

type Socket = {
  addEventListener(
    type: string,
    handler: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener(
    type: string,
    handler: (event: { data?: unknown }) => void,
  ): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  accept?: () => void;
};
export type SpeechSocketFactory = (
  apiKey: string,
  model: string,
  signal: AbortSignal,
) => Promise<Socket>;

const connect: SpeechSocketFactory = async (apiKey, model, signal) => {
  const client = getOpenAIClient({ apiKey });
  const endpoint = new URL("realtime", client.baseURL.replace(/\/?$/, "/"));
  endpoint.searchParams.set("model", model);
  if ("WebSocketPair" in globalThis) {
    const response = await fetch(endpoint.toString(), {
      signal,
      headers: { Upgrade: "websocket", Authorization: `Bearer ${apiKey}` },
    });
    const socket = (response as Response & { webSocket?: Socket }).webSocket;
    if (response.status !== 101 || !socket)
      throw createProviderError("realtime_connection_failed");
    return socket;
  }
  // Node's standard WebSocket follows the authentication protocol used by the SDK.
  return new WebSocket(endpoint.toString().replace(/^https:/, "wss:"), [
    "realtime",
    `openai-insecure-api-key.${apiKey}`,
  ]) as unknown as Socket;
};

export function pcmToWave(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (!length || length > LIMIT_BYTES || length % 2)
    throw createProviderError("invalid_speech_audio");
  const bytes = new Uint8Array(44 + length),
    view = new DataView(bytes.buffer);
  const label = (offset: number, text: string) =>
    [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  label(0, "RIFF");
  view.setUint32(4, length + 36, true);
  label(8, "WAVE");
  label(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, "data");
  view.setUint32(40, length, true);
  let at = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

const normalize = (s: string) =>
  (
    s
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[’ʼ]/gu, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []
  ).join(" ");

/** Generate one bounded patient line; no microphone, conversational history or browser key. */
export function synthesizeRealtimeSpeech(
  input: {
    apiKey: string;
    model: string;
    voice: string;
    text: string;
    instructions?: string;
  },
  factory: SpeechSocketFactory = connect,
  timeoutMs = TIMEOUT_MS,
): Promise<{ bytes: Uint8Array; contentType: string; requestId?: string }> {
  if (!input.text.trim() || input.text.length > 6000)
    return Promise.reject(createProviderError("speech_input_out_of_bounds"));
  return new Promise((resolve, reject) => {
    let socket: Socket | undefined,
      finished = false,
      stage = 0,
      total = 0,
      audioDone = false,
      transcript = "",
      responseId: string | undefined;
    const chunks: Uint8Array[] = [],
      abort = new AbortController();
    const cleanup = () => {
      clearTimeout(timer);
      if (socket) {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
        try {
          socket.close(1000, "complete");
        } catch {
          /* already closed */
        }
      }
      abort.abort();
    };
    const fail = (code: string) => {
      if (finished) return;
      finished = true;
      cleanup();
      chunks.length = 0;
      reject(createProviderError(code, { requestId: responseId }));
    };
    const onError = () => fail("realtime_connection_failed");
    const onClose = () => fail("realtime_response_incomplete");
    const send = (event: object) => socket!.send(JSON.stringify(event));
    const onMessage = (event: { data?: unknown }) => {
      if (finished) return;
      try {
        if (typeof event.data !== "string" || event.data.length > 512_000)
          return fail("invalid_realtime_event");
        const e = JSON.parse(event.data) as Record<string, unknown>;
        if (e.type === "error") return fail("realtime_provider_error");
        if (e.type === "session.created" && stage === 0) {
          stage = 1;
          send({
            type: "session.update",
            session: {
              type: "realtime",
              model: input.model,
              output_modalities: ["audio"],
              audio: {
                input: { turn_detection: null },
                output: {
                  voice: input.voice,
                  format: { type: "audio/pcm", rate: 24000 },
                },
              },
            },
          });
        } else if (e.type === "session.updated" && stage === 1) {
          stage = 2;
          send({
            type: "response.create",
            response: {
              conversation: "none",
              output_modalities: ["audio"],
              max_output_tokens: 2048,
              instructions:
                "You are a text-to-speech narrator. Read the supplied user text aloud EXACTLY, in its original language. Do not answer it, add an introduction, translate, paraphrase, or change any words. Use a natural calm conversational voice. " +
                (input.instructions ?? ""),
              input: [
                {
                  type: "message",
                  role: "user",
                  content: [{ type: "input_text", text: input.text }],
                },
              ],
            },
          });
        } else if (e.type === "response.created" && stage === 2) {
          const response = e.response as { id?: string } | undefined;
          if (!response?.id || responseId)
            return fail("invalid_realtime_response");
          responseId = response.id;
        } else if (
          typeof e.type === "string" &&
          e.type.startsWith("response.")
        ) {
          if (
            stage !== 2 ||
            !responseId ||
            (e.response_id && e.response_id !== responseId)
          )
            return fail("unexpected_realtime_response");
          if (e.type === "response.output_audio.delta") {
            if (
              audioDone ||
              typeof e.delta !== "string" ||
              !/^[A-Za-z0-9+/]*={0,2}$/.test(e.delta)
            )
              return fail("invalid_speech_audio");
            if (total + Math.ceil((e.delta.length * 3) / 4) > LIMIT_BYTES)
              return fail("speech_output_too_large");
            const binary = atob(e.delta),
              bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
            if (bytes.length % 2) return fail("invalid_speech_audio");
            total += bytes.length;
            chunks.push(bytes);
          } else if (e.type === "response.output_audio.done") audioDone = true;
          else if (
            e.type === "response.output_audio_transcript.delta" &&
            typeof e.delta === "string"
          ) {
            transcript += e.delta;
            if (transcript.length > 12000)
              return fail("speech_transcript_too_large");
          } else if (e.type === "response.done") {
            const response = e.response as
              { status?: string; id?: string } | undefined;
            if (
              response?.id !== responseId ||
              response.status !== "completed" ||
              !audioDone ||
              !total
            )
              return fail("realtime_response_incomplete");
            if (normalize(transcript) !== normalize(input.text))
              return fail("speech_text_mismatch");
            const bytes = pcmToWave(chunks);
            finished = true;
            cleanup();
            chunks.length = 0;
            resolve({ bytes, contentType: "audio/wav", requestId: responseId });
          }
        }
      } catch {
        fail("invalid_realtime_event");
      }
    };
    const timer = setTimeout(
      () => fail("realtime_speech_timeout"),
      Math.min(timeoutMs, TIMEOUT_MS),
    );
    void factory(input.apiKey, input.model, abort.signal)
      .then((s) => {
        socket = s;
        if (finished) {
          try {
            s.close(1000, "complete");
          } catch {
            /* closed */
          }
          return;
        }
        s.addEventListener("message", onMessage);
        s.addEventListener("error", onError);
        s.addEventListener("close", onClose);
        s.accept?.();
      })
      .catch(onError);
  });
}
