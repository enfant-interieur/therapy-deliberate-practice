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
};

export type PracticeRunInput = {
  exercise_id: string;
  attempt_id?: string;
  audio: string;
  mode?: "local_prefer" | "openai_only" | "local_only";
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
