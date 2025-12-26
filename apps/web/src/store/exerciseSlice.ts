import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type ExerciseFilters = {
  tag?: string;
  difficulty?: number;
  q?: string;
};

type ExerciseState = {
  selectedExerciseId?: string;
  filters: ExerciseFilters;
};

const initialState: ExerciseState = {
  filters: {}
};

const exerciseSlice = createSlice({
  name: "exercise",
  initialState,
  reducers: {
    setSelectedExercise(state, action: PayloadAction<string | undefined>) {
      state.selectedExerciseId = action.payload;
    },
    setFilters(state, action: PayloadAction<ExerciseFilters>) {
      state.filters = action.payload;
    }
  }
});

export const { setSelectedExercise, setFilters } = exerciseSlice.actions;
export const exerciseReducer = exerciseSlice.reducer;
