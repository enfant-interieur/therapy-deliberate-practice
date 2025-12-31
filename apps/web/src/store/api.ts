import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  Exercise,
  PracticeRunInput,
  PracticeRunResponse,
  DeliberatePracticeTaskV2
} from "@deliberate/shared";
import type { RootState } from ".";

export type AdminWhoami = {
  isAuthenticated: boolean;
  isAdmin: boolean;
  email: string | null;
};

export type UserProfile = {
  id: string;
  email: string | null;
  created_at: string | null;
  hasOpenAiKey: boolean;
};

export type UserSettings = {
  aiMode: "local_prefer" | "openai_only" | "local_only";
  localSttUrl: string;
  localLlmUrl: string;
  storeAudio: boolean;
  hasOpenAiKey: boolean;
};

export type UserSettingsInput = {
  aiMode: UserSettings["aiMode"];
  localSttUrl: string | null;
  localLlmUrl: string | null;
  storeAudio: boolean;
};

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api/v1",
    prepareHeaders: (headers, { getState }) => {
      const state = getState() as RootState;
      const token = state.auth.accessToken;
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      if (import.meta.env.DEV) {
        const devToken = window.localStorage.getItem("devAdminToken");
        if (devToken) {
          headers.set("x-dev-admin-token", devToken);
        }
      }
      return headers;
    }
  }),
  tagTypes: ["Exercise", "Attempt"],
  endpoints: (builder) => ({
    getAdminWhoami: builder.query<AdminWhoami, void>({
      query: () => "/admin/whoami"
    }),
    getMe: builder.query<UserProfile, void>({
      query: () => "/me"
    }),
    getMeSettings: builder.query<UserSettings, void>({
      query: () => "/me/settings"
    }),
    updateMeSettings: builder.mutation<UserSettings, UserSettingsInput>({
      query: (body) => ({ url: "/me/settings", method: "PUT", body })
    }),
    updateOpenAiKey: builder.mutation<{ ok: boolean; hasOpenAiKey: boolean }, { openaiApiKey: string }>({
      query: (body) => ({ url: "/me/openai-key", method: "PUT", body })
    }),
    deleteOpenAiKey: builder.mutation<{ ok: boolean; hasOpenAiKey: boolean }, void>({
      query: () => ({ url: "/me/openai-key", method: "DELETE" })
    }),
    validateOpenAiKey: builder.mutation<{ ok: boolean; error?: string }, { openaiApiKey?: string }>({
      query: (body) => ({ url: "/me/openai-key/validate", method: "POST", body })
    }),
    getExercises: builder.query<Exercise[], { tag?: string; difficulty?: number; q?: string }>({
      query: (params) => ({ url: "/exercises", params }),
      providesTags: ["Exercise"]
    }),
    getExercise: builder.query<Exercise, string>({
      query: (id) => `/exercises/${id}`,
      providesTags: (_result, _err, id) => [{ type: "Exercise", id }]
    }),
    updateExercise: builder.mutation<{ status: string }, { id: string; exercise: Exercise }>({
      query: ({ id, exercise }) => ({
        url: `/exercises/${id}`,
        method: "PUT",
        body: exercise
      }),
      invalidatesTags: (_result, _err, { id }) => [{ type: "Exercise", id }, "Exercise"]
    }),
    parseExercise: builder.mutation<
      DeliberatePracticeTaskV2,
      { free_text?: string; source_url?: string | null }
    >({
      query: (body) => ({ url: "/admin/parse-exercise", method: "POST", body })
    }),
    importExercise: builder.mutation<
      { id: string; slug: string },
      { task_v2: DeliberatePracticeTaskV2; exercise_overrides?: Record<string, unknown> }
    >({
      query: (body) => ({ url: "/admin/import-exercise", method: "POST", body }),
      invalidatesTags: ["Exercise"]
    }),
    startAttempt: builder.mutation<{ attempt_id: string }, { exercise_id: string }>({
      query: (body) => ({ url: "/attempts/start", method: "POST", body }),
      invalidatesTags: ["Attempt"]
    }),
    runPractice: builder.mutation<PracticeRunResponse, PracticeRunInput>({
      query: (body) => ({ url: "/practice/run", method: "POST", body }),
      invalidatesTags: ["Attempt"]
    }),
    getAttempts: builder.query<
      Array<{ id: string; exercise_id: string; overall_score: number; overall_pass: boolean; completed_at: string }>,
      { exercise_id?: string }
    >({
      query: (params) => ({ url: "/attempts", params }),
      providesTags: ["Attempt"]
    })
  })
});

export const {
  useGetAdminWhoamiQuery,
  useGetMeQuery,
  useGetMeSettingsQuery,
  useUpdateMeSettingsMutation,
  useUpdateOpenAiKeyMutation,
  useDeleteOpenAiKeyMutation,
  useValidateOpenAiKeyMutation,
  useGetExercisesQuery,
  useGetExerciseQuery,
  useUpdateExerciseMutation,
  useParseExerciseMutation,
  useImportExerciseMutation,
  useStartAttemptMutation,
  useRunPracticeMutation,
  useGetAttemptsQuery
} = api;
