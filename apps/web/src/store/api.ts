import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  PracticeRunInput,
  PracticeRunResponse,
  DeliberatePracticeTaskV2,
  ParseMode,
  Task,
  TaskCriterion,
  TaskExample,
  TaskInteractionExample,
  EvaluationResult
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

export type PracticeSessionAttempt = {
  id: string;
  session_item_id: string;
  completed_at: number | null;
  transcript: string;
  evaluation: EvaluationResult | null;
  overall_score: number;
  overall_pass: boolean;
};

export type MinigameSession = {
  id: string;
  user_id: string;
  game_type: "ffa" | "tdm";
  visibility_mode: "normal" | "hard" | "extreme";
  task_selection: Record<string, unknown>;
  settings: Record<string, unknown>;
  created_at: number;
  ended_at: number | null;
};

export type MinigameTeam = {
  id: string;
  session_id: string;
  name: string;
  color: string;
  created_at: number;
};

export type MinigamePlayer = {
  id: string;
  session_id: string;
  name: string;
  avatar: string;
  team_id: string | null;
  created_at: number;
};

export type MinigameRound = {
  id: string;
  session_id: string;
  position: number;
  task_id: string;
  example_id: string;
  player_a_id: string;
  player_b_id: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  status: "pending" | "active" | "completed";
  started_at: number | null;
  completed_at: number | null;
  patient_text?: string | null;
};

export type MinigameRoundResult = {
  id: string;
  round_id: string;
  player_id: string;
  attempt_id: string;
  overall_score: number;
  overall_pass: boolean;
  created_at: number;
  transcript?: string | null;
  evaluation?: EvaluationResult | null;
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
    getTask: builder.query<
      Task & {
        criteria: TaskCriterion[];
        example_counts?: Record<number, number>;
        interaction_examples?: TaskInteractionExample[];
      },
      { id: string; includeInteractions?: boolean }
    >({
      query: ({ id, includeInteractions }) => ({
        url: `/tasks/${id}`,
        params: includeInteractions ? { include_interactions: 1 } : undefined
      }),
      providesTags: (_result, _err, { id }) => [{ type: "Task", id }]
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
    getPracticeSessionAttempts: builder.query<PracticeSessionAttempt[], string>({
      query: (sessionId) => `/sessions/${sessionId}/attempts`,
      providesTags: ["Attempt"]
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
    createTask: builder.mutation<{ id: string; slug: string }, Partial<Task> & { criteria?: TaskCriterion[]; examples?: TaskExample[] }>({
      query: (body) => ({ url: "/admin/tasks", method: "POST", body }),
      invalidatesTags: ["Task"]
    }),
    deleteTask: builder.mutation<{ status: string }, { id: string }>({
      query: ({ id }) => ({ url: `/admin/tasks/${id}`, method: "DELETE" }),
      invalidatesTags: (_result, _err, { id }) => [{ type: "Task", id }, "Task"]
    }),
    duplicateTask: builder.mutation<{ id: string; slug: string }, { id: string }>({
      query: ({ id }) => ({ url: `/admin/tasks/${id}/duplicate`, method: "POST" }),
      invalidatesTags: ["Task"]
    }),
    translateTask: builder.mutation<{ id: string; slug: string }, { id: string; targetLanguage: string }>({
      query: ({ id, targetLanguage }) => ({
        url: `/admin/tasks/${id}/translate`,
        method: "POST",
        body: { target_language: targetLanguage }
      }),
      invalidatesTags: ["Task"]
    }),
    parseTask: builder.mutation<
      DeliberatePracticeTaskV2,
      { free_text?: string; source_url?: string | null; parse_mode?: ParseMode }
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
    createMinigameSession: builder.mutation<
      { session_id: string },
      {
        game_type: "ffa" | "tdm";
        visibility_mode: "normal" | "hard" | "extreme";
        task_selection: Record<string, unknown>;
        settings: Record<string, unknown>;
      }
    >({
      query: (body) => ({ url: "/minigames/sessions", method: "POST", body })
    }),
    endMinigameSession: builder.mutation<{ ok: boolean }, { sessionId: string }>({
      query: ({ sessionId }) => ({ url: `/minigames/sessions/${sessionId}/end`, method: "POST" })
    }),
    addMinigameTeams: builder.mutation<{ teams: MinigameTeam[] }, { sessionId: string; teams: Array<{ name: string; color: string }> }>({
      query: ({ sessionId, teams }) => ({
        url: `/minigames/sessions/${sessionId}/teams`,
        method: "POST",
        body: { teams }
      })
    }),
    addMinigamePlayers: builder.mutation<
      { players: MinigamePlayer[] },
      { sessionId: string; players: Array<{ name: string; avatar: string; team_id?: string | null }> }
    >({
      query: ({ sessionId, players }) => ({
        url: `/minigames/sessions/${sessionId}/players`,
        method: "POST",
        body: { players }
      })
    }),
    generateMinigameRounds: builder.mutation<
      { round_count: number },
      { sessionId: string; count?: number }
    >({
      query: ({ sessionId, count }) => ({
        url: `/minigames/sessions/${sessionId}/rounds/generate`,
        method: "POST",
        body: count ? { count } : {}
      })
    }),
    getMinigameState: builder.query<
      {
        session: MinigameSession;
        teams: MinigameTeam[];
        players: MinigamePlayer[];
        rounds: MinigameRound[];
        results: MinigameRoundResult[];
      },
      string
    >({
      query: (sessionId) => `/minigames/sessions/${sessionId}/state`
    }),
    startMinigameRound: builder.mutation<{ ok: boolean }, { sessionId: string; roundId: string }>({
      query: ({ sessionId, roundId }) => ({
        url: `/minigames/sessions/${sessionId}/rounds/${roundId}/start`,
        method: "POST"
      })
    }),
    submitMinigameRound: builder.mutation<
      PracticeRunResponse,
      {
        sessionId: string;
        roundId: string;
        player_id: string;
        audio_base64: string;
        audio_mime?: string;
        mode?: "local_prefer" | "openai_only" | "local_only";
        practice_mode?: "standard" | "real_time";
        turn_context?: { patient_cache_key?: string; patient_statement_id?: string };
      }
    >({
      query: ({ sessionId, roundId, ...body }) => ({
        url: `/minigames/sessions/${sessionId}/rounds/${roundId}/submit`,
        method: "POST",
        body
      }),
      invalidatesTags: ["Attempt"]
    }),
    prefetchPatientAudio: builder.mutation<
      { cache_key: string; status: "ready" | "generating"; audio_url?: string; retry_after_ms?: number },
      { exercise_id: string; practice_mode: "real_time"; statement_id?: string }
    >({
      query: (body) => ({ url: "/practice/patient-audio/prefetch", method: "POST", body })
    }),
    prefetchPatientAudioBatch: builder.mutation<
      {
        items: Array<{
          statement_id: string;
          cache_key: string;
          status: "ready" | "generating";
          audio_url?: string;
          retry_after_ms?: number;
        }>;
        ready_count: number;
        total_count: number;
      },
      { exercise_id: string; practice_mode: "real_time"; statement_ids: string[] }
    >({
      query: (body) => ({
        url: "/practice/patient-audio/prefetch-batch",
        method: "POST",
        body
      })
    }),
    getAttempts: builder.query<
      Array<{
        id: string;
        task_id: string;
        task_title: string;
        example_id: string;
        example_difficulty: number;
        overall_score: number;
        overall_pass: boolean;
        completed_at: string;
        session_id: string | null;
      }>,
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
  useGetPracticeSessionAttemptsQuery,
  useGetAdminTasksQuery,
  useGetAdminTaskQuery,
  useUpdateTaskMutation,
  useCreateTaskMutation,
  useDeleteTaskMutation,
  useDuplicateTaskMutation,
  useTranslateTaskMutation,
  useParseTaskMutation,
  useImportTaskMutation,
  useRunPracticeMutation,
  useCreateMinigameSessionMutation,
  useEndMinigameSessionMutation,
  useAddMinigameTeamsMutation,
  useAddMinigamePlayersMutation,
  useGenerateMinigameRoundsMutation,
  useGetMinigameStateQuery,
  useLazyGetMinigameStateQuery,
  useStartMinigameRoundMutation,
  useSubmitMinigameRoundMutation,
  usePrefetchPatientAudioMutation,
  usePrefetchPatientAudioBatchMutation,
  useGetAttemptsQuery
} = api;
