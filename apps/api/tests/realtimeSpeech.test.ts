import test from "node:test";
import assert from "node:assert/strict";
import {
  pcmToWave,
  synthesizeRealtimeSpeech,
  type SpeechSocketFactory,
} from "../src/providers/realtimeSpeech";
import {
  CLOUD_MODEL_ROLES,
  REQUESTED_ROUTINE_MODEL,
  REQUESTED_ROUTINE_MODEL_AVAILABLE,
} from "@deliberate/shared";

function fixture(mode = "ok", returnedText = "Bonjour.") {
  const sent: Record<string, any>[] = [],
    handlers = new Map<string, Set<(e: { data?: unknown }) => void>>();
  let closes = 0;
  const emit = (e: object) =>
    handlers.get("message")?.forEach((fn) => fn({ data: JSON.stringify(e) }));
  const socket = {
    addEventListener(type: string, fn: (e: { data?: unknown }) => void) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: { data?: unknown }) => void) {
      handlers.get(type)?.delete(fn);
    },
    accept() {
      queueMicrotask(() => emit({ type: "session.created" }));
    },
    close() {
      closes++;
    },
    send(data: string) {
      const e = JSON.parse(data);
      sent.push(e);
      queueMicrotask(() => {
        if (mode === "error") {
          emit({ type: "error", error: { message: "private diagnostic" } });
          return;
        }
        if (e.type === "session.update") {
          emit({ type: "session.updated" });
          return;
        }
        emit({ type: "response.created", response: { id: "resp_test" } });
        emit({
          type: "response.output_audio.delta",
          response_id: "resp_test",
          delta: btoa(String.fromCharCode(0, 1, 0, 2)),
        });
        emit({
          type: "response.output_audio_transcript.delta",
          response_id: "resp_test",
          delta: mode === "rewrite" ? "Un autre texte" : returnedText,
        });
        if (mode !== "truncated")
          emit({
            type: "response.output_audio.done",
            response_id: "resp_test",
          });
        emit({
          type: "response.done",
          response: {
            id: "resp_test",
            status: mode === "limit" ? "incomplete" : "completed",
          },
        });
      });
    },
  };
  return {
    factory: (async () => socket) as SpeechSocketFactory,
    sent,
    closes: () => closes,
    handlers,
  };
}
const input = {
  apiKey: "synthetic-test-key",
  model: "gpt-realtime-2.1-mini",
  voice: "marin",
  text: "Bonjour.",
};

test("current model roles retain real model identities and do not fabricate 6.1 Luna availability", () => {
  assert.equal(CLOUD_MODEL_ROLES.reasoning, "gpt-6.1-sol");
  assert.equal(CLOUD_MODEL_ROLES.routine, "gpt-6-luna");
  assert.equal(REQUESTED_ROUTINE_MODEL, "gpt-6.1-luna");
  assert.equal(REQUESTED_ROUTINE_MODEL_AVAILABLE, false);
  assert.equal(CLOUD_MODEL_ROLES.transcription, "gpt-transcribe");
  assert.equal(CLOUD_MODEL_ROLES.speech, "gpt-realtime-2.1-mini");
});

test("speech waits for configured session, uses one text-only response, wraps 24k mono PCM as WAV and closes", async () => {
  const f = fixture();
  const result = await synthesizeRealtimeSpeech(input, f.factory);
  assert.equal(result.contentType, "audio/wav");
  assert.equal(new TextDecoder().decode(result.bytes.slice(0, 4)), "RIFF");
  const view = new DataView(result.bytes.buffer);
  assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 4);
  assert.equal(result.bytes.length, 48);
  assert.deepEqual(
    f.sent.map((e) => e.type),
    ["session.update", "response.create"],
  );
  assert.deepEqual(f.sent[0].session.audio.output.format, {
    type: "audio/pcm",
    rate: 24000,
  });
  assert.equal(f.sent[1].response.conversation, "none");
  assert.equal(f.sent[1].response.input[0].content[0].text, "Bonjour.");
  assert.equal(JSON.stringify(f.sent).includes(input.apiKey), false);
  assert.equal(f.closes(), 1);
  assert([...f.handlers.values()].every((h) => h.size === 0));
});
for (const mode of ["rewrite", "truncated", "limit", "error"]) {
  test(`speech rejects ${mode} without caching incomplete or changed patient dialogue`, async () => {
    const f = fixture(mode);
    await assert.rejects(
      synthesizeRealtimeSpeech(input, f.factory),
      /speech_text_mismatch|realtime_response_incomplete|realtime_provider_error/,
    );
    assert.equal(f.closes(), 1);
  });
}
test("speech preserves word boundaries and contractions while ignoring case and punctuation", async () => {
  for (const [source, returned] of [
    ["I want to be a part of it.", "I want to be apart of it."],
    ["We'll try again.", "Well try again."],
  ]) {
    const f = fixture("ok", returned);
    await assert.rejects(
      synthesizeRealtimeSpeech({ ...input, text: source }, f.factory),
      /speech_text_mismatch/,
    );
    assert.equal(f.closes(), 1);
  }
  const f = fixture("ok", "WE’LL try, again!");
  await synthesizeRealtimeSpeech(
    { ...input, text: "We'll try again." },
    f.factory,
  );
  assert.equal(f.closes(), 1);
});
test("speech validates bounds before connecting and expires a pending connection", async () => {
  let calls = 0;
  const never: SpeechSocketFactory = async () => {
    calls++;
    return new Promise(() => {});
  };
  await assert.rejects(
    synthesizeRealtimeSpeech({ ...input, text: " ".repeat(6001) }, never),
    /speech_input_out_of_bounds/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    synthesizeRealtimeSpeech(input, never, 10),
    /realtime_speech_timeout/,
  );
  assert.equal(calls, 1);
  assert.throws(() => pcmToWave([]), /invalid_speech_audio/);
  assert.throws(() => pcmToWave([new Uint8Array(3)]), /invalid_speech_audio/);
});
