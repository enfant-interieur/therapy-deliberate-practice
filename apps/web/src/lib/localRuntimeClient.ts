import type { EvaluationInput, EvaluationResult } from "@deliberate/shared";
import {
  buildStrictJsonSchema,
  deliberatePracticeEvaluationPromptLocal,
  evaluationResultSchema
} from "@deliberate/shared";
import { normalizeUploadBlob } from "./audioEncoding";

type ProviderDescriptor = { kind: "local" | "openai"; model: string };

type LocalRuntimeMetadata = {
  defaults?: Record<string, string>;
  build?: { version?: string };
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8484";

const normalizeBase = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const mimeTypeToFilename = (mimeType?: string | null) => {
  if (!mimeType) return "audio.webm";
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("audio/mp4") || normalized.includes("audio/aac")) return "audio.m4a";
  if (normalized.includes("audio/mpeg")) return "audio.mp3";
  if (normalized.includes("audio/wav")) return "audio.wav";
  if (normalized.includes("audio/webm")) return "audio.webm";
  return "audio.webm";
};


const extractOutputText = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }
  for (const choice of record.output ?? []) {
    for (const content of choice.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
};

const attemptJsonRepair = (raw: string): string | null => {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return raw.slice(firstBrace, lastBrace + 1);
};

export type LocalTranscriptionResult = {
  text: string;
  provider: ProviderDescriptor;
  durationMs: number;
};

export type LocalEvaluationResult = {
  evaluation: EvaluationResult;
  provider: ProviderDescriptor;
  durationMs: number;
  requestId?: string;
};

const LOCAL_STRUCTURED_SCHEMA_NAME = "StructuredOutput";
const evaluationResultStructuredSchema = buildStrictJsonSchema(
  evaluationResultSchema,
  LOCAL_STRUCTURED_SCHEMA_NAME
);

export type LocalRuntimeClientOptions = {
  baseUrl?: string | null;
  sttUrl?: string | null;
  llmUrl?: string | null;
  fetchTimeoutMs?: number;
};

export class LocalRuntimeClient {
  private metadata: LocalRuntimeMetadata | null = null;
  private metadataPromise: Promise<void> | null = null;
  private readonly fetchTimeoutMs: number;

  constructor(private readonly options: LocalRuntimeClientOptions = {}) {
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 60000;
  }

  private resolveBase(kind: "stt" | "llm"): string {
    const normalizedBase = normalizeBase(this.options.baseUrl);
    const normalizedStt = normalizeBase(this.options.sttUrl);
    const normalizedLlm = normalizeBase(this.options.llmUrl);
    if (kind === "stt") {
      return normalizedStt ?? normalizedBase ?? normalizedLlm ?? DEFAULT_BASE_URL;
    }
    return normalizedLlm ?? normalizedBase ?? normalizedStt ?? DEFAULT_BASE_URL;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort(new DOMException("Local runtime request timed out.", "TimeoutError"));
    }, this.fetchTimeoutMs);
    const cleanup = () => window.clearTimeout(timeout);

    if (signal) {
      if (signal.aborted) {
        controller.abort(
          signal.reason ??
            new DOMException("Request aborted by caller.", "AbortError")
        );
      } else {
        const onAbort = () =>
          controller.abort(
            signal.reason ??
              new DOMException("Request aborted by caller.", "AbortError")
          );
        signal.addEventListener("abort", onAbort, { once: true });
        controller.signal.addEventListener(
          "abort",
          () => signal.removeEventListener("abort", onAbort),
          { once: true }
        );
      }
    }

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      cleanup();
    }
  }

  private async ensureMetadata(kind: "stt" | "llm"): Promise<void> {
    if (this.metadata || this.metadataPromise) {
      await this.metadataPromise;
      return;
    }
    const base = this.resolveBase(kind);
    this.metadataPromise = (async () => {
      try {
        const response = await this.fetchWithTimeout(`${base}/health`, { method: "GET" });
        if (!response.ok) return;
        const payload = (await response.json()) as LocalRuntimeMetadata;
        this.metadata = payload;
      } catch {
        // Ignore health fetch issues; we'll fall back to defaults.
      } finally {
        this.metadataPromise = null;
      }
    })();
    await this.metadataPromise;
  }

  private providerFor(kind: "stt" | "llm"): ProviderDescriptor {
    const defaultsKey = kind === "stt" ? "audio.transcriptions" : "responses";
    const model =
      this.metadata?.defaults?.[defaultsKey] ??
      (kind === "stt" ? "local//stt" : "local//llm");
    return { kind: "local", model };
  }

  async transcribeAudio(
    blob: Blob,
    options?: { mimeType?: string | null; signal?: AbortSignal }
  ): Promise<LocalTranscriptionResult> {
    const base = this.resolveBase("stt");
    await this.ensureMetadata("stt");
    let upload = { blob, mimeType: options?.mimeType ?? blob.type ?? "audio/webm" };
    if (typeof window !== "undefined") {
      upload = await normalizeUploadBlob(blob, options?.mimeType ?? blob.type);
    }
    const file = new File([upload.blob], mimeTypeToFilename(upload.mimeType), {
      type: upload.mimeType
    });
    const formData = new FormData();
    formData.append("file", file);
    const start = performance.now();
    const response = await this.fetchWithTimeout(
      `${base}/v1/audio/transcriptions`,
      { method: "POST", body: formData },
      options?.signal
    );
    if (!response.ok) {
      const message = await response.text().catch(() => "Unknown error");
      throw new Error(`Local transcription failed (${response.status}): ${message}`);
    }
    const durationMs = Math.round(performance.now() - start);
    let transcriptText = "";
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as {
        text?: string;
        segments?: Array<{ text?: string }>;
      };
      transcriptText =
        payload.text ??
        payload.segments
          ?.map((segment) => segment.text ?? "")
          .filter((value) => value.length > 0)
          .join("\n") ??
        "";
    } else {
      transcriptText = await response.text();
    }
    if (!transcriptText) {
      throw new Error("Local transcription returned empty output.");
    }
    return {
      text: transcriptText,
      provider: this.providerFor("stt"),
      durationMs
    };
  }

  async evaluateDeliberatePractice(
    input: EvaluationInput,
    options?: { signal?: AbortSignal }
  ): Promise<LocalEvaluationResult> {
    const base = this.resolveBase("llm");
    await this.ensureMetadata("llm");
    const start = performance.now();
    const response = await this.fetchWithTimeout(
      `${base}/v1/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: JSON.stringify(input),
          instructions: deliberatePracticeEvaluationPromptLocal,
          temperature: 0.2,
          text: {
            format: {
              type: "json_schema",
              name: LOCAL_STRUCTURED_SCHEMA_NAME,
              schema: evaluationResultStructuredSchema,
              strict: true
            }
          }
        })
      },
      options?.signal
    );
    if (!response.ok) {
      const message = await response.text().catch(() => "Unknown error");
      throw new Error(`Local evaluation failed (${response.status}): ${message}`);
    }
    const payload = (await response.json()) as {
      id?: string;
      request_id?: string;
      _request_id?: string;
    };
    const rawText = extractOutputText(payload);
    if (!rawText) {
      throw new Error("Local evaluation returned no output.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      const repaired = attemptJsonRepair(rawText);
      if (!repaired) {
        throw new Error(`Local evaluation returned invalid JSON: ${String(error)}`);
      }
      parsed = JSON.parse(repaired);
    }
    const validated = evaluationResultSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(
        `Local evaluation output failed validation: ${validated.error.errors
          .map((issue) => issue.message)
          .join(", ")}`
      );
    }
    return {
      evaluation: validated.data,
      provider: this.providerFor("llm"),
      durationMs: Math.round(performance.now() - start),
      requestId: payload._request_id ?? payload.request_id ?? payload.id
    };
  }
}
