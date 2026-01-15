import OpenAI from "openai";
import { z } from "zod";
import { buildStrictJsonSchema } from "@deliberate/shared";
import { attemptJsonRepair } from "../utils/jsonRepair";
import { safeTruncate } from "../utils/logger";
import { getOpenAIClient } from "./openaiClient";
import { createProviderError, getErrorRequestId } from "./providerErrors";

type OpenAIResponseInput = {
  apiKey: string;
  model: string;
  instructions?: string;
  input: string;
  temperature?: number;
  client?: OpenAI;
};

type StructuredResponseInput<T> = OpenAIResponseInput & {
  schemaName: string;
  schema: z.ZodSchema<T>;
};

type OpenAIResponseResult<T> = {
  value: T;
  responseId?: string;
  responseObjectId?: string;
};

type OpenAITextResult = {
  text: string;
  responseId?: string;
  responseObjectId?: string;
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

const getResponseRequestId = (response: unknown) => {
  if (!response || typeof response !== "object") return undefined;
  const record = response as { _request_id?: string; request_id?: string };
  return record._request_id ?? record.request_id;
};

const getResponseObjectId = (response: unknown) => {
  if (!response || typeof response !== "object") return undefined;
  const record = response as { id?: string };
  return record.id;
};

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

const toSdkError = (error: unknown, fallback: string) => {
  const requestId = getErrorRequestId(error);
  const status =
    error && typeof error === "object" && "status" in error
      ? (error as { status?: number }).status
      : undefined;
  const message =
    error instanceof Error ? safeTruncate(error.message, 200) : safeTruncate(String(error), 200);
  const prefix = status ? `${fallback} (${status})` : fallback;
  return createProviderError(
    `${prefix}${requestId ? ` [${requestId}]` : ""}: ${message}`,
    {
      requestId,
      logFields: status ? { status } : undefined
    }
  );
};

export const createTextResponse = async ({
  apiKey,
  model,
  instructions,
  input,
  temperature,
  client
}: OpenAIResponseInput): Promise<OpenAITextResult> => {
  const openai = client ?? getOpenAIClient({ apiKey });
  let response: unknown;
  try {
    response = await openai.responses.create({
      model,
      input,
      instructions,
      temperature
    });
  } catch (error) {
    throw toSdkError(error, "OpenAI Responses failed");
  }

  const responseId = getResponseRequestId(response);
  const responseObjectId = getResponseObjectId(response);
  const text = extractOutputText(response);
  if (!text) {
    throw createProviderError(
      `OpenAI Responses returned empty output${responseId ? ` [${responseId}]` : ""}`,
      { requestId: responseId }
    );
  }
  return { text, responseId, responseObjectId };
};

export const createStructuredResponse = async <T>({
  apiKey,
  model,
  instructions,
  input,
  temperature,
  schemaName,
  schema,
  client
}: StructuredResponseInput<T>): Promise<OpenAIResponseResult<T>> => {
  const jsonSchema = buildStrictJsonSchema(schema, schemaName);
  const openai = client ?? getOpenAIClient({ apiKey });
  let response: unknown;
  try {
    response = await openai.responses.create({
      model,
      input,
      instructions,
      temperature,
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          schema: jsonSchema,
          strict: true
        }
      }
    });
  } catch (error) {
    throw toSdkError(error, "OpenAI Responses failed");
  }

  const responseId = getResponseRequestId(response);
  const responseObjectId = getResponseObjectId(response);
  const rawText = extractOutputText(response);
  if (!rawText) {
    throw createProviderError(
      `OpenAI Responses returned empty output${responseId ? ` [${responseId}]` : ""}`,
      { requestId: responseId }
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
      throw createProviderError(
        `OpenAI Responses returned invalid JSON${
          responseId ? ` [${responseId}]` : ""
        }: ${safeTruncate(String(error), 120)}`,
        { requestId: responseId }
      );
    }
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw createProviderError(
      `OpenAI Responses schema validation failed${
        responseId ? ` [${responseId}]` : ""
      }: ${safeTruncate(validated.error.message, 200)}`,
      { requestId: responseId }
    );
  }

  return { value: validated.data, responseId, responseObjectId };
};
