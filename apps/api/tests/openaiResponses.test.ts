import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { createStructuredResponse, createTextResponse } from "../src/providers/openaiResponses";

const mockOpenAI = (payload: unknown) => ({
  responses: {
    create: async () => payload
  }
});

test("createTextResponse extracts output_text", async () => {
  const result = await createTextResponse({
    apiKey: "test-key",
    model: "gpt-5.1",
    input: "hi",
    client: mockOpenAI({
      output: [{ content: [{ type: "output_text", text: "hello world" }] }],
      _request_id: "req_123"
    })
  });

  assert.equal(result.text, "hello world");
  assert.equal(result.responseId, "req_123");
});

test("createStructuredResponse validates with Zod", async () => {
  const schema = z.object({ ok: z.boolean() });
  const result = await createStructuredResponse({
    apiKey: "test-key",
    model: "gpt-5.1",
    input: "payload",
    schemaName: "TestSchema",
    schema,
    client: mockOpenAI({
      output: [{ content: [{ type: "output_text", text: "{\"ok\":true}" }] }],
      _request_id: "req_456"
    })
  });

  assert.deepEqual(result.value, { ok: true });
  assert.equal(result.responseId, "req_456");
});

test("no direct OpenAI fetch usage outside providers (except key validation)", async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const srcRoot = path.resolve(__dirname, "../src");
  const allowedFile = path.join(srcRoot, "app.ts");

  const files: string[] = [];
  const walk = async (dir: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(full);
      }
    }
  };

  await walk(srcRoot);
  const offenders: string[] = [];
  for (const file of files) {
    const contents = await fs.readFile(file, "utf8");
    if (!contents.includes("api.openai.com/v1")) continue;
    if (file === allowedFile) continue;
    offenders.push(path.relative(srcRoot, file));
  }

  assert.deepEqual(offenders, []);
});
