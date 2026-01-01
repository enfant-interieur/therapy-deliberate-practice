import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTtsCacheKey, normalizeTtsText } from "../src/utils/ttsCache";

test("buildTtsCacheKey is deterministic across whitespace", async () => {
  const input = {
    text: "Hello   there\nfriend",
    model: "tts-1",
    voice: "alloy",
    format: "mp3"
  };
  const first = await buildTtsCacheKey(input);
  const second = await buildTtsCacheKey({ ...input, text: "Hello there friend" });

  assert.equal(first.cacheKey, second.cacheKey);
  assert.equal(normalizeTtsText(input.text), "Hello there friend");
});
