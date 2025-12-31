export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
  child: (fields: LogFields) => Logger;
};

export const serializeError = (error: unknown) => {
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

const emitLog = (payload: LogFields) => {
  console.log(JSON.stringify(payload));
};

export const createLogger = (baseFields: LogFields = {}): Logger => {
  const log = (level: LogLevel, message: string, fields: LogFields = {}) => {
    emitLog({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...baseFields,
      ...fields
    });
  };

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    child: (fields) => createLogger({ ...baseFields, ...fields })
  };
};
