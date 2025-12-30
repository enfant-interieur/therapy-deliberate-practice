import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type AuthState = {
  userId: string | null;
  token: string | null;
  isAdmin: boolean;
  adminEmail: string | null;
  adminAuthenticated: boolean;
  adminChecked: boolean;
};

const initialState: AuthState = {
  userId: "demo-user",
  token: null,
  isAdmin: false,
  adminEmail: null,
  adminAuthenticated: false,
  adminChecked: false
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<{ userId: string; token?: string }>) {
      state.userId = action.payload.userId;
      state.token = action.payload.token ?? null;
    },
    setAdminStatus(
      state,
      action: PayloadAction<{
        isAdmin: boolean;
        email: string | null;
        isAuthenticated: boolean;
      }>
    ) {
      state.isAdmin = action.payload.isAdmin;
      state.adminEmail = action.payload.email;
      state.adminAuthenticated = action.payload.isAuthenticated;
      state.adminChecked = true;
    }
  }
});

export const { setUser, setAdminStatus } = authSlice.actions;
export const authReducer = authSlice.reducer;
