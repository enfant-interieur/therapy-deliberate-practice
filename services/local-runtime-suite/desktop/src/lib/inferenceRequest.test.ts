import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInferenceRequestId,
  fetchInferenceWithTimeout,
  gatewayResponseError
} from "./inferenceRequest";

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: () => "12345678-1234-4abc-8def-1234567890ab"
  });
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("desktop inference request cancellation", () => {
  it("creates a gateway-compatible opaque request identifier", () => {
    expect(createInferenceRequestId()).toBe(
      "lrq_1234567812344abc8def1234567890ab"
    );
  });

  it("sends a separate authenticated cancellation request after timeout", async () => {
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/requests/cancel")) {
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = fetchInferenceWithTimeout(
      "http://127.0.0.1:8484/v1/responses",
      "paired-secret-token",
      { method: "POST" },
      120_000
    );
    const rejection = expect(request).rejects.toThrow(/Cancellation was requested/);
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[1];
    expect(String(cancelUrl)).toBe(
      "http://127.0.0.1:8484/v1/requests/cancel"
    );
    expect(String(cancelUrl)).not.toContain("paired-secret-token");
    expect(new Headers(cancelInit?.headers).get("Authorization")).toBe(
      "Bearer paired-secret-token"
    );
    expect(JSON.parse(String(cancelInit?.body))).toEqual({
      request_id: "lrq_1234567812344abc8def1234567890ab"
    });
  });

  it("distinguishes a caller abort from timeout and signals the gateway", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/requests/cancel")) {
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const request = fetchInferenceWithTimeout(
      "http://127.0.0.1:8484/v1/responses",
      "paired-secret-token",
      { method: "POST", signal: controller.signal }
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "http://127.0.0.1:8484/v1/requests/cancel"
    );
  });

  it("preserves caller cancellation when the timeout expires during cancellation transport", async () => {
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/requests/cancel")) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response(null, { status: 202 })), 1_500);
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const request = fetchInferenceWithTimeout(
      "http://127.0.0.1:8484/v1/responses",
      "paired-secret-token",
      { method: "POST", signal: controller.signal },
      120_000
    );
    const rejection = expect(request).rejects.toMatchObject({ code: "CANCELLED" });

    await vi.advanceTimersByTimeAsync(119_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_500);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps the typed busy response to an actionable message", async () => {
    const error = await gatewayResponseError(
      new Response(
        JSON.stringify({
          error: {
            message:
              "The previous local model request is still finishing. Retry in a moment."
          }
        }),
        { status: 409 }
      )
    );

    expect(error.message).toMatch(/Retry in a moment/);
  });
});
