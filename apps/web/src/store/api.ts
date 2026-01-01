import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  PracticeRunInput,
  PracticeRunResponse,
  DeliberatePracticeTaskV2,
  Task,
  TaskCriterion,
  TaskExample
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

export type PracticeSessionItem = {
  session_item_id: string;
  task_id: string;
  example_id: string;
  target_difficulty: number;
  patient_text: string;
};

export type PracticeSessionSummary = {
  id: string;
  mode: string;
  source_task_id: string | null;
  created_at: number;
  ended_at: number | null;
  item_count: number;
  completed_count: number;
  items: PracticeSessionItem[];
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
  tagTypes: ["Task", "Attempt"],
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
    getTasks: builder.query<Task[], { tag?: string; q?: string; skill_domain?: string; published?: 1 }>(
      {
        query: (params) => ({ url: "/tasks", params }),
        providesTags: ["Task"]
      }
    ),
    getTask: builder.query<Task & { criteria: TaskCriterion[]; example_counts?: Record<number, number> }, string>({
      query: (id) => `/tasks/${id}`,
      providesTags: (_result, _err, id) => [{ type: "Task", id }]
    }),
    getTaskExamples: builder.query<TaskExample[], { taskId: string; difficulty?: number; limit?: number; exclude?: string[] }>(
      {
        query: ({ taskId, exclude, ...params }) => ({
          url: `/tasks/${taskId}/examples`,
          params: { ...params, exclude: exclude?.join(",") }
        })
      }
    ),
    startSession: builder.mutation<
      { session_id: string; items: PracticeSessionItem[] },
      { mode: "single_task" | "mixed_set"; task_id?: string; item_count: number; difficulty?: number }
    >({
      query: (body) => ({ url: "/sessions/start", method: "POST", body })
    }),
    getPracticeSessions: builder.query<PracticeSessionSummary[], { task_id?: string }>({
      query: (params) => ({ url: "/sessions", params })
    }),
    getAdminTasks: builder.query<Task[], void>({
      query: () => "/admin/tasks",
      providesTags: ["Task"]
    }),
    getAdminTask: builder.query<Task & { criteria: TaskCriterion[]; examples: TaskExample[] }, string>({
      query: (id) => `/admin/tasks/${id}`,
      providesTags: (_result, _err, id) => [{ type: "Task", id }]
    }),
    updateTask: builder.mutation<{ status: string }, { id: string; task: Task & { criteria?: TaskCriterion[]; examples?: TaskExample[] } }>({
      query: ({ id, task }) => ({
        url: `/admin/tasks/${id}`,
        method: "PUT",
        body: task
      }),
      invalidatesTags: (_result, _err, { id }) => [{ type: "Task", id }, "Task"]
    }),
    parseTask: builder.mutation<
      DeliberatePracticeTaskV2,
      { free_text?: string; source_url?: string | null }
    >({
      query: (body) => ({ url: "/admin/parse-task", method: "POST", body })
    }),
    importTask: builder.mutation<
      { id: string; slug: string },
      { task_v2: DeliberatePracticeTaskV2; task_overrides?: Record<string, unknown> }
    >({
      query: (body) => ({ url: "/admin/import-task", method: "POST", body }),
      invalidatesTags: ["Task"]
    }),
    runPractice: builder.mutation<PracticeRunResponse, PracticeRunInput>({
      query: (body) => ({ url: "/practice/run", method: "POST", body }),
      invalidatesTags: ["Attempt"]
    }),
    prefetchPatientAudio: builder.mutation<
      { cache_key: string; status: "ready" | "generating"; audio_url?: string; retry_after_ms?: number },
      { exercise_id: string; practice_mode: "real_time"; statement_id?: string }
    >({
      query: (body) => ({ url: "/practice/patient-audio/prefetch", method: "POST", body })
    }),
    getAttempts: builder.query<
      Array<{ id: string; task_id: string; task_title: string; example_id: string; example_difficulty: number; overall_score: number; overall_pass: boolean; completed_at: string }>,
      { task_id?: string }
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
  useGetTasksQuery,
  useGetTaskQuery,
  useGetTaskExamplesQuery,
  useStartSessionMutation,
  useGetPracticeSessionsQuery,
  useGetAdminTasksQuery,
  useGetAdminTaskQuery,
  useUpdateTaskMutation,
  useParseTaskMutation,
  useImportTaskMutation,
  useRunPracticeMutation,
  usePrefetchPatientAudioMutation,
  useGetAttemptsQuery
} = api;
