import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  encodeWav,
  mixToMonoBuffer,
  resampleLinear,
  resolveAudioContextCtor,
  TARGET_SAMPLE_RATE,
  WAV_MIME_TYPE
} from "../lib/audioEncoding";

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
  hasAudioContext: boolean;
};

type UseMicRecorderOptions = {
  loggerScope?: string;
};

const MIN_RECORDING_DURATION_MS = 600;
const MIN_AUDIO_BYTES = 2048;

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
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const samplesCollectedRef = useRef(0);
  const sampleRateRef = useRef<number>(TARGET_SAMPLE_RATE);
  const lastBlobRef = useRef<Blob | null>(null);
  const requestStartRef = useRef<number | null>(null);
  const recordingStartRef = useRef<number | null>(null);

  const capabilities = useMemo<MicRecorderCapabilities>(() => {
    const hasGetUserMedia = Boolean(navigator?.mediaDevices?.getUserMedia);
    const hasAudioContext = Boolean(resolveAudioContextCtor());
    return { hasGetUserMedia, hasAudioContext };
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

  const cleanupAudioGraph = useCallback(async () => {
    processorRef.current?.disconnect();
    gainNodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    processorRef.current = null;
    gainNodeRef.current = null;
    sourceRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      try {
        await context.close();
      } catch {
        // ignored
      }
    }
  }, []);

  const release = useCallback(() => {
    stopTracks();
    void cleanupAudioGraph();
    pcmChunksRef.current = [];
    samplesCollectedRef.current = 0;
    setState("idle");
    setError(null);
  }, [cleanupAudioGraph, stopTracks]);

  useEffect(
    () => () => {
      release();
    },
    [release]
  );

  const ensureSupport = useCallback((): MicRecorderError | null => {
    if (!capabilities.hasGetUserMedia || !capabilities.hasAudioContext) {
      const unsupportedError: MicRecorderError = {
        kind: "unsupported",
        rawName: "NotSupportedError",
        rawMessage: "Microphone capture APIs are unavailable.",
        recommendedAction: "Try a different browser or device.",
        isRetryable: false
      };
      setError(unsupportedError);
      setState("error");
      return unsupportedError;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      const insecureError = buildInsecureContextError();
      setError(insecureError);
      setState("error");
      return insecureError;
    }
    return null;
  }, [capabilities.hasAudioContext, capabilities.hasGetUserMedia]);

  const preflight = useCallback(() => {
    const supportError = ensureSupport();
    if (supportError) {
      return Promise.reject(supportError);
    }
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    setState("requesting_permission");
    setError(null);
    requestStartRef.current = Date.now();
    return gumPromise
      .then((stream) => {
        stream.getTracks().forEach((track) => track.stop());
        setState("ready");
        logEvent("mic_preflight_ok", {
          elapsedMs: requestStartRef.current ? Date.now() - requestStartRef.current : undefined
        });
      })
      .catch((err) => {
        const classified = classifyMicError(err);
        setError(classified);
        setState("error");
        logEvent("mic_preflight_error", { classified });
        throw err;
      });
  }, [ensureSupport, logEvent]);

  const startFromUserGesture = useCallback(() => {
    const supportError = ensureSupport();
    if (supportError) {
      return Promise.reject(supportError);
    }
    if (state === "recording" || state === "requesting_permission") {
      return Promise.resolve();
    }
    const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true });
    setState("requesting_permission");
    setError(null);
    requestStartRef.current = Date.now();
    logEvent("mic_request_start", { userAgent: navigator.userAgent });
    return gumPromise
      .then(async (stream) => {
        streamRef.current = stream;
        const AudioContextCtor = resolveAudioContextCtor();
        if (!AudioContextCtor) {
          throw new Error("Audio capture is unavailable.");
        }
        const audioContext = new AudioContextCtor();
        audioContextRef.current = audioContext;
        sampleRateRef.current = audioContext.sampleRate || TARGET_SAMPLE_RATE;
        if (audioContext.state === "suspended") {
          await audioContext.resume().catch(() => undefined);
        }
        const source = audioContext.createMediaStreamSource(stream);
        sourceRef.current = source;
        const processor = audioContext.createScriptProcessor(4096, source.channelCount || 1, 1);
        processorRef.current = processor;
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        gainNodeRef.current = gain;
        processor.connect(gain);
        gain.connect(audioContext.destination);
        source.connect(processor);
        pcmChunksRef.current = [];
        samplesCollectedRef.current = 0;
        processor.onaudioprocess = (event) => {
          const mono = mixToMonoBuffer(event.inputBuffer);
          if (!mono.length) return;
          pcmChunksRef.current.push(mono.slice());
          samplesCollectedRef.current += mono.length;
        };
        recordingStartRef.current = Date.now();
        setState("recording");
        logEvent("mic_recording_started", {
          elapsedMs: requestStartRef.current ? Date.now() - requestStartRef.current : undefined,
          sampleRate: sampleRateRef.current
        });
      })
      .catch((err) => {
        const classified = classifyMicError(err);
        setError(classified);
        setState("error");
        stopTracks();
        void cleanupAudioGraph();
        logEvent("mic_request_error", { classified });
        throw err;
      });
  }, [cleanupAudioGraph, ensureSupport, logEvent, state, stopTracks]);

  const stop = useCallback(async () => {
    if (state !== "recording") {
      return null;
    }
    setState("processing");
    const startedAt = recordingStartRef.current;
    recordingStartRef.current = null;
    stopTracks();
    await cleanupAudioGraph();
    const totalSamples = samplesCollectedRef.current;
    samplesCollectedRef.current = 0;
    if (!totalSamples) {
      pcmChunksRef.current = [];
      setState("idle");
      const emptyError = new Error("No audio was captured. Please record again.");
      logEvent("mic_recording_empty", {});
      throw emptyError;
    }
    const durationMs = startedAt ? Date.now() - startedAt : null;
    if (durationMs !== null && durationMs < MIN_RECORDING_DURATION_MS) {
      pcmChunksRef.current = [];
      setState("idle");
      const shortError = new Error("Recording was too short. Please speak for at least one second.");
      logEvent("mic_recording_too_short", { durationMs });
      throw shortError;
    }
    const merged = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of pcmChunksRef.current) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    pcmChunksRef.current = [];
    const sampleRate = sampleRateRef.current || TARGET_SAMPLE_RATE;
    const resampled =
      sampleRate === TARGET_SAMPLE_RATE ? merged : resampleLinear(merged, sampleRate, TARGET_SAMPLE_RATE);
    const wavBuffer = encodeWav(resampled, TARGET_SAMPLE_RATE);
    const blob = new Blob([wavBuffer], { type: WAV_MIME_TYPE });
    lastBlobRef.current = blob;
    if (blob.size < MIN_AUDIO_BYTES) {
      setState("idle");
      const minSizeError = new Error("Recording was too short. Please speak for at least one second.");
      logEvent("mic_recording_small_blob", { size: blob.size });
      throw minSizeError;
    }
    const base64 = await blobToBase64(blob);
    setState("idle");
    logEvent("mic_recording_stopped", { mimeType: blob.type, size: blob.size });
    return { base64, mimeType: blob.type, blob };
  }, [cleanupAudioGraph, logEvent, state, stopTracks]);

  const cancel = useCallback(() => {
    recordingStartRef.current = null;
    stopTracks();
    void cleanupAudioGraph();
    pcmChunksRef.current = [];
    samplesCollectedRef.current = 0;
    setState("idle");
    setError(null);
  }, [cleanupAudioGraph, stopTracks]);

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
