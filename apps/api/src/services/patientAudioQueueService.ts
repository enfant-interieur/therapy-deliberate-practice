import { eq } from "drizzle-orm";
import type { RuntimeEnv } from "../env";
import type { ApiDatabase } from "../db/types";
import { userSettings } from "../db/schema";
import { resolveEffectiveAiConfig } from "../providers/config";
import { getErrorRequestId, isProviderConfigError } from "../providers/providerErrors";
import { decryptOpenAiKey } from "../utils/crypto";
import { log, safeError } from "../utils/logger";
import { getOrCreateTtsAsset, type TtsStorage } from "./ttsService";
import { selectPatientTtsProvider } from "./patientAudioService";

export type PatientAudioQueueMessage = {
  userId: string;
  exerciseId: string;
  statementId: string;
  text: string;
  requestId?: string | null;
};

export type PatientAudioQueueProducer = {
  send: (message: PatientAudioQueueMessage) => Promise<void>;
};

export const handlePatientAudioQueueMessage = async (
  db: ApiDatabase,
  env: RuntimeEnv,
  storage: TtsStorage,
  message: PatientAudioQueueMessage
) => {
  const baseFields = {
    queue: "patient_audio",
    requestId: message.requestId ?? null,
    userId: message.userId,
    exerciseId: message.exerciseId,
    statementId: message.statementId
  };
  const logEvent = (
    level: "info" | "warn" | "error",
    event: string,
    fields: Record<string, unknown> = {}
  ) => {
    log(level, event, { ...baseFields, ...fields });
  };

  const [settings] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.user_id, message.userId))
    .limit(1);

  if (!settings) {
    logEvent("warn", "tts.queue.settings_missing");
    return;
  }

  let config;
  try {
    config = await resolveEffectiveAiConfig({
      env,
      settings,
      decryptOpenAiKey
    });
  } catch (error) {
    if (isProviderConfigError(error)) {
      logEvent("warn", "tts.queue.config_error", { code: error.code });
      return;
    }
    logEvent("error", "tts.queue.config_error", { error: safeError(error) });
    throw error;
  }

  let ttsProvider;
  try {
    ttsProvider = await selectPatientTtsProvider({
      env,
      config,
      logEvent
    });
  } catch (error) {
    logEvent("error", "tts.queue.select_error", { error: safeError(error) });
    throw error;
  }

  try {
    await getOrCreateTtsAsset(
      db,
      env,
      storage,
      ttsProvider,
      {
        text: message.text,
        voice: ttsProvider.voice,
        model: ttsProvider.model,
        format: ttsProvider.format
      },
      logEvent,
      { forceGenerate: true }
    );
  } catch (error) {
    logEvent("error", "tts.queue.generate_error", {
      error: safeError(error),
      error_request_id: getErrorRequestId(error)
    });
    throw error;
  }
};
