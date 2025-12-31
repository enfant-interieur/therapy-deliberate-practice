import { z } from "zod";

const idSchema = z.string().min(1);

export const objectiveSchema = z.object({
  id: idSchema,
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
  id: idSchema,
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
  is_published: z.boolean(),
  content: z
    .object({
      preparations: z.array(z.string()).optional(),
      expected_therapist_response: z.string().optional(),
      criteria: z.array(
        z.object({
          id: idSchema,
          label: z.string(),
          description: z.string(),
          objective_id: z.string().optional()
        })
      ),
      roleplay_sets: z.array(
        z.object({
          id: idSchema,
          label: z.string(),
          statements: z.array(
            z.object({
              id: idSchema,
              difficulty: z.enum(["beginner", "intermediate", "advanced"]),
              text: z.string(),
              criterion_ids: z.array(z.string()).optional(),
              cue_ids: z.array(z.string()).optional()
            })
          )
        })
      ),
      example_dialogues: z.array(
        z.object({
          id: idSchema,
          label: z.string(),
          turns: z.array(
            z.object({
              role: z.enum(["client", "therapist"]),
              text: z.string()
            })
          ),
          related_statement_id: z.string().optional()
        })
      ),
      patient_cues: z.array(
        z.object({
          id: idSchema,
          label: z.string(),
          text: z.string(),
          related_statement_ids: z.array(z.string()).optional()
        })
      ),
      practice_instructions: z.string().optional(),
      source: z
        .object({
          text: z.string().nullable().optional(),
          url: z.string().nullable().optional()
        })
        .optional()
    })
    .optional(),
  criteria: z
    .array(
      z.object({
        id: idSchema,
        label: z.string(),
        description: z.string(),
        objective_id: z.string().optional()
      })
    )
    .optional()
});

export const deliberatePracticeTaskV2Schema = z.object({
  version: z.literal("2.0"),
  task: z.object({
    name: z.string(),
    description: z.string(),
    skill_domain: z.string(),
    skill_difficulty_label: z.string().optional(),
    skill_difficulty_numeric: z.number().min(1).max(5),
    objectives: z.array(
      z.object({
        id: idSchema,
        label: z.string(),
        description: z.string()
      })
    ),
    tags: z.array(z.string())
  }),
  content: z.object({
    preparations: z.array(z.string()).optional(),
    expected_therapist_response: z.string().optional(),
    criteria: z.array(
      z.object({
        id: idSchema,
        label: z.string(),
        description: z.string(),
        objective_id: z.string().optional()
      })
    ),
    roleplay_sets: z.array(
      z.object({
        id: idSchema,
        label: z.string(),
        statements: z.array(
          z.object({
            id: idSchema,
            difficulty: z.enum(["beginner", "intermediate", "advanced"]),
            text: z.string(),
            criterion_ids: z.array(z.string()).optional(),
            cue_ids: z.array(z.string()).optional()
          })
        )
      })
    ),
    example_dialogues: z.array(
      z.object({
        id: idSchema,
        label: z.string(),
        turns: z.array(
          z.object({
            role: z.enum(["client", "therapist"]),
            text: z.string()
          })
        ),
        related_statement_id: z.string().optional()
      })
    ),
    patient_cues: z.array(
      z.object({
        id: idSchema,
        label: z.string(),
        text: z.string(),
        related_statement_ids: z.array(z.string()).optional()
      })
    ),
    practice_instructions: z.string().optional(),
    source: z
      .object({
        text: z.string().nullable().optional(),
        url: z.string().nullable().optional()
      })
      .optional()
  })
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

export const practiceRunResponseSchema = z.object({
  requestId: z.string(),
  attemptId: z.string().optional(),
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
