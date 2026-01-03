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
  format: "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
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

const formatContentType: Record<TtsServiceInput["format"], string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm"
};

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

  const ensureReadyFromHead = async (
    head: { exists: boolean; etag?: string; size?: number },
    existing?: typeof ttsAssets.$inferSelect
  ) => {
    if (!head.exists) {
      return null;
    }
    const contentType = existing?.content_type ?? formatContentType[input.format];
    if (existing) {
      await db
        .update(ttsAssets)
        .set({
          status: "ready",
          bytes: head.size ?? existing.bytes ?? null,
          content_type: contentType,
          etag: head.etag ?? existing.etag ?? null,
          error: null,
          updated_at: Date.now()
        })
        .where(eq(ttsAssets.cache_key, cacheKey));
    } else {
      await db.insert(ttsAssets).values({
        id: nanoid(),
        cache_key: cacheKey,
        text: input.text,
        voice: input.voice,
        model: input.model,
        format: input.format,
        r2_key: r2Key,
        bytes: head.size ?? null,
        content_type: contentType,
        etag: head.etag ?? null,
        status: "ready",
        error: null,
        created_at: now,
        updated_at: now
      });
    }
    const [asset] = await db
      .select()
      .from(ttsAssets)
      .where(eq(ttsAssets.cache_key, cacheKey))
      .limit(1);
    if (!asset) {
      throw new Error("TTS asset missing after R2 ready update.");
    }
    return asset;
  };

  const markGenerating = async () => {
    await db
      .update(ttsAssets)
      .set({ status: "generating", error: null, updated_at: Date.now() })
      .where(eq(ttsAssets.cache_key, cacheKey));
  };

  const [existing] = await db
    .select()
    .from(ttsAssets)
    .where(eq(ttsAssets.cache_key, cacheKey))
    .limit(1);

  if (existing) {
    if (existing.status === "ready") {
      const head = await storage.headObject(env.r2Bucket, r2Key);
      if (head.exists) {
        const updated = await ensureReadyFromHead(head, existing);
        return { status: "ready", asset: updated ?? existing, cacheKey, audioUrl };
      }
      await markGenerating();
    } else if (existing.status === "generating") {
      const head = await storage.headObject(env.r2Bucket, r2Key);
      if (head.exists) {
        const updated = await ensureReadyFromHead(head, existing);
        return { status: "ready", asset: updated ?? existing, cacheKey, audioUrl };
      }
      return { status: "generating", cacheKey, retryAfterMs: 500 };
    } else {
      const head = await storage.headObject(env.r2Bucket, r2Key);
      if (head.exists) {
        const updated = await ensureReadyFromHead(head, existing);
        return { status: "ready", asset: updated ?? existing, cacheKey, audioUrl };
      }
      await markGenerating();
    }
  } else {
    const head = await storage.headObject(env.r2Bucket, r2Key);
    if (head.exists) {
      const inserted = await ensureReadyFromHead(head);
      return { status: "ready", asset: inserted, cacheKey, audioUrl };
    }
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
        content_type: formatContentType[input.format],
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
      if (conflict) {
        if (conflict.status === "ready") {
          const head = await storage.headObject(env.r2Bucket, r2Key);
          if (head.exists) {
            const updated = await ensureReadyFromHead(head, conflict);
            return { status: "ready", asset: updated ?? conflict, cacheKey, audioUrl };
          }
          await markGenerating();
        } else if (conflict.status === "generating") {
          const head = await storage.headObject(env.r2Bucket, r2Key);
          if (head.exists) {
            const updated = await ensureReadyFromHead(head, conflict);
            return { status: "ready", asset: updated ?? conflict, cacheKey, audioUrl };
          }
          return { status: "generating", cacheKey, retryAfterMs: 500 };
        } else {
          const head = await storage.headObject(env.r2Bucket, r2Key);
          if (head.exists) {
            const updated = await ensureReadyFromHead(head, conflict);
            return { status: "ready", asset: updated ?? conflict, cacheKey, audioUrl };
          }
          await markGenerating();
        }
      }
    }
  }

  const [activeRow] = await db
    .select()
    .from(ttsAssets)
    .where(eq(ttsAssets.cache_key, cacheKey))
    .limit(1);

  logger?.("info", "tts.generate.start", {
    cache_key: cacheKey,
    text_length: normalizedText.length,
    provider: { kind: provider.kind, model: provider.model, voice: provider.voice }
  });

  try {
    const head = await storage.headObject(env.r2Bucket, r2Key);
    if (head.exists) {
      const updated = await ensureReadyFromHead(head, activeRow);
      if (!updated) {
        throw new Error("TTS asset missing after R2 check.");
      }
      return { status: "ready", asset: updated, cacheKey, audioUrl };
    }
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
