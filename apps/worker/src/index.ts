import type { MessageBatch } from "@cloudflare/workers-types";
import { createApiApp } from "../../api/src/app";
import { createD1Db } from "../../api/src/db/d1";
import { resolveEnv, type EnvBindings } from "../../api/src/env";
import { createR2BucketStorage } from "../../api/src/utils/r2Worker";
import {
  handleBatchParseQueueMessage,
  type BatchParseQueueMessage,
} from "../../api/src/services/adminBatchParseService";
import {
  handlePatientAudioQueueMessage,
  type PatientAudioQueueMessage,
} from "../../api/src/services/patientAudioQueueService";

export type WorkerEnv = CloudflareBindings & EnvBindings;

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // OAuth callbacks and host-only session cookies share one production origin.
    if (
      env.ENV === "production" &&
      url.hostname === "www.therapy-deliberate-practice.com"
    ) {
      url.hostname = "therapy-deliberate-practice.com";
      return Response.redirect(url.href, 308);
    }
    if (url.pathname.startsWith("/api/")) {
      const queueProducer = env.ADMIN_BATCH_PARSE_QUEUE
        ? {
            send: async (message: BatchParseQueueMessage) => {
              await env.ADMIN_BATCH_PARSE_QUEUE!.send(message);
            },
          }
        : undefined;
      const patientAudioQueueProducer = env.PATIENT_AUDIO_QUEUE
        ? {
            send: async (message: PatientAudioQueueMessage) => {
              await env.PATIENT_AUDIO_QUEUE!.send(message);
            },
          }
        : undefined;
      const runtimeEnv = resolveEnv(env);
      const app = createApiApp({
        env: runtimeEnv,
        db: createD1Db(env.DB),
        sendAuthEmail:
          runtimeEnv.authEmailEnabled &&
          runtimeEnv.authEmailFrom &&
          env.AUTH_EMAIL
            ? async (message) => {
                await env.AUTH_EMAIL.send({
                  ...message,
                  from: {
                    email: runtimeEnv.authEmailFrom,
                    name: "Therapy Studio",
                  },
                });
              }
            : undefined,
        tts: { storage: createR2BucketStorage(env.deliberate_practice_audio) },
        queues:
          queueProducer || patientAudioQueueProducer
            ? {
                adminBatchParse: queueProducer,
                patientAudio: patientAudioQueueProducer,
              }
            : undefined,
      });
      return app.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
  async queue(
    batch: MessageBatch<BatchParseQueueMessage | PatientAudioQueueMessage>,
    env: WorkerEnv,
  ) {
    const runtimeEnv = resolveEnv(env);
    const db = createD1Db(env.DB);
    const storage = createR2BucketStorage(env.deliberate_practice_audio);
    for (const message of batch.messages) {
      try {
        const payload = message.body;
        if (payload && "jobId" in payload) {
          await handleBatchParseQueueMessage(db, runtimeEnv, payload);
          message.ack();
          continue;
        }
        if (payload && "statementId" in payload && "exerciseId" in payload) {
          await handlePatientAudioQueueMessage(
            db,
            runtimeEnv,
            storage,
            payload,
          );
          message.ack();
          continue;
        }
        message.ack();
      } catch (error) {
        console.error("Queue handler failed", error);
        message.retry();
      }
    }
  },
};
