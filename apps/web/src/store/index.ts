import { configureStore } from "@reduxjs/toolkit";
import { api } from "./api";
import { authReducer } from "./authSlice";
import { taskReducer } from "./taskSlice";
import { practiceReducer } from "./practiceSlice";
import { settingsReducer } from "./settingsSlice";
import { requestIdMiddleware, errorNormalizationMiddleware } from "./middleware";

export const store = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
    auth: authReducer,
    task: taskReducer,
    practice: practiceReducer,
    settings: settingsReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware, requestIdMiddleware, errorNormalizationMiddleware)
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
