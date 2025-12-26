import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { EvaluationResult } from "@deliberate/shared";

type RecordingState = "idle" | "recording" | "processing" | "ready";

type PracticeState = {
  currentAttemptId?: string;
  recordingState: RecordingState;
  audioBlobRef?: string;
  transcript?: string;
  evaluation?: EvaluationResult;
  patientReaction?: EvaluationResult["patient_reaction"];
  ui: {
    expandedObjectives: string[];
    lastScores: Record<string, number>;
  };
};

const initialState: PracticeState = {
  recordingState: "idle",
  ui: {
    expandedObjectives: [],
    lastScores: {}
  }
};

const practiceSlice = createSlice({
  name: "practice",
  initialState,
  reducers: {
    setAttemptId(state, action: PayloadAction<string | undefined>) {
      state.currentAttemptId = action.payload;
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
          action.payload.objective_scores.map((score) => [score.objective_id, score.score])
        );
      }
    },
    toggleObjective(state, action: PayloadAction<string>) {
      if (state.ui.expandedObjectives.includes(action.payload)) {
        state.ui.expandedObjectives = state.ui.expandedObjectives.filter(
          (id) => id !== action.payload
        );
      } else {
        state.ui.expandedObjectives.push(action.payload);
      }
    }
  }
});

export const {
  setAttemptId,
  setRecordingState,
  setAudioBlobRef,
  setTranscript,
  setEvaluation,
  toggleObjective
} = practiceSlice.actions;
export const practiceReducer = practiceSlice.reducer;
