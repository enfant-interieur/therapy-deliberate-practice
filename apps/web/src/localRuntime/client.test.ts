import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkLocalRuntimeHealth,
  createLocalRuntimeRequestId,
  getLocalRuntimeDetails,
  isLocalRuntimePairingError,
  loadLocalRuntimePairingKey,
  normalizeLocalRuntimeBaseUrl,
  removeLocalRuntimePairingKey,
  requireLocalRuntimePairingKey,
  resolveLocalRuntimeGatewayOrigin,
  saveLocalRuntimePairingKey,
  transcribeWithLocalRuntime,
} from "./client";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("crypto", {
    randomUUID: () => "12345678-1234-4abc-8def-1234567890ab",
  });
});

describe("local runtime connection boundary", () => {
  it("accepts only loopback HTTP origins", () => {
    expect(normalizeLocalRuntimeBaseUrl("http://127.0.0.1:8484/")).toBe(
      "http://127.0.0.1:8484",
    );
    expect(normalizeLocalRuntimeBaseUrl("http://localhost:8484")).toBe(
      "http://localhost:8484",
    );
    expect(() =>
      normalizeLocalRuntimeBaseUrl("https://attacker.example"),
    ).toThrow(/localhost/);
    expect(() =>
      normalizeLocalRuntimeBaseUrl("http://127.0.0.1:8484/v1/responses"),
    ).toThrow(/path/);
    expect(() => normalizeLocalRuntimeBaseUrl("http://[::1]:8484")).toThrow(
      /localhost/,
    );
  });

  it("requires speech and evaluation to share one paired gateway origin", () => {
    expect(
      resolveLocalRuntimeGatewayOrigin({
        baseUrl: "http://127.0.0.1:8484",
        sttUrl: "http://127.0.0.1:8484/",
        llmUrl: null,
      }),
    ).toBe("http://127.0.0.1:8484");
    expect(() =>
      resolveLocalRuntimeGatewayOrigin({
        sttUrl: "http://127.0.0.1:8484",
        llmUrl: "http://127.0.0.1:8585",
      }),
    ).toThrow(/same local gateway/);
  });

  it("stores pairing keys per loopback origin", () => {
    const token = "a".repeat(64);
    saveLocalRuntimePairingKey("http://127.0.0.1:8484", token);

    expect(loadLocalRuntimePairingKey("http://127.0.0.1:8484/")).toBe(token);
    expect(loadLocalRuntimePairingKey("http://127.0.0.1:8585")).toBe("");
    expect(requireLocalRuntimePairingKey("http://127.0.0.1:8484")).toBe(token);
    removeLocalRuntimePairingKey("http://127.0.0.1:8484");
    expect(() =>
      requireLocalRuntimePairingKey("http://127.0.0.1:8484"),
    ).toThrow(/Pair this browser/);
  });

  it("rejects an unrelated service on the configured port", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ service: "other", status: "ready" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      checkLocalRuntimeHealth("http://127.0.0.1:8484"),
    ).rejects.toThrow(/different service/);
  });

  it("rejects an incompatible gateway protocol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              service: "therapy-local-runtime",
              protocol_version: "0",
              status: "ready",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
      ),
    );

    await expect(
      checkLocalRuntimeHealth("http://127.0.0.1:8484"),
    ).rejects.toThrow(/not compatible/);
  });

  it("preserves a 401 as a pairing recovery error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "Invalid pairing key." }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const request = getLocalRuntimeDetails(
      "http://127.0.0.1:8484",
      "expired-pairing-key",
    );
    await expect(request).rejects.toSatisfy(isLocalRuntimePairingError);
  });

  it("creates an opaque gateway-compatible request identifier", () => {
    expect(createLocalRuntimeRequestId()).toBe(
      "lrq_1234567812344abc8def1234567890ab",
    );
  });

  it("requests authenticated cancellation after a local inference timeout", async () => {
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/requests/cancel")) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "cancellation_requested" }), {
            status: 202,
          }),
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = transcribeWithLocalRuntime({
      baseUrl: "http://127.0.0.1:8484",
      token: "paired-secret-token",
      audio: new Blob(["audio"], { type: "audio/wav" }),
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(120_000);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [cancelUrl, cancelInit] = fetchMock.mock.calls[1];
    expect(String(cancelUrl)).toBe("http://127.0.0.1:8484/v1/requests/cancel");
    expect(String(cancelUrl)).not.toContain("paired-secret-token");
    expect(new Headers(cancelInit?.headers).get("Authorization")).toBe(
      "Bearer paired-secret-token",
    );
    expect(JSON.parse(String(cancelInit?.body))).toEqual({
      request_id: "lrq_1234567812344abc8def1234567890ab",
    });
    vi.useRealTimers();
  });

  it("distinguishes caller cancellation from timeout and signals the gateway", async () => {
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

    const request = transcribeWithLocalRuntime({
      baseUrl: "http://127.0.0.1:8484",
      token: "paired-secret-token",
      audio: new Blob(["audio"], { type: "audio/wav" }),
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      "http://127.0.0.1:8484/v1/requests/cancel",
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
    const request = transcribeWithLocalRuntime({
      baseUrl: "http://127.0.0.1:8484",
      token: "paired-secret-token",
      audio: new Blob(["audio"], { type: "audio/wav" }),
      signal: controller.signal,
    });
    const rejection = expect(request).rejects.toMatchObject({
      code: "CANCELLED",
    });

    await vi.advanceTimersByTimeAsync(119_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1_500);

    await rejection;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("maps a busy model to an actionable non-queuing error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                message:
                  "The previous local model request is still finishing. Retry in a moment.",
              },
            }),
            { status: 409 },
          ),
      ),
    );

    await expect(
      transcribeWithLocalRuntime({
        baseUrl: "http://127.0.0.1:8484",
        token: "paired-secret-token",
        audio: new Blob(["audio"], { type: "audio/wav" }),
      }),
    ).rejects.toMatchObject({
      code: "BUSY",
      status: 409,
    });
  });
});
