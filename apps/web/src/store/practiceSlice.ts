import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { EvaluationResult } from "@deliberate/shared";

type RecordingState = "idle" | "recording" | "processing" | "ready";

type PracticeState = {
  sessionId?: string;
  sessionItems: Array<{
    session_item_id: string;
    task_id: string;
    example_id: string;
    target_difficulty: number;
    patient_text: string;
  }>;
  currentIndex: number;
  currentSessionItemId?: string;
  currentAttemptId?: string;
  recordingState: RecordingState;
  audioBlobRef?: string;
  transcript?: string;
  evaluation?: EvaluationResult;
  patientReaction?: EvaluationResult["patient_reaction"];
  ui: {
    expandedCriteria: string[];
    lastScores: Record<string, number>;
  };
};

const initialState: PracticeState = {
  sessionItems: [],
  currentIndex: 0,
  recordingState: "idle",
  ui: {
    expandedCriteria: [],
    lastScores: {}
  }
};

const practiceSlice = createSlice({
  name: "practice",
  initialState,
  reducers: {
    resetSessionState(state) {
      state.sessionId = undefined;
      state.sessionItems = [];
      state.currentIndex = 0;
      state.currentSessionItemId = undefined;
      state.currentAttemptId = undefined;
      state.recordingState = "idle";
      state.audioBlobRef = undefined;
      state.transcript = undefined;
      state.evaluation = undefined;
      state.patientReaction = undefined;
    },
    setAttemptId(state, action: PayloadAction<string | undefined>) {
      state.currentAttemptId = action.payload;
    },
    setSession(state, action: PayloadAction<{ sessionId: string; items: PracticeState["sessionItems"] }>) {
      state.sessionId = action.payload.sessionId;
      state.sessionItems = action.payload.items;
      state.currentIndex = 0;
      state.currentSessionItemId = action.payload.items[0]?.session_item_id;
    },
    setCurrentIndex(state, action: PayloadAction<number>) {
      state.currentIndex = action.payload;
      state.currentSessionItemId = state.sessionItems[action.payload]?.session_item_id;
    },
    setRecordingState(state, action: PayloadAction<RecordingState>) {
      state.recordingState = action.payload;
    },
    setAudioBlobRef(state, action: PayloadAction<string | undefined>) {
      state.audioBlobRef = action.payload;
    },
    setTranscript(state, action: PayloadAction<string | undefined>) {
      state.transcript = action.payload;
    },
    setEvaluation(state, action: PayloadAction<EvaluationResult | undefined>) {
      state.evaluation = action.payload;
      state.patientReaction = action.payload?.patient_reaction;
      if (action.payload) {
        state.ui.lastScores = Object.fromEntries(
          action.payload.criterion_scores.map((score) => [score.criterion_id, score.score])
        );
      }
    },
    toggleCriterion(state, action: PayloadAction<string>) {
      if (state.ui.expandedCriteria.includes(action.payload)) {
        state.ui.expandedCriteria = state.ui.expandedCriteria.filter(
          (id) => id !== action.payload
        );
      } else {
        state.ui.expandedCriteria.push(action.payload);
      }
    }
  }
});

export const {
  resetSessionState,
  setAttemptId,
  setSession,
  setCurrentIndex,
  setRecordingState,
  setAudioBlobRef,
  setTranscript,
  setEvaluation,
  toggleCriterion
} = practiceSlice.actions;
export const practiceReducer = practiceSlice.reducer;
