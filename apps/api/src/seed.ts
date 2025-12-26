import { nanoid } from "nanoid";
import { exercises } from "./db/schema";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

const demoObjectives = [
  {
    id: "reflect",
    label: "Reflect emotion",
    description: "Accurately reflect the client's emotional tone.",
    rubric: {
      score_min: 0,
      score_max: 4,
      anchors: [
        { score: 0, meaning: "Missed the emotion entirely." },
        { score: 2, meaning: "Partially reflected feelings." },
        { score: 4, meaning: "Captured the emotion with warmth." }
      ]
    }
  },
  {
    id: "validate",
    label: "Validate experience",
    description: "Normalize the client's reaction without fixing it.",
    rubric: {
      score_min: 0,
      score_max: 4,
      anchors: [
        { score: 0, meaning: "No validation." },
        { score: 2, meaning: "Some validation but unclear." },
        { score: 4, meaning: "Clear, affirming validation." }
      ]
    }
  }
];

const demoGrading = {
  pass_rule: { overall_min_score: 2.5, min_per_objective: 2 },
  scoring: { aggregation: "weighted_mean" }
};

export const seedExercises = async (
  db: BetterSQLite3Database | DrizzleD1Database
) => {
  const existing = await db.select().from(exercises).limit(1);
  if (existing.length > 0) return;

  await db.insert(exercises).values({
    id: nanoid(),
    slug: "anxiety-opening",
    title: "Opening with anxious client",
    description: "Practice empathetic opening statements when a client expresses anxiety.",
    skill_domain: "Empathy",
    difficulty: 2,
    patient_profile: { name: "Jordan", age: 29, presenting: "Work anxiety" },
    example_prompt: "I'm overwhelmed at work and can't sleep.",
    example_good_response: "It sounds exhausting to carry that weight every day.",
    objectives: demoObjectives,
    grading: demoGrading,
    tags: ["empathy", "anxiety", "opening"],
    is_published: true,
    created_at: Date.now(),
    updated_at: Date.now()
  });
};
