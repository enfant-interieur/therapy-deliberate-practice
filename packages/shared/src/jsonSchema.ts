import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const isNullSchema = (value: unknown): boolean =>
  isRecord(value) &&
  (value.type === "null" ||
    (Array.isArray(value.type) && value.type.includes("null")) ||
    (Array.isArray(value.anyOf) && value.anyOf.some((item) => isNullSchema(item))) ||
    (Array.isArray(value.oneOf) && value.oneOf.some((item) => isNullSchema(item))));

const withNullAllowed = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return { anyOf: [value ?? {}, { type: "null" }] };
  }
  if (isNullSchema(value)) {
    return value;
  }
  if (typeof value.type === "string") {
    if (value.type === "null") return value;
    value.type = [value.type, "null"];
    return value;
  }
  if (Array.isArray(value.type)) {
    if (!value.type.includes("null")) {
      value.type = [...value.type, "null"];
    }
    return value;
  }
  if (Array.isArray(value.anyOf)) {
    if (!value.anyOf.some(isNullSchema)) {
      value.anyOf = [...value.anyOf, { type: "null" }];
    }
    return value;
  }
  if (Array.isArray(value.oneOf)) {
    if (!value.oneOf.some(isNullSchema)) {
      value.oneOf = [...value.oneOf, { type: "null" }];
    }
    return value;
  }
  return {
    anyOf: [value, { type: "null" }]
  };
};

const enforceStrict = (node: unknown): void => {
  if (!isRecord(node)) return;
  const record = node as Record<string, unknown>;
  const type = record.type;
  if (type === "object" && record.properties) {
    const properties = record.properties as Record<string, unknown>;
    const propertyKeys = Object.keys(properties);
    const existingRequired = Array.isArray(record.required)
      ? new Set(record.required as Array<string>)
      : undefined;
    for (const value of Object.values(properties)) {
      enforceStrict(value);
    }
    const optionalKeys = propertyKeys.filter((key) => !existingRequired?.has(key));
    record.required = propertyKeys;
    for (const key of optionalKeys) {
      properties[key] = withNullAllowed(properties[key]);
    }
    if (!("additionalProperties" in record)) {
      record.additionalProperties = false;
    }
  }
  if (type === "array" && record.items) {
    if (Array.isArray(record.items)) {
      for (const item of record.items) {
        enforceStrict(item);
      }
    } else {
      enforceStrict(record.items);
    }
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
