import type { OpenAiAccessIssue } from "@deliberate/shared";
import type { LogFields } from "../utils/logger";

export type ProviderError = Error & {
  requestId?: string;
  logFields?: LogFields;
  openAiAccessIssue?: OpenAiAccessIssue;
};

export type ProviderConfigErrorCode =
  | "OPENAI_KEY_MISSING"
  | "LOCAL_BASE_URL_MISSING"
  | "LOCAL_UNREACHABLE"
  | "LOCAL_BROWSER_REQUIRED"
  | "OPENAI_KEY_SECRET_MISSING";

export class ProviderConfigError extends Error {
  code: ProviderConfigErrorCode;
  status: number;

  constructor(code: ProviderConfigErrorCode, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const isProviderConfigError = (
  error: unknown,
): error is ProviderConfigError => error instanceof ProviderConfigError;

export const createProviderError = (
  message: string,
  options?: Pick<
    ProviderError,
    "requestId" | "logFields" | "openAiAccessIssue"
  >,
) => {
  const error = new Error(message) as ProviderError;
  if (options?.requestId) {
    error.requestId = options.requestId;
  }
  if (options?.logFields) {
    error.logFields = options.logFields;
  }
  if (options?.openAiAccessIssue) {
    error.openAiAccessIssue = options.openAiAccessIssue;
  }
  return error;
};

const OPENAI_QUOTA_CODES = new Set([
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
]);

export const getOpenAiAccessIssue = (
  error: unknown,
): OpenAiAccessIssue | undefined => {
  if (isProviderConfigError(error)) {
    return error.code === "OPENAI_KEY_MISSING" ? error.code : undefined;
  }
  if (!error || typeof error !== "object") return undefined;
  const { openAiAccessIssue, status, code } = error as ProviderError & {
    status?: number;
    code?: string;
  };
  if (openAiAccessIssue) return openAiAccessIssue;
  if (status === 401) return "OPENAI_KEY_REJECTED";
  if (status === 403) return "OPENAI_ACCESS_DENIED";
  if (status === 429 && code && OPENAI_QUOTA_CODES.has(code)) {
    return "OPENAI_QUOTA_EXHAUSTED";
  }
  return undefined;
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
