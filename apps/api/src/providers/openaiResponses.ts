import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { attemptJsonRepair } from "../utils/jsonRepair";
import { safeTruncate } from "../utils/logger";

type OpenAIResponseInput = {
  apiKey: string;
  model: string;
  instructions?: string;
  input: string;
  temperature?: number;
};

type StructuredResponseInput<T> = OpenAIResponseInput & {
  schemaName: string;
  schema: z.ZodSchema<T>;
};

type OpenAIResponseResult<T> = {
  value: T;
  responseId?: string;
};

type OpenAITextResult = {
  text: string;
  responseId?: string;
};

/*
  Responses API mapping:
  - System prompt goes into the `instructions` field.
  - User input goes into the `input` field (plain text).
  - Structured Outputs attach `text.format: { type: "json_schema", json_schema: { name, schema, strict: true } }`.
  - Output text/JSON is extracted from `response.output[].content[].text` (type `output_text`) or
    the top-level `output_text` convenience field when present.
  - Structured outputs are parsed/repair-attempted once and then validated with Zod as the final gate.
*/

const openaiEndpoint = "https://api.openai.com/v1/responses";

const getRequestId = (headers: Headers) =>
  headers.get("x-request-id") ??
  headers.get("openai-request-id") ??
  headers.get("request-id") ??
  undefined;

const extractOutputText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }
  const output = record.output ?? [];
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
};

const buildStrictJsonSchema = (schema: z.ZodSchema<unknown>) => {
  const jsonSchema = zodToJsonSchema(schema, {
    name: "StructuredOutput",
    $refStrategy: "none",
    target: "jsonSchema7"
  });
  const enforceStrict = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = record.type;
    if (type === "object" && record.properties) {
      if (!("additionalProperties" in record)) {
        record.additionalProperties = false;
      }
      for (const value of Object.values(record.properties as Record<string, unknown>)) {
        enforceStrict(value);
      }
    }
    if (type === "array" && record.items) {
      enforceStrict(record.items);
    }
    if (record.anyOf && Array.isArray(record.anyOf)) {
      for (const value of record.anyOf) {
        enforceStrict(value);
      }
    }
    if (record.oneOf && Array.isArray(record.oneOf)) {
      for (const value of record.oneOf) {
        enforceStrict(value);
      }
    }
    if (record.allOf && Array.isArray(record.allOf)) {
      for (const value of record.allOf) {
        enforceStrict(value);
      }
    }
  };
  enforceStrict(jsonSchema);
  return jsonSchema;
};

export const createTextResponse = async ({
  apiKey,
  model,
  instructions,
  input,
  temperature
}: OpenAIResponseInput): Promise<OpenAITextResult> => {
  const response = await fetch(openaiEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input,
      instructions,
      temperature
    })
  });

  const responseId = getRequestId(response.headers);
  if (!response.ok) {
    const body = safeTruncate(await response.text(), 200);
    throw new Error(
      `OpenAI Responses failed (${response.status})${responseId ? ` [${responseId}]` : ""}: ${body}`
    );
  }

  const payload = await response.json();
  const text = extractOutputText(payload);
  if (!text) {
    throw new Error(
      `OpenAI Responses returned empty output${responseId ? ` [${responseId}]` : ""}`
    );
  }
  return { text, responseId };
};

export const createStructuredResponse = async <T>({
  apiKey,
  model,
  instructions,
  input,
  temperature,
  schemaName,
  schema
}: StructuredResponseInput<T>): Promise<OpenAIResponseResult<T>> => {
  const jsonSchema = buildStrictJsonSchema(schema);
  const response = await fetch(openaiEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input,
      instructions,
      temperature,
      text: {
        format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            schema: jsonSchema,
            strict: true
          }
        }
      }
    })
  });

  const responseId = getRequestId(response.headers);
  if (!response.ok) {
    const body = safeTruncate(await response.text(), 200);
    throw new Error(
      `OpenAI Responses failed (${response.status})${responseId ? ` [${responseId}]` : ""}: ${body}`
    );
  }

  const payload = await response.json();
  const rawText = extractOutputText(payload);
  if (!rawText) {
    throw new Error(
      `OpenAI Responses returned empty output${responseId ? ` [${responseId}]` : ""}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    const repaired = attemptJsonRepair(rawText);
    if (repaired) {
      parsed = JSON.parse(repaired);
    } else {
      throw new Error(
        `OpenAI Responses returned invalid JSON${
          responseId ? ` [${responseId}]` : ""
        }: ${safeTruncate(String(error), 120)}`
      );
    }
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `OpenAI Responses schema validation failed${
        responseId ? ` [${responseId}]` : ""
      }: ${safeTruncate(validated.error.message, 200)}`
    );
  }

  return { value: validated.data, responseId };
};
