// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { classifyMicError, pickSupportedAudioMimeType } from "./useMicRecorder";

describe("pickSupportedAudioMimeType", () => {
  it("returns the first supported mime type", () => {
    const isTypeSupported = vi.fn((type: string) => type === "audio/mp4");
    vi.stubGlobal("MediaRecorder", { isTypeSupported });

    expect(pickSupportedAudioMimeType()).toBe("audio/mp4");

    vi.unstubAllGlobals();
  });

  it("returns null when MediaRecorder is unavailable", () => {
    vi.stubGlobal("MediaRecorder", undefined);

    expect(pickSupportedAudioMimeType()).toBeNull();

    vi.unstubAllGlobals();
  });
});

describe("classifyMicError", () => {
  it("maps NotAllowedError to permission_denied", () => {
    const error = { name: "NotAllowedError", message: "Denied" };
    expect(classifyMicError(error).kind).toBe("permission_denied");
  });

  it("maps NotFoundError to no_device", () => {
    const error = { name: "NotFoundError", message: "No mic" };
    expect(classifyMicError(error).kind).toBe("no_device");
  });

  it("maps NotReadableError to busy", () => {
    const error = { name: "NotReadableError", message: "Busy" };
    expect(classifyMicError(error).kind).toBe("busy");
  });

  it("maps OverconstrainedError to unsupported", () => {
    const error = { name: "OverconstrainedError", message: "Constraints" };
    expect(classifyMicError(error).kind).toBe("unsupported");
  });
});
