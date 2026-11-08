import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribeWithOpenAI } from "../src/providers/openaiStt";
import {
  getErrorRequestId,
  getOpenAiAccessIssue,
} from "../src/providers/providerErrors";

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

test("speech failures carry allowlisted access issues without the provider's error message", async () => {
  for (const [status, code, issue] of [
    [401, "invalid_api_key", "OPENAI_KEY_REJECTED"],
    [403, "insufficient_permissions", "OPENAI_ACCESS_DENIED"],
    [429, "credit_balance_exhausted", "OPENAI_QUOTA_EXHAUSTED"],
    [429, "project_spend_limit_exceeded", "OPENAI_QUOTA_EXHAUSTED"],
    [429, "rate_limit_exceeded", undefined],
    [400, "invalid_audio", undefined],
  ] as const) {
    const client = {
      audio: {
        transcriptions: {
          create: async () => {
            throw Object.assign(new Error("private-provider-error"), {
              status,
              code,
              request_id: "req_safe",
            });
          },
        },
      },
    };
    await assert.rejects(
      transcribeWithOpenAI(
        { apiKey: "test", audioBase64: toBase64("audio") },
        client as any,
      ),
      (error: unknown) => {
        assert.equal(getOpenAiAccessIssue(error), issue);
        assert.equal(getErrorRequestId(error), "req_safe");
        assert.doesNotMatch(String(error), /private-provider-error/);
        return true;
      },
    );
  }
});
