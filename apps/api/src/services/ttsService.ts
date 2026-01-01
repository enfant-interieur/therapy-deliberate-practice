import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { RuntimeEnv } from "../env";
import type { ApiDatabase } from "../db/types";
import { ttsAssets } from "../db/schema";
import type { TtsProvider } from "../providers/tts";
import { safeTruncate } from "../utils/logger";
import { buildTtsCacheKey, buildTtsR2Key } from "../utils/ttsCache";

export type TtsAssetStatus = "ready" | "generating" | "failed";

export type TtsStorage = {
  headObject: (bucket: string, key: string) => Promise<{ exists: boolean; etag?: string; size?: number }>;
  putObject: (
    bucket: string,
    key: string,
    bytes: Uint8Array,
    contentType: string
  ) => Promise<{ etag?: string }>;
  getObject: (
    bucket: string,
    key: string
  ) => Promise<{ body: Uint8Array; contentType: string; etag?: string; contentLength?: number }>;
};

export type TtsServiceInput = {
  text: string;
  voice: string;
  model: string;
  format: "mp3" | "wav";
};

export type TtsServiceResult =
  | {
      status: "ready";
      asset: typeof ttsAssets.$inferSelect;
      cacheKey: string;
      audioUrl: string;
    }
  | { status: "generating"; cacheKey: string; retryAfterMs: number };

const isUniqueConstraintError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const message = "message" in error ? String((error as { message?: string }).message) : "";
  return message.includes("UNIQUE") || message.includes("unique") || message.includes("constraint");
};

const toAudioUrl = (cacheKey: string) => `/api/v1/tts/${cacheKey}`;

export const getOrCreateTtsAsset = async (
  db: ApiDatabase,
  env: RuntimeEnv,
  storage: TtsStorage,
  provider: TtsProvider,
  input: TtsServiceInput,
  logger?: (level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => void
): Promise<TtsServiceResult> => {
  const { cacheKey, normalizedText } = await buildTtsCacheKey({
    text: input.text,
    model: input.model,
    voice: input.voice,
    format: input.format
  });
  const r2Key = buildTtsR2Key({
    cacheKey,
    model: input.model,
    voice: input.voice,
    format: input.format
  });
  const audioUrl = toAudioUrl(cacheKey);
  const now = Date.now();

  const [existing] = await db
    .select()
    .from(ttsAssets)
    .where(eq(ttsAssets.cache_key, cacheKey))
    .limit(1);

  if (existing) {
    if (existing.status === "ready") {
      return { status: "ready", asset: existing, cacheKey, audioUrl };
    }
    if (existing.status === "generating") {
      return { status: "generating", cacheKey, retryAfterMs: 500 };
    }
    await db
      .update(ttsAssets)
      .set({ status: "generating", error: null, updated_at: now })
      .where(eq(ttsAssets.cache_key, cacheKey));
  } else {
    try {
      await db.insert(ttsAssets).values({
        id: nanoid(),
        cache_key: cacheKey,
        text: input.text,
        voice: input.voice,
        model: input.model,
        format: input.format,
        r2_key: r2Key,
        bytes: null,
        content_type: "audio/mpeg",
        etag: null,
        status: "generating",
        error: null,
        created_at: now,
        updated_at: now
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      const [conflict] = await db
        .select()
        .from(ttsAssets)
        .where(eq(ttsAssets.cache_key, cacheKey))
        .limit(1);
      if (conflict?.status === "ready") {
        return { status: "ready", asset: conflict, cacheKey, audioUrl };
      }
      if (conflict?.status === "generating") {
        return { status: "generating", cacheKey, retryAfterMs: 500 };
      }
      await db
        .update(ttsAssets)
        .set({ status: "generating", error: null, updated_at: now })
        .where(eq(ttsAssets.cache_key, cacheKey));
    }
  }

  logger?.("info", "tts.generate.start", {
    cache_key: cacheKey,
    text_length: normalizedText.length,
    provider: { kind: provider.kind, model: provider.model, voice: provider.voice }
  });

  try {
    const synthesized = await provider.synthesize({ text: normalizedText });
    const putResult = await storage.putObject(env.r2Bucket, r2Key, synthesized.bytes, synthesized.contentType);
    await db
      .update(ttsAssets)
      .set({
        status: "ready",
        bytes: synthesized.bytes.length,
        content_type: synthesized.contentType,
        etag: putResult.etag ?? null,
        updated_at: Date.now()
      })
      .where(eq(ttsAssets.cache_key, cacheKey));

    const [ready] = await db
      .select()
      .from(ttsAssets)
      .where(eq(ttsAssets.cache_key, cacheKey))
      .limit(1);
    if (!ready) {
      throw new Error("TTS asset missing after generation.");
    }
    logger?.("info", "tts.generate.ok", {
      cache_key: cacheKey,
      bytes: synthesized.bytes.length
    });
    return { status: "ready", asset: ready, cacheKey, audioUrl };
  } catch (error) {
    const message = safeTruncate((error as Error)?.message ?? "TTS generation failed", 240);
    await db
      .update(ttsAssets)
      .set({ status: "failed", error: message, updated_at: Date.now() })
      .where(eq(ttsAssets.cache_key, cacheKey));
    logger?.("error", "tts.generate.error", {
      cache_key: cacheKey,
      error: message
    });
    throw error;
  }
};
