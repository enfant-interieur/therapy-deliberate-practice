export type CriterionRubric = {
  score_min: 0;
  score_max: 4;
  anchors: Array<{
    score: 0 | 1 | 2 | 3 | 4;
    meaning: string;
  }>;
};

export type ParseMode = "original" | "exact" | "partial_prompt";

export type TaskCriterion = {
  id: string;
  label: string;
  description: string;
  rubric?: CriterionRubric;
};

export type TaskExample = {
  id: string;
  task_id?: string;
  difficulty: number;
  severity_label?: string | null;
  patient_text: string;
  language?: string;
  meta?: Record<string, unknown> | null;
  created_at?: number;
  updated_at?: number;
};

export type TaskInteractionExample = {
  id: string;
  difficulty: number;
  title?: string | null;
  patient_text: string;
  therapist_text: string;
};

export type Task = {
  id: string;
  slug: string;
  title: string;
  description: string;
  skill_domain: string;
  base_difficulty: number;
  general_objective?: string | null;
  tags: string[];
  authors: string[];
  language: string;
  is_published: boolean;
  parent_task_id?: string | null;
  created_at: number;
  updated_at: number;
  criteria?: TaskCriterion[];
  examples?: TaskExample[];
  interaction_examples?: TaskInteractionExample[];
};

export type DeliberatePracticeTaskV2 = {
  version: "2.1";
  task: {
    title: string;
    description: string;
    skill_domain: string;
    base_difficulty: number;
    general_objective?: string | null;
    tags: string[];
    language: string;
  };
  criteria: TaskCriterion[];
  examples: TaskExample[];
  interaction_examples?: TaskInteractionExample[];
};

export type EvaluationResult = {
  version: "2.0";
  task_id: string;
  example_id: string;
  attempt_id: string;
  transcript: {
    text: string;
    confidence?: number | null;
    words?: Array<{
      w: string;
      t0?: number | null;
      t1?: number | null;
      p?: number | null;
    }> | null;
  };
  criterion_scores: Array<{
    criterion_id: string;
    score: number;
    rationale_short: string;
    evidence_quotes?: string[] | null;
    missed_points?: string[] | null;
  }>;
  overall: {
    score: number;
    pass: boolean;
    summary_feedback: string;
    what_to_improve_next: string[];
  };
  patient_reaction: {
    emotion:
      "neutral" | "warm" | "sad" | "anxious" | "angry" | "relieved" | "engaged";
    intensity: 0 | 1 | 2 | 3;
    action?:
      "nod" | "shake_head" | "look_away" | "lean_in" | "sigh" | "smile" | null;
    response_text?: string | null;
  };
  diagnostics?: {
    provider: {
      stt: { kind: "local" | "openai"; model?: string | null };
      llm: { kind: "local" | "openai"; model?: string | null };
    };
    timing_ms?: {
      stt?: number | null;
      llm?: number | null;
      total?: number | null;
    } | null;
  } | null;
};

export type ProviderDescriptor = {
  kind: "local" | "openai";
  model: string;
};

export type PracticeRunInput = {
  session_item_id?: string;
  task_id?: string;
  example_id?: string;
  attempt_id?: string;
  input_mode?: "audio" | "typed";
  audio?: string;
  audio_mime?: string;
  transcript_text?: string;
  skip_scoring?: boolean;
  mode?: "local_prefer" | "openai_only" | "local_only";
  practice_mode?: "standard" | "real_time";
  turn_context?: {
    patient_cache_key?: string;
    patient_statement_id?: string;
    timing?: {
      response_delay_ms?: number | null;
      response_duration_ms?: number | null;
      response_timer_seconds?: number;
      max_response_duration_seconds?: number;
    };
  };
};

export const OPENAI_ACCESS_ISSUES = [
  "OPENAI_KEY_MISSING",
  "OPENAI_KEY_REJECTED",
  "OPENAI_ACCESS_DENIED",
  "OPENAI_QUOTA_EXHAUSTED",
] as const;

export type OpenAiAccessIssue = (typeof OPENAI_ACCESS_ISSUES)[number];

export type PracticeRunError = {
  stage: "input" | "stt" | "scoring" | "db";
  message: string;
  code?: OpenAiAccessIssue;
};

export type PracticeRunTranscript = {
  text: string;
  input_mode?: "audio" | "typed";
  provider: { kind: "local" | "openai"; model: string } | null;
  duration_ms: number | null;
};

export type PracticeRunScoring = {
  evaluation: EvaluationResult;
  provider: ProviderDescriptor;
  duration_ms: number;
};

export type PracticeRunResponse = {
  requestId: string;
  attemptId?: string;
  score_trust?: "cloud_trusted" | "local_unverified";
  next_recommended_difficulty?: number;
  transcript?: PracticeRunTranscript;
  scoring?: PracticeRunScoring;
  timing_penalty?: number;
  adjusted_score?: number;
  errors?: PracticeRunError[];
  debug?: {
    timings: Record<string, number>;
    selectedProviders: {
      stt: { kind: "local" | "openai"; model: string } | null;
      llm: { kind: "local" | "openai"; model: string } | null;
    };
  };
};

export type EvaluationInput = {
  task: Task;
  example: TaskExample;
  attempt_id: string;
  transcript: {
    text: string;
    confidence?: number;
    words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
  };
};
