import { nanoid } from "nanoid";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type LogFn = (level: LogLevel, event: string, fields?: LogFields) => void;

export const makeRequestId = () => nanoid();

export const safeTruncate = (value: string, maxLength: number) => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
};

export const safeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "Error",
    message: typeof error === "string" ? error : JSON.stringify(error)
  };
};

export const log: LogFn = (level, event, fields = {}) => {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      ...fields
    })
  );
};

export const createLogger = (baseFields: LogFields = {}) => {
  const withFields = (fields?: LogFields) => ({ ...baseFields, ...(fields ?? {}) });
  return {
    debug: (event: string, fields?: LogFields) => log("debug", event, withFields(fields)),
    info: (event: string, fields?: LogFields) => log("info", event, withFields(fields)),
    warn: (event: string, fields?: LogFields) => log("warn", event, withFields(fields)),
    error: (event: string, fields?: LogFields) => log("error", event, withFields(fields)),
    child: (fields: LogFields) => createLogger(withFields(fields))
  };
};
