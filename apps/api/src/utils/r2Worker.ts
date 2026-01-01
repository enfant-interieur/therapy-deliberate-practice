import type { R2Bucket } from "@cloudflare/workers-types";
import type { TtsStorage } from "../services/ttsService";

export const createR2BucketStorage = (bucket: R2Bucket): TtsStorage => {
  const headObject = async (_bucketName: string, key: string) => {
    const result = await bucket.head(key);
    if (!result) {
      return { exists: false };
    }
    return {
      exists: true,
      etag: result.etag ?? undefined,
      size: result.size ?? undefined
    };
  };

  const putObject = async (
    _bucketName: string,
    key: string,
    bytes: Uint8Array,
    contentType: string
  ) => {
    const result = await bucket.put(key, bytes, {
      httpMetadata: { contentType }
    });
    return { etag: result?.etag ?? undefined };
  };

  const getObject = async (_bucketName: string, key: string) => {
    const result = await bucket.get(key);
    if (!result) {
      throw new Error("R2 object not found");
    }
    const body = new Uint8Array(await result.arrayBuffer());
    return {
      body,
      contentType: result.httpMetadata?.contentType ?? "audio/mpeg",
      etag: result.etag ?? undefined,
      contentLength: result.size ?? undefined
    };
  };

  return { headObject, putObject, getObject };
};
