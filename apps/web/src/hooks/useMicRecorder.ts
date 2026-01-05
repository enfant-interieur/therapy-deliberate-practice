import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type MicRecorderState =
  | "idle"
  | "requesting_permission"
  | "ready"
  | "recording"
  | "stopping"
  | "processing"
  | "error";

export type MicRecorderErrorKind =
  | "permission_denied"
  | "no_device"
  | "busy"
  | "insecure_context"
  | "unsupported"
  | "unknown";

export type MicRecorderError = {
  kind: MicRecorderErrorKind;
  rawName?: string;
  rawMessage?: string;
  recommendedAction?: string;
  isRetryable: boolean;
};

export type MicRecorderResult = {
  base64: string;
  mimeType: string;
  blob: Blob;
};

export type MicRecorderCapabilities = {
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
  supportedMimeTypes: string[];
  bestMimeType: string | null;
};

type UseMicRecorderOptions = {
  loggerScope?: string;
};

const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/mpeg"
];

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        const [, base64] = reader.result.split(",");
        resolve(base64 ?? "");
      } else {
        reject(new Error("Invalid reader result"));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export const listSupportedAudioMimeTypes = () => {
  if (typeof MediaRecorder === "undefined") {
    return [];
  }
  return MIME_TYPE_CANDIDATES.filter((candidate) => MediaRecorder.isTypeSupported(candidate));
};

export const pickSupportedAudioMimeType = () => listSupportedAudioMimeTypes()[0] ?? null;

export const classifyMicError = (error: unknown): MicRecorderError => {
  const rawName =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: string }).name)
      : undefined;
  const rawMessage =
    typeof error === "object" && error && "message" in error
      ? String((error as { message?: string }).message)
      : undefined;

  switch (rawName) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "permission_denied",
        rawName,
        rawMessage,
        recommendedAction: "Allow microphone access in your browser or device settings.",
        isRetryable: true
      };
    case "NotFoundError":
      return {
        kind: "no_device",
        rawName,
        rawMessage,
        recommendedAction: "Connect a microphone and try again.",
        isRetryable: false
      };
    case "NotReadableError":
      return {
        kind: "busy",
        rawName,
        rawMessage,
        recommendedAction: "Close other apps using the microphone and try again.",
        isRetryable: true
      };
    case "AbortError":
      return {
        kind: "busy",
        rawName,
        rawMessage,
        recommendedAction: "Try again once the microphone is available.",
        isRetryable: true
      };
    case "OverconstrainedError":
      return {
        kind: "unsupported",
        rawName,
        rawMessage,
        recommendedAction: "Try a different browser or device.",
        isRetryable: false
      };
    default:
      return {
        kind: "unknown",
        rawName,
        rawMessage,
        recommendedAction: "Try again or check browser settings.",
        isRetryable: true
      };
  }
};

const buildInsecureContextError = (): MicRecorderError => ({
  kind: "insecure_context",
  rawName: "SecurityError",
  rawMessage: "Microphone access requires HTTPS or localhost.",
  recommendedAction: "Open the site over HTTPS or localhost.",
  isRetryable: false
});

export const useMicRecorder = ({ loggerScope }: UseMicRecorderOptions = {}) => {
  const [state, setState] = useState<MicRecorderState>("idle");
  const [error, setError] = useState<MicRecorderError | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastMimeTypeRef = useRef<string | null>(null);
  const lastBlobRef = useRef<Blob | null>(null);
  const requestStartRef = useRef<number | null>(null);

  const capabilities = useMemo<MicRecorderCapabilities>(() => {
    const hasGetUserMedia = Boolean(navigator?.mediaDevices?.getUserMedia);
    const hasMediaRecorder = typeof MediaRecorder !== "undefined";
    const supportedMimeTypes = listSupportedAudioMimeTypes();
    return {
      hasGetUserMedia,
      hasMediaRecorder,
      supportedMimeTypes,
      bestMimeType: supportedMimeTypes[0] ?? null
    };
  }, []);

  const logEvent = useCallback(
    (event: string, detail?: Record<string, unknown>) => {
      if (!loggerScope) return;
      console.info(`[${loggerScope}] ${event}`, detail ?? {});
    },
    [loggerScope]
  );

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const release = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (err) {
        logEvent("mic_stop_error", { err });
      }
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    stopTracks();
    setState("idle");
    setError(null);
  }, [logEvent, stopTracks]);

  useEffect(() => () => stopTracks(), [stopTracks]);

  const preflight = useCallback(() => {
    if (!capabilities.hasGetUserMedia || !capabilities.hasMediaRecorder) {
      const unsupportedError: MicRecorderError = {
        kind: "unsupported",
        rawName: "NotSupportedError",
        rawMessage: "Microphone APIs are unavailable.",
        recommendedAction: "Try a different browser or device.",
        isRetryable: false
      };
      setError(unsupportedError);
      setState("error");
      return Promise.reject(unsupportedError);
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      const insecureError = buildInsecureContextError();
      setError(insecureError);
      setState("error");
      return Promise.reject(insecureError);
    }
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    setState("requesting_permission");
    setError(null);
    requestStartRef.current = Date.now();
    return gumPromise
      .then((stream) => {
        stopTracks();
        stream.getTracks().forEach((track) => track.stop());
        setState("ready");
        logEvent("mic_preflight_ok", {
          elapsedMs: requestStartRef.current
            ? Date.now() - requestStartRef.current
            : undefined
        });
      })
      .catch((err) => {
        const classified = classifyMicError(err);
        setError(classified);
        setState("error");
        logEvent("mic_preflight_error", { classified });
        throw err;
      });
  }, [capabilities.hasGetUserMedia, capabilities.hasMediaRecorder, logEvent, stopTracks]);

  const startFromUserGesture = useCallback(() => {
    if (!capabilities.hasGetUserMedia || !capabilities.hasMediaRecorder) {
      const unsupportedError: MicRecorderError = {
        kind: "unsupported",
        rawName: "NotSupportedError",
        rawMessage: "Microphone APIs are unavailable.",
        recommendedAction: "Try a different browser or device.",
        isRetryable: false
      };
      setError(unsupportedError);
      setState("error");
      return Promise.reject(unsupportedError);
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      const insecureError = buildInsecureContextError();
      setError(insecureError);
      setState("error");
      return Promise.reject(insecureError);
    }
    if (state === "recording" || state === "requesting_permission") {
      return Promise.resolve();
    }
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    setState("requesting_permission");
    setError(null);
    requestStartRef.current = Date.now();
    logEvent("mic_request_start", {
      userAgent: navigator.userAgent
    });
    return gumPromise
      .then((stream) => {
        streamRef.current = stream;
        const mimeType = pickSupportedAudioMimeType();
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined
        );
        lastMimeTypeRef.current = mimeType ?? recorder.mimeType ?? null;
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data);
          }
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setState("recording");
        logEvent("mic_recording_started", {
          elapsedMs: requestStartRef.current
            ? Date.now() - requestStartRef.current
            : undefined,
          mimeType: lastMimeTypeRef.current
        });
      })
      .catch((err) => {
        const classified = classifyMicError(err);
        setError(classified);
        setState("error");
        stopTracks();
        logEvent("mic_request_error", { classified });
        throw err;
      });
  }, [
    capabilities.hasGetUserMedia,
    capabilities.hasMediaRecorder,
    logEvent,
    state,
    stopTracks
  ]);

  const stop = useCallback(async () => {
    if (!mediaRecorderRef.current || state !== "recording") {
      return null;
    }
    setState("processing");
    const recorder = mediaRecorderRef.current;
    return new Promise<MicRecorderResult>((resolve, reject) => {
      recorder.onstop = async () => {
        stopTracks();
        const mimeType = lastMimeTypeRef.current ?? recorder.mimeType ?? "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        lastBlobRef.current = blob;
        try {
          const base64 = await blobToBase64(blob);
          setState("idle");
          resolve({ base64, mimeType: blob.type, blob });
          logEvent("mic_recording_stopped", { mimeType: blob.type });
        } catch (err) {
          setState("idle");
          reject(err);
        }
      };
      recorder.stop();
    });
  }, [logEvent, state, stopTracks]);

  const cancel = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = () => stopTracks();
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setState("idle");
    setError(null);
  }, [stopTracks]);

  return {
    state,
    recordingState: state,
    error,
    capabilities,
    lastBlob: lastBlobRef.current,
    preflight,
    startFromUserGesture,
    stop,
    cancel,
    release
  };
};
