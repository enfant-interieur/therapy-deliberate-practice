import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type SettingsState = {
  aiMode: "local_prefer" | "openai_only" | "local_only";
  localAiBaseUrl: string | null;
  localEndpoints: {
    stt: string;
    llm: string;
  };
  privacy: {
    storeAudio: boolean;
  };
  hasOpenAiKey: boolean;
};

const initialState: SettingsState = {
  aiMode: "local_prefer",
  localAiBaseUrl: null,
  localEndpoints: {
    stt: "http://127.0.0.1:8484",
    llm: "http://127.0.0.1:8484"
  },
  privacy: {
    storeAudio: false
  },
  hasOpenAiKey: false
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    hydrateSettings(
      state,
      action: PayloadAction<{
        aiMode: SettingsState["aiMode"];
        localAiBaseUrl: string | null;
        localSttUrl: string;
        localLlmUrl: string;
        storeAudio: boolean;
        hasOpenAiKey: boolean;
      }>
    ) {
      state.aiMode = action.payload.aiMode;
      state.localAiBaseUrl = action.payload.localAiBaseUrl ?? null;
      state.localEndpoints.stt = action.payload.localSttUrl;
      state.localEndpoints.llm = action.payload.localLlmUrl;
      state.privacy.storeAudio = action.payload.storeAudio;
      state.hasOpenAiKey = action.payload.hasOpenAiKey;
    },
    setAiMode(state, action: PayloadAction<SettingsState["aiMode"]>) {
      state.aiMode = action.payload;
    },
    setLocalEndpoint(
      state,
      action: PayloadAction<{ kind: "stt" | "llm"; url: string }>
    ) {
      state.localEndpoints[action.payload.kind] = action.payload.url;
    },
    setStoreAudio(state, action: PayloadAction<boolean>) {
      state.privacy.storeAudio = action.payload;
    },
    setHasOpenAiKey(state, action: PayloadAction<boolean>) {
      state.hasOpenAiKey = action.payload;
    }
  }
});

export const { hydrateSettings, setAiMode, setLocalEndpoint, setStoreAudio, setHasOpenAiKey } =
  settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;
