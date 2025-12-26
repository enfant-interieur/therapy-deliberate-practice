import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { Exercise, PracticeRunInput, EvaluationResult } from "@deliberate/shared";

export const api = createApi({
  reducerPath: "api",
  baseQuery: fetchBaseQuery({ baseUrl: "/api/v1" }),
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
  useStartAttemptMutation,
  useRunPracticeMutation,
  useGetAttemptsQuery
} = api;
