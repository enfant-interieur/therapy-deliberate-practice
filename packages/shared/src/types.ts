export type Objective = {
  id: string;
  label: string;
  description: string;
  examples_good?: string[];
  examples_bad?: string[];
  weight?: number;
  rubric: {
    score_min: 0;
    score_max: 4;
    anchors: Array<{
      score: 0 | 1 | 2 | 3 | 4;
      meaning: string;
    }>;
  };
};

export type GradingSpec = {
  pass_rule: {
    overall_min_score?: number;
    min_per_objective?: number;
    required_objective_ids?: string[];
  };
  scoring: { aggregation: "weighted_mean" };
};

export type ExerciseCriterion = {
  id: string;
  label: string;
  description: string;
  objective_id?: string;
};

export type RoleplayStatement = {
  id: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  text: string;
  criterion_ids?: string[];
  cue_ids?: string[];
};

export type RoleplaySet = {
  id: string;
  label: string;
  statements: RoleplayStatement[];
};

export type ExampleDialogueTurn = {
  role: "client" | "therapist";
  text: string;
};

export type ExampleDialogue = {
  id: string;
  label: string;
  turns: ExampleDialogueTurn[];
  related_statement_id?: string;
};

export type PatientCue = {
  id: string;
  label: string;
  text: string;
  related_statement_ids?: string[];
};

export type ExerciseContentV2 = {
  preparations?: string[];
  expected_therapist_response?: string;
  criteria: ExerciseCriterion[];
  roleplay_sets: RoleplaySet[];
  example_dialogues: ExampleDialogue[];
  patient_cues: PatientCue[];
  practice_instructions?: string;
  source?: {
    text?: string | null;
    url?: string | null;
  };
};

export type DeliberatePracticeTaskV2 = {
  version: "2.0";
  task: {
    name: string;
    description: string;
    skill_domain: string;
    skill_difficulty_label?: string;
    skill_difficulty_numeric: number;
    objectives: Array<{
      id: string;
      label: string;
      description: string;
    }>;
    tags: string[];
  };
  content: ExerciseContentV2;
};

export type EvaluationResult = {
  version: "1.0";
  exercise_id: string;
  attempt_id: string;
  transcript: {
    text: string;
    confidence?: number;
    words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
  };
  objective_scores: Array<{
    objective_id: string;
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

export type Exercise = {
  id: string;
  slug: string;
  title: string;
  description: string;
  skill_domain: string;
  difficulty: number;
  patient_profile: Record<string, unknown>;
  example_prompt: string;
  example_good_response?: string | null;
  objectives: Objective[];
  grading: GradingSpec;
  tags: string[];
  is_published: boolean;
  content?: ExerciseContentV2;
  criteria?: ExerciseContentV2["criteria"];
};

export type PracticeRunInput = {
  exercise_id: string;
  attempt_id?: string;
  audio: string;
  mode?: "local_prefer" | "openai_only" | "local_only";
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
  exercise: Exercise;
  attempt_id: string;
  transcript: {
    text: string;
    confidence?: number;
    words?: Array<{ w: string; t0?: number; t1?: number; p?: number }>;
  };
};
