import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  Exercise,
  PracticeRunInput,
  EvaluationResult,
  DeliberatePracticeTaskV2
} from "@deliberate/shared";

const adminToken = import.meta.env.VITE_ADMIN_TOKEN as string | undefined;

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({
    baseUrl: "/api/v1",
    prepareHeaders: (headers) => {
      if (adminToken) {
        headers.set("x-admin-token", adminToken);
      }
      return headers;
    }
  }),
  tagTypes: ["Exercise", "Attempt"],
  endpoints: (builder) => ({
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
    startAttempt: builder.mutation<{ attempt_id: string }, { exercise_id: string; user_id: string }>({
      query: (body) => ({ url: "/attempts/start", method: "POST", body }),
      invalidatesTags: ["Attempt"]
    }),
    runPractice: builder.mutation<EvaluationResult, PracticeRunInput>({
      query: (body) => ({ url: "/practice/run", method: "POST", body }),
      invalidatesTags: ["Attempt"]
    }),
    getAttempts: builder.query<
      Array<{ id: string; exercise_id: string; overall_score: number; overall_pass: boolean; completed_at: string }>,
      { user_id?: string; exercise_id?: string }
    >({
      query: (params) => ({ url: "/attempts", params }),
      providesTags: ["Attempt"]
    })
  })
});

export const {
  useGetExercisesQuery,
  useGetExerciseQuery,
  useUpdateExerciseMutation,
  useParseExerciseMutation,
  useImportExerciseMutation,
  useStartAttemptMutation,
  useRunPracticeMutation,
  useGetAttemptsQuery
} = api;
