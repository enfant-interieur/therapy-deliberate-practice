import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type AuthState = {
  userId: string | null;
  token: string | null;
  role: "user" | "admin";
};

const initialState: AuthState = {
  userId: "demo-user",
  token: null,
  role: "user"
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<{ userId: string; token?: string }>) {
      state.userId = action.payload.userId;
      state.token = action.payload.token ?? null;
    },
    setRole(state, action: PayloadAction<AuthState["role"]>) {
      state.role = action.payload;
    }
  }
});

export const { setUser, setRole } = authSlice.actions;
export const authReducer = authSlice.reducer;
