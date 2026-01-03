import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribeWithOpenAI } from "../src/providers/openaiStt";

const toBase64 = (input: string) => {
  if (typeof btoa === "function") return btoa(input);
  return Buffer.from(input, "utf8").toString("base64");
};

test("transcribeWithOpenAI supports text response", async () => {
  let fileName: string | undefined;
  const client = {
    audio: {
      transcriptions: {
        create: async ({ file }: { file: { name?: string } }) => {
          fileName = file.name;
          return "hello world";
        }
      }
    }
  };

  const result = await transcribeWithOpenAI(
    {
      apiKey: "test",
      audioBase64: toBase64("audio"),
      opts: { responseFormat: "text" }
    },
    client as any
  );

  assert.equal(result.transcript.text, "hello world");
  assert.equal(fileName, "audio.webm");
});

test("transcribeWithOpenAI normalizes diarized_json", async () => {
  const client = {
    audio: {
      transcriptions: {
        create: async () => ({
          text: undefined,
          segments: [{ start: 0, end: 1, text: undefined }],
          _request_id: "req_stt"
        })
      }
    }
  };

  const result = await transcribeWithOpenAI(
    {
      apiKey: "test",
      audioBase64: toBase64("audio"),
      opts: { model: "gpt-4o-transcribe-diarize" }
    },
    client as any
  );

  assert.equal(result.transcript.text, "");
  assert.equal(result.transcript.segments?.[0]?.text, "");
});
