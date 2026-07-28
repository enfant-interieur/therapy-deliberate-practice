import { createSlice, PayloadAction } from "@reduxjs/toolkit";

type AuthState = {
  userId: string | null;
  email: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  authChecked: boolean;
  isAdmin: boolean;
  adminEmail: string | null;
  adminAuthenticated: boolean;
  adminChecked: boolean;
};

const initialState: AuthState = {
  userId: null,
  email: null,
  accessToken: null,
  isAuthenticated: false,
  authChecked: false,
  isAdmin: false,
  adminEmail: null,
  adminAuthenticated: false,
  adminChecked: false,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setUser(
      state,
      action: PayloadAction<{
        userId: string | null;
        email: string | null;
        accessToken: string | null;
        isAuthenticated: boolean;
        authChecked: boolean;
      }>,
    ) {
      state.userId = action.payload.userId;
      state.email = action.payload.email;
      state.accessToken = action.payload.accessToken;
      state.isAuthenticated = action.payload.isAuthenticated;
      state.authChecked = action.payload.authChecked;
    },
    setAdminStatus(
      state,
      action: PayloadAction<{
        isAdmin: boolean;
        email: string | null;
        isAuthenticated: boolean;
      }>,
    ) {
      state.isAdmin = action.payload.isAdmin;
      state.adminEmail = action.payload.email;
      state.adminAuthenticated = action.payload.isAuthenticated;
      state.adminChecked = true;
    },
  },
});

export const { setUser, setAdminStatus } = authSlice.actions;
export const authReducer = authSlice.reducer;
