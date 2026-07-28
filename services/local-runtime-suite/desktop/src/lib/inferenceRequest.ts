const CANCELLATION_TIMEOUT_MS = 2_000;
const INFERENCE_TIMEOUT_MS = 120_000;

export class InferenceRequestError extends Error {
  readonly code: "CANCELLED" | "TIMEOUT";

  constructor(message: string, code: "CANCELLED" | "TIMEOUT", cause?: unknown) {
    super(message, { cause });
    this.name = "InferenceRequestError";
    this.code = code;
  }
}

export const createInferenceRequestId = () =>
  `lrq_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;

export const gatewayResponseError = async (response: Response) => {
  try {
    const payload = await response.json();
    const message = payload?.error?.message ?? payload?.detail ?? payload?.message;
    if (typeof message === "string" && message.trim()) {
      return new Error(message);
    }
  } catch {
    // Fall through to the typed status messages below.
  }
  if (response.status === 409) {
    return new Error("The previous local model request is still finishing. Retry in a moment.");
  }
  if (response.status === 499) {
    return new Error("The local model request was cancelled.");
  }
  if (response.status === 504) {
    return new Error("The local model request exceeded its time limit.");
  }
  return new Error(`HTTP ${response.status}`);
};

export const fetchInferenceWithTimeout = async (
  url: string,
  accessToken: string,
  init: RequestInit,
  timeoutMs = INFERENCE_TIMEOUT_MS
) => {
  const controller = new AbortController();
  let abortCause: "caller" | "timeout" | null = null;
  const timeoutId = window.setTimeout(() => {
    if (abortCause === null) {
      abortCause = "timeout";
      controller.abort();
    }
  }, timeoutMs);
  const callerSignal = init.signal;
  const forwardCallerAbort = () => {
    if (abortCause === null) {
      abortCause = "caller";
      controller.abort(callerSignal?.reason);
    }
  };
  if (callerSignal?.aborted) {
    forwardCallerAbort();
  } else {
    callerSignal?.addEventListener("abort", forwardCallerAbort, { once: true });
  }
  const requestId = createInferenceRequestId();
  const headers = new Headers(init.headers);
  headers.set("X-Request-ID", requestId);
  const requestInit = { ...init };
  delete requestInit.signal;
  try {
    return await fetch(url, { ...requestInit, headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const cancelController = new AbortController();
      const cancelTimeout = window.setTimeout(
        () => cancelController.abort(),
        CANCELLATION_TIMEOUT_MS
      );
      try {
        await fetch(`${new URL(url).origin}/v1/requests/cancel`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ request_id: requestId }),
          signal: cancelController.signal
        });
      } catch {
        // Keep the original timeout as the user-facing failure.
      } finally {
        clearTimeout(cancelTimeout);
      }
      if (abortCause === "caller") {
        throw new InferenceRequestError(
          "The local model request was cancelled. Completed earlier work was preserved.",
          "CANCELLED",
          error
        );
      }
      throw new InferenceRequestError(
        "The local model timed out. Cancellation was requested; retry when the model is ready.",
        "TIMEOUT",
        error
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", forwardCallerAbort);
  }
};
