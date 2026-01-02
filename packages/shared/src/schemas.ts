import { z } from "zod";

const idSchema = z.string().min(1);

export const rubricSchema = z.object({
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
});

export const taskCriterionSchema = z.object({
  id: idSchema,
  label: z.string(),
  description: z.string(),
  rubric: rubricSchema.optional()
});

export const taskExampleSchema = z.object({
  id: idSchema,
  task_id: z.string().optional(),
  difficulty: z.number().min(1).max(5),
  severity_label: z.string().nullable().optional(),
  patient_text: z.string(),
  language: z.string().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional()
});

export const taskSchema = z.object({
  id: idSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  skill_domain: z.string(),
  base_difficulty: z.number().min(1).max(5),
  general_objective: z.string().nullable().optional(),
  tags: z.array(z.string()),
  language: z.string().default("en"),
  is_published: z.boolean(),
  parent_task_id: z.string().nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
  criteria: z.array(taskCriterionSchema).optional(),
  examples: z.array(taskExampleSchema).optional()
});

export const deliberatePracticeTaskV2Schema = z.object({
  version: z.literal("2.1"),
  task: z.object({
    title: z.string(),
    description: z.string(),
    skill_domain: z.string(),
    base_difficulty: z.number().min(1).max(5),
    general_objective: z.string().nullable().optional(),
    tags: z.array(z.string()),
    language: z.string().default("en")
  }),
  criteria: z.array(taskCriterionSchema),
  examples: z.array(taskExampleSchema)
});

export const llmParseSchema = z.object({
  version: z.literal("2.1"),
  task: z.object({
    title: z.string(),
    skill_domain: z.string(),
    base_difficulty: z.number().min(1).max(5),
    description: z.string(),
    general_objective: z.string().nullable(),
    tags: z.array(z.string()),
    language: z.string().default("en")
  }),
  criteria: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      rubric: rubricSchema.optional()
    })
  ),
  examples: z.array(
    z.object({
      id: z.string(),
      difficulty: z.number().min(1).max(5),
      severity_label: z.string().nullable(),
      patient_text: z.string(),
      language: z.string().optional(),
      meta: z.record(z.unknown()).nullable().optional()
    })
  )
});

export type LlmParseResult = z.infer<typeof llmParseSchema>;

export const evaluationResultSchema = z.object({
  version: z.literal("2.0"),
  task_id: z.string(),
  example_id: z.string(),
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
  criterion_scores: z.array(
    z.object({
      criterion_id: z.string(),
      score: z.number().min(0).max(4),
      rationale_short: z.string().max(800),
      evidence_quotes: z.array(z.string()).optional(),
      missed_points: z.array(z.string()).optional()
    })
  ),
  overall: z.object({
    score: z.number().min(0).max(4),
    pass: z.boolean(),
    summary_feedback: z.string().max(1500),
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
  session_item_id: z.string().optional(),
  task_id: z.string().optional(),
  example_id: z.string().optional(),
  attempt_id: z.string().optional(),
  audio: z.string(),
  audio_mime: z.string().optional(),
  mode: z.enum(["local_prefer", "openai_only", "local_only"]).optional(),
  practice_mode: z.enum(["standard", "real_time"]).optional(),
  turn_context: z
    .object({
      patient_cache_key: z.string().optional(),
      patient_statement_id: z.string().optional()
    })
    .optional()
});

export const practiceRunResponseSchema = z.object({
  requestId: z.string(),
  attemptId: z.string().optional(),
  next_recommended_difficulty: z.number().optional(),
  transcript: z
    .object({
      text: z.string(),
      provider: z.object({
        kind: z.enum(["local", "openai"]),
        model: z.string()
      }),
      duration_ms: z.number()
    })
    .optional(),
  scoring: z
    .object({
      evaluation: evaluationResultSchema,
      provider: z.object({
        kind: z.enum(["local", "openai"]),
        model: z.string()
      }),
      duration_ms: z.number()
    })
    .optional(),
  errors: z
    .array(
      z.object({
        stage: z.enum(["input", "stt", "scoring", "db"]),
        message: z.string()
      })
    )
    .optional(),
  debug: z
    .object({
      timings: z.record(z.number()),
      selectedProviders: z.object({
        stt: z.object({
          kind: z.enum(["local", "openai"]),
          model: z.string()
        }),
        llm: z
          .object({
            kind: z.enum(["local", "openai"]),
            model: z.string()
          })
          .nullable()
      })
    })
    .optional()
});
