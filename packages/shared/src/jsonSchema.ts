import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const enforceStrict = (node: unknown): void => {
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

export const buildStrictJsonSchema = <T>(
  schema: z.ZodSchema<T>,
  schemaName: string
): Record<string, unknown> => {
  const full = zodToJsonSchema(schema, {
    name: schemaName,
    $refStrategy: "none",
    target: "jsonSchema7"
  }) as Record<string, unknown>;
  const defs =
    (full.definitions ?? full.$defs ?? {}) as Record<string, Record<string, unknown>>;
  let root: Record<string, unknown> = full;

  if (defs?.[schemaName]) {
    root = defs[schemaName];
  } else if (typeof full.$ref === "string") {
    const match = full.$ref.match(/^#\/(definitions|\$defs)\/(.+)$/);
    if (match && defs?.[match[2]]) {
      root = defs[match[2]];
    }
  }

  if (root && typeof root === "object" && root.type == null && root.properties) {
    root.type = "object";
  }

  enforceStrict(root);
  return root;
};
