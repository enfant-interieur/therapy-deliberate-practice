import { z } from "zod";

export const objectiveSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  examples_good: z.array(z.string()).optional(),
  examples_bad: z.array(z.string()).optional(),
  weight: z.number().optional(),
  rubric: z.object({
    score_min: z.literal(0),
    score_max: z.literal(4),
    anchors: z.array(
      z.object({
        score: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4)
        ]),
        meaning: z.string()
      })
    )
  })
});

export const gradingSpecSchema = z.object({
  pass_rule: z.object({
    overall_min_score: z.number().optional(),
    min_per_objective: z.number().optional(),
    required_objective_ids: z.array(z.string()).optional()
  }),
  scoring: z.object({
    aggregation: z.literal("weighted_mean")
  })
});

export const exerciseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  skill_domain: z.string(),
  difficulty: z.number().min(1).max(5),
  patient_profile: z.record(z.unknown()),
  example_prompt: z.string(),
  example_good_response: z.string().nullable().optional(),
  objectives: z.array(objectiveSchema).min(2).max(6),
  grading: gradingSpecSchema,
  tags: z.array(z.string()),
  is_published: z.boolean()
});

export const evaluationResultSchema = z.object({
  version: z.literal("1.0"),
  exercise_id: z.string(),
  attempt_id: z.string(),
  transcript: z.object({
    text: z.string(),
    confidence: z.number().optional(),
    words: z
      .array(
        z.object({
          w: z.string(),
          t0: z.number().optional(),
          t1: z.number().optional(),
          p: z.number().optional()
        })
      )
      .optional()
  }),
  objective_scores: z.array(
    z.object({
      objective_id: z.string(),
      score: z.number().min(0).max(4),
      rationale_short: z.string().max(240),
      evidence_quotes: z.array(z.string()).optional(),
      missed_points: z.array(z.string()).optional()
    })
  ),
  overall: z.object({
    score: z.number().min(0).max(4),
    pass: z.boolean(),
    summary_feedback: z.string().max(400),
    what_to_improve_next: z.array(z.string()).min(1).max(3)
  }),
  patient_reaction: z.object({
    emotion: z.enum([
      "neutral",
      "warm",
      "sad",
      "anxious",
      "angry",
      "relieved",
      "engaged"
    ]),
    intensity: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3)
    ]),
    action: z
      .enum(["nod", "shake_head", "look_away", "lean_in", "sigh", "smile"])
      .optional(),
    response_text: z.string().optional()
  }),
  diagnostics: z
    .object({
      provider: z.object({
        stt: z.object({
          kind: z.enum(["local", "openai"]),
          model: z.string().optional()
        }),
        llm: z.object({
          kind: z.enum(["local", "openai"]),
          model: z.string().optional()
        })
      }),
      timing_ms: z
        .object({
          stt: z.number().optional(),
          llm: z.number().optional(),
          total: z.number().optional()
        })
        .optional()
    })
    .optional()
});

export const practiceRunInputSchema = z.object({
  exercise_id: z.string(),
  attempt_id: z.string().optional(),
  audio: z.string(),
  mode: z.enum(["local_prefer", "openai_only", "local_only"]).optional()
});
