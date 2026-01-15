import { z } from "zod";

const idSchema = z.string().min(1);

const normalizeStringArray = (values: unknown) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizedStringArraySchema = z
  .array(z.string())
  .optional()
  .transform((value) => normalizeStringArray(value ?? []));

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
  meta: z
    .record(
      z.union([z.string(), z.number(), z.boolean(), z.null()])
    )
    .nullable()
    .optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional()
});

export const taskInteractionExampleSchema = z.object({
  id: idSchema,
  difficulty: z.number().min(1).max(5),
  title: z.string().nullable().optional(),
  patient_text: z.string(),
  therapist_text: z.string()
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
  authors: normalizedStringArraySchema,
  language: z.string().default("en"),
  is_published: z.boolean(),
  parent_task_id: z.string().nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
  criteria: z.array(taskCriterionSchema).optional(),
  examples: z.array(taskExampleSchema).optional(),
  interaction_examples: z.array(taskInteractionExampleSchema).optional()
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
  examples: z.array(taskExampleSchema),
  interaction_examples: z.array(taskInteractionExampleSchema).optional()
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
      meta: z.object({}).nullable().optional()
    })
  ),
  interaction_examples: z.array(taskInteractionExampleSchema)
});

export type LlmParseResult = z.infer<typeof llmParseSchema>;

export const evaluationResultSchema = z.object({
  version: z.literal("2.0"),
  task_id: z.string(),
  example_id: z.string(),
  attempt_id: z.string(),
  transcript: z.object({
    text: z.string(),
    confidence: z.number().nullable().optional(),
    words: z
      .array(
        z.object({
          w: z.string(),
          t0: z.number().nullable().optional(),
          t1: z.number().nullable().optional(),
          p: z.number().nullable().optional()
        })
      )
      .nullable()
      .optional()
  }),
  criterion_scores: z.array(
    z.object({
      criterion_id: z.string(),
      score: z.number().min(0).max(4),
      rationale_short: z.string().max(800),
      evidence_quotes: z.array(z.string()).nullable().optional(),
      missed_points: z.array(z.string()).nullable().optional()
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
      .nullable()
      .optional(),
    response_text: z.string().nullable().optional()
  }),
  diagnostics: z
    .object({
      provider: z.object({
        stt: z.object({
          kind: z.enum(["local", "openai"]),
          model: z.string().nullable().optional()
        }),
        llm: z.object({
          kind: z.enum(["local", "openai"]),
          model: z.string().nullable().optional()
        })
      }),
      timing_ms: z
        .object({
          stt: z.number().nullable().optional(),
          llm: z.number().nullable().optional(),
          total: z.number().nullable().optional()
        })
        .nullable()
        .optional()
    })
    .nullable()
    .optional()
});

const providerDescriptorSchema = z.object({
  kind: z.enum(["local", "openai"]),
  model: z.string()
});

const clientTranscriptSchema = z.object({
  text: z.string(),
  provider: providerDescriptorSchema,
  duration_ms: z.number().nonnegative()
});

const clientEvaluationSchema = z.object({
  evaluation: evaluationResultSchema,
  provider: providerDescriptorSchema,
  duration_ms: z.number().nonnegative()
});

export const practiceRunInputSchema = z
  .object({
    session_item_id: z.string().optional(),
    task_id: z.string().optional(),
    example_id: z.string().optional(),
    attempt_id: z.string().optional(),
    audio: z.string().optional(),
    audio_mime: z.string().optional(),
    transcript_text: z.string().optional(),
    client_transcript: clientTranscriptSchema.optional(),
    client_evaluation: clientEvaluationSchema.optional(),
    skip_scoring: z.boolean().optional(),
    mode: z.enum(["local_prefer", "openai_only", "local_only"]).optional(),
    practice_mode: z.enum(["standard", "real_time"]).optional(),
    turn_context: z
      .object({
        patient_cache_key: z.string().optional(),
        patient_statement_id: z.string().optional(),
        timing: z
          .object({
            response_delay_ms: z.number().nullable().optional(),
            response_duration_ms: z.number().nullable().optional(),
            response_timer_seconds: z.number().optional(),
            max_response_duration_seconds: z.number().optional()
          })
          .optional()
      })
      .optional()
  })
  .superRefine((data, ctx) => {
    if (!data.audio && !data.transcript_text && !data.client_transcript) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide audio, transcript_text, or client_transcript."
      });
    }
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
      duration_ms: z.number(),
      origin: z.enum(["local", "openai"])
    })
    .optional(),
  timing_penalty: z.number().optional(),
  adjusted_score: z.number().optional(),
  scoring: z
    .object({
      evaluation: evaluationResultSchema,
      provider: z.object({
        kind: z.enum(["local", "openai"]),
        model: z.string()
      }),
      duration_ms: z.number(),
      origin: z.enum(["local", "openai"])
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
