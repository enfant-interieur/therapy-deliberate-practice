import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type TaskFilters = {
  tag?: string;
  q?: string;
  skill_domain?: string;
};

type TaskState = {
  selectedTaskId?: string;
  filters: TaskFilters;
};

const initialState: TaskState = {
  filters: {}
};

const taskSlice = createSlice({
  name: "task",
  initialState,
  reducers: {
    setSelectedTask(state, action: PayloadAction<string | undefined>) {
      state.selectedTaskId = action.payload;
    },
    setFilters(state, action: PayloadAction<TaskFilters>) {
      state.filters = action.payload;
    }
  }
});

export const { setSelectedTask, setFilters } = taskSlice.actions;
export const taskReducer = taskSlice.reducer;
