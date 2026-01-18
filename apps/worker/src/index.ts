import type { D1Database, MessageBatch, Queue, R2Bucket } from "@cloudflare/workers-types";
import { createApiApp } from "../../api/src/app";
import { createD1Db } from "../../api/src/db/d1";
import { resolveEnv, type EnvBindings } from "../../api/src/env";
import { createR2BucketStorage } from "../../api/src/utils/r2Worker";
import {
  handleBatchParseQueueMessage,
  type BatchParseQueueMessage
} from "../../api/src/services/adminBatchParseService";

export type WorkerEnv = EnvBindings & {
  DB: D1Database;
  ASSETS: Fetcher;
  deliberate_practice_audio: R2Bucket;
  ADMIN_BATCH_PARSE_QUEUE?: Queue;
};

let cachedApp: ReturnType<typeof createApiApp> | null = null;

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    if (!cachedApp) {
      const queueProducer = env.ADMIN_BATCH_PARSE_QUEUE
        ? {
            send: (message: BatchParseQueueMessage) => env.ADMIN_BATCH_PARSE_QUEUE!.send(message)
          }
        : undefined;
      cachedApp = createApiApp({
        env: resolveEnv(env),
        db: createD1Db(env.DB),
        tts: { storage: createR2BucketStorage(env.deliberate_practice_audio) },
        queues: queueProducer ? { adminBatchParse: queueProducer } : undefined
      });
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return cachedApp.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
  async queue(batch: MessageBatch<BatchParseQueueMessage>, env: WorkerEnv) {
    const runtimeEnv = resolveEnv(env);
    const db = createD1Db(env.DB);
    for (const message of batch.messages) {
      const payload = message.body;
      if (!payload?.jobId) {
        message.ack();
        continue;
      }
      try {
        await handleBatchParseQueueMessage(db, runtimeEnv, payload);
        message.ack();
      } catch (error) {
        console.error("Batch parse queue handler failed", error);
        message.retry();
      }
    }
  }
};
