import type { EffectiveAiConfig } from "../providers/config";
import { selectTtsProvider } from "../providers";
import type { RuntimeEnv } from "../env";
import type { LogFn } from "../utils/logger";

export const selectPatientTtsProvider = async ({
  env,
  config,
  logEvent
}: {
  env: RuntimeEnv;
  config: EffectiveAiConfig;
  logEvent: LogFn;
}) => {
  const ttsConfig: EffectiveAiConfig = {
    ...config,
    mode: "openai_only",
    local: { ...config.local, baseUrl: null }
  };
  logEvent("info", "tts.select.start", { mode: ttsConfig.mode });
  const ttsSelection = await selectTtsProvider(
    ttsConfig,
    {
      openai: {
        model: env.openaiTtsModel,
        voice: env.openaiTtsVoice,
        format: env.openaiTtsFormat,
        instructions: env.openaiTtsInstructions
      },
      local: {
        voice: env.localTtsVoice,
        format: env.localTtsFormat
      }
    },
    logEvent
  );
  logEvent("info", "tts.select.ok", {
    selected: { kind: ttsSelection.provider.kind, model: ttsSelection.provider.model },
    health: ttsSelection.health
  });
  return ttsSelection.provider;
};
