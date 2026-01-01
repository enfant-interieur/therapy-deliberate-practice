import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import type { RuntimeEnv } from "../env";

export type R2ObjectHead = { exists: boolean; etag?: string; size?: number };
export type R2ObjectGet = {
  body: Uint8Array;
  contentType: string;
  etag?: string;
  contentLength?: number;
};

const resolveEndpoint = (env: RuntimeEnv) => {
  if (env.r2S3Endpoint) {
    return env.r2S3Endpoint;
  }
  if (!env.r2AccountId) {
    return "";
  }
  return `https://${env.r2AccountId}.r2.cloudflarestorage.com`;
};

const streamToUint8Array = async (body: unknown) => {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof (body as AsyncIterable<Uint8Array>)?.[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      chunks.push(data);
      total += data.length;
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }
  if (typeof (body as ReadableStream<Uint8Array>)?.getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
      }
    }
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }
  return new Uint8Array();
};

export const createR2Client = (env: RuntimeEnv) => {
  const endpoint = resolveEndpoint(env);
  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.r2AccessKeyId,
      secretAccessKey: env.r2SecretAccessKey
    }
  });

  const headObject = async (bucket: string, key: string): Promise<R2ObjectHead> => {
    try {
      const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return {
        exists: true,
        etag: result.ETag ?? undefined,
        size: result.ContentLength ?? undefined
      };
    } catch (error) {
      if ((error as { name?: string }).name === "NotFound") {
        return { exists: false };
      }
      throw error;
    }
  };

  const putObject = async (
    bucket: string,
    key: string,
    bytes: Uint8Array,
    contentType: string
  ) => {
    const result = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType
      })
    );
    return { etag: result.ETag ?? undefined };
  };

  const getObject = async (bucket: string, key: string): Promise<R2ObjectGet> => {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await streamToUint8Array(result.Body);
    return {
      body,
      contentType: result.ContentType ?? "audio/mpeg",
      etag: result.ETag ?? undefined,
      contentLength: result.ContentLength ?? undefined
    };
  };

  return { headObject, putObject, getObject };
};
