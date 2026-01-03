import assert from "node:assert/strict";
import { test } from "node:test";
import { synthesizeWithOpenAI } from "../src/providers/openaiTts";

test("synthesizeWithOpenAI converts bytes and falls back content type", async () => {
  const response = {
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: new Headers(["content-type", "audio/mpeg"])
  };
  const client = {
    audio: {
      speech: {
        create: async () => response
      }
    }
  };

  const result = await synthesizeWithOpenAI(
    {
      apiKey: "test",
      model: "gpt-4o-mini-tts",
      voice: "marin",
      format: "mp3",
      text: "hello"
    },
    client as any
  );

  assert.deepEqual([...result.bytes], [1, 2, 3]);
  assert.equal(result.contentType, "audio/mpeg");
});
