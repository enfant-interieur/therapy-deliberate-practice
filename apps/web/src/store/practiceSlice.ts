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
  attemptHistory: Record<
    string,
    { transcript?: string; evaluation?: EvaluationResult; attemptId?: string }
  >;
  ui: {
    expandedCriteria: string[];
    lastScores: Record<string, number>;
  };
};

const initialState: PracticeState = {
  sessionItems: [],
  currentIndex: 0,
  recordingState: "idle",
  attemptHistory: {},
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
      state.attemptHistory = {};
    },
    setAttemptId(state, action: PayloadAction<string | undefined>) {
      state.currentAttemptId = action.payload;
    },
    setSession(state, action: PayloadAction<{ sessionId: string; items: PracticeState["sessionItems"] }>) {
      state.sessionId = action.payload.sessionId;
      state.sessionItems = action.payload.items;
      state.currentIndex = 0;
      state.currentSessionItemId = action.payload.items[0]?.session_item_id;
      state.currentAttemptId = undefined;
      state.transcript = undefined;
      state.evaluation = undefined;
      state.patientReaction = undefined;
      state.attemptHistory = {};
    },
    setCurrentIndex(state, action: PayloadAction<number>) {
      state.currentIndex = action.payload;
      state.currentSessionItemId = state.sessionItems[action.payload]?.session_item_id;
      const activeItemId = state.currentSessionItemId;
      if (activeItemId && state.attemptHistory[activeItemId]) {
        const attempt = state.attemptHistory[activeItemId];
        state.transcript = attempt.transcript;
        state.evaluation = attempt.evaluation;
        state.currentAttemptId = attempt.attemptId;
        state.patientReaction = attempt.evaluation?.patient_reaction;
      } else {
        state.transcript = undefined;
        state.evaluation = undefined;
        state.currentAttemptId = undefined;
        state.patientReaction = undefined;
      }
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
    setSessionAttempts(
      state,
      action: PayloadAction<
        Record<string, { transcript?: string; evaluation?: EvaluationResult; attemptId?: string }>
      >
    ) {
      state.attemptHistory = action.payload;
      if (state.currentSessionItemId && state.attemptHistory[state.currentSessionItemId]) {
        const attempt = state.attemptHistory[state.currentSessionItemId];
        state.transcript = attempt.transcript;
        state.evaluation = attempt.evaluation;
        state.currentAttemptId = attempt.attemptId;
        state.patientReaction = attempt.evaluation?.patient_reaction;
      }
    },
    setAttemptForItem(
      state,
      action: PayloadAction<{
        sessionItemId: string;
        transcript?: string;
        evaluation?: EvaluationResult;
        attemptId?: string;
      }>
    ) {
      state.attemptHistory[action.payload.sessionItemId] = {
        transcript: action.payload.transcript,
        evaluation: action.payload.evaluation,
        attemptId: action.payload.attemptId
      };
      if (state.currentSessionItemId === action.payload.sessionItemId) {
        state.transcript = action.payload.transcript;
        state.evaluation = action.payload.evaluation;
        state.currentAttemptId = action.payload.attemptId;
        state.patientReaction = action.payload.evaluation?.patient_reaction;
        if (action.payload.evaluation) {
          state.ui.lastScores = Object.fromEntries(
            action.payload.evaluation.criterion_scores.map((score) => [
              score.criterion_id,
              score.score
            ])
          );
        }
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
  setSessionAttempts,
  setAttemptForItem,
  toggleCriterion
} = practiceSlice.actions;
export const practiceReducer = practiceSlice.reducer;
