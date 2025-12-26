import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type SettingsState = {
  aiMode: "local_prefer" | "openai_only" | "local_only";
  localEndpoints: {
    stt: string;
    llm: string;
  };
  privacy: {
    storeAudio: boolean;
  };
};

const initialState: SettingsState = {
  aiMode: "local_prefer",
  localEndpoints: {
    stt: "http://localhost:7001",
    llm: "http://localhost:7002"
  },
  privacy: {
    storeAudio: false
  }
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
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
    }
  }
});

export const { setAiMode, setLocalEndpoint, setStoreAudio } = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;
