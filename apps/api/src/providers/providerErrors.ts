import type { LogFields } from "../utils/logger";

export type ProviderError = Error & {
  requestId?: string;
  logFields?: LogFields;
};

export const createProviderError = (
  message: string,
  options?: { requestId?: string; logFields?: LogFields }
) => {
  const error = new Error(message) as ProviderError;
  if (options?.requestId) {
    error.requestId = options.requestId;
  }
  if (options?.logFields) {
    error.logFields = options.logFields;
  }
  return error;
};

export const getErrorRequestId = (error: unknown) => {
  if (!error || typeof error !== "object") return undefined;
  const record = error as {
    requestId?: string;
    request_id?: string;
    responseId?: string;
    response?: { headers?: { get?: (key: string) => string | null } };
  };
  return (
    record.requestId ??
    record.request_id ??
    record.responseId ??
    record.response?.headers?.get?.("x-request-id") ??
    record.response?.headers?.get?.("openai-request-id") ??
    record.response?.headers?.get?.("request-id") ??
    undefined
  );
};

export const getErrorLogFields = (error: unknown): LogFields | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const record = error as ProviderError;
  return record.logFields;
};
