import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribeWithOpenAI } from "../src/providers/openaiStt";

const toBase64 = (input: string) => {
  if (typeof btoa === "function") return btoa(input);
  return Buffer.from(input, "utf8").toString("base64");
};

test("transcribeWithOpenAI sends the current model's language and JSON contract", async () => {
  let fileName: string | undefined;
  let request: Record<string, unknown> | undefined;
  const client = {
    audio: {
      transcriptions: {
        create: async (
          body: { file: { name?: string } } & Record<string, unknown>,
        ) => {
          request = body;
          fileName = body.file.name;
          return { text: "hello world", _request_id: "req_current_stt" };
        },
      },
    },
  };

  const result = await transcribeWithOpenAI(
    {
      apiKey: "test",
      audioBase64: toBase64("audio"),
      opts: {
        responseFormat: "text",
        language: "fr",
        prompt: "A synthetic practice response.",
      },
    },
    client as any,
  );

  assert.equal(result.transcript.text, "hello world");
  assert.equal(result.requestId, "req_current_stt");
  assert.equal(fileName, "audio.webm");
  assert.equal(request?.model, "gpt-transcribe");
  assert.deepEqual(request?.languages, ["fr"]);
  assert.equal(request?.prompt, "A synthetic practice response.");
  assert.equal(request?.stream, false);
  assert.equal(Object.hasOwn(request!, "response_format"), false);
  assert.equal(Object.hasOwn(request!, "language"), false);
});

test("transcribeWithOpenAI normalizes diarized_json", async () => {
  const client = {
    audio: {
      transcriptions: {
        create: async () => ({
          text: undefined,
          segments: [{ start: 0, end: 1, text: undefined }],
          _request_id: "req_stt",
        }),
      },
    },
  };

  const result = await transcribeWithOpenAI(
    {
      apiKey: "test",
      audioBase64: toBase64("audio"),
      opts: { model: "gpt-4o-transcribe-diarize" },
    },
    client as any,
  );

  assert.equal(result.transcript.text, "");
  assert.equal(result.transcript.segments?.[0]?.text, "");
});
