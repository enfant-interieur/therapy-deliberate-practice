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
    confidence?: number;
    words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
  };
  criterion_scores: Array<{
    criterion_id: string;
    score: number;
    rationale_short: string;
    evidence_quotes?: string[];
    missed_points?: string[];
  }>;
  overall: {
    score: number;
    pass: boolean;
    summary_feedback: string;
    what_to_improve_next: string[];
  };
  patient_reaction: {
    emotion: "neutral" | "warm" | "sad" | "anxious" | "angry" | "relieved" | "engaged";
    intensity: 0 | 1 | 2 | 3;
    action?: "nod" | "shake_head" | "look_away" | "lean_in" | "sigh" | "smile";
    response_text?: string;
  };
  diagnostics?: {
    provider: {
      stt: { kind: "local" | "openai"; model?: string };
      llm: { kind: "local" | "openai"; model?: string };
    };
    timing_ms?: { stt?: number; llm?: number; total?: number };
  };
};

export type PracticeRunInput = {
  session_item_id?: string;
  task_id?: string;
  example_id?: string;
  attempt_id?: string;
  audio: string;
  audio_mime?: string;
  mode?: "local_prefer" | "openai_only" | "local_only";
  practice_mode?: "standard" | "real_time";
  turn_context?: {
    patient_cache_key?: string;
    patient_statement_id?: string;
  };
};

export type PracticeRunError = {
  stage: "input" | "stt" | "scoring" | "db";
  message: string;
};

export type PracticeRunTranscript = {
  text: string;
  provider: { kind: "local" | "openai"; model: string };
  duration_ms: number;
};

export type PracticeRunScoring = {
  evaluation: EvaluationResult;
  provider: { kind: "local" | "openai"; model: string };
  duration_ms: number;
};

export type PracticeRunResponse = {
  requestId: string;
  attemptId?: string;
  next_recommended_difficulty?: number;
  transcript?: PracticeRunTranscript;
  scoring?: PracticeRunScoring;
  errors?: PracticeRunError[];
  debug?: {
    timings: Record<string, number>;
    selectedProviders: {
      stt: { kind: "local" | "openai"; model: string };
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
