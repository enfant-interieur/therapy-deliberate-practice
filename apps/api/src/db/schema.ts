import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  created_at: integer("created_at").notNull()
});

export const exercises = sqliteTable("exercises", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  skill_domain: text("skill_domain").notNull(),
  difficulty: integer("difficulty").notNull(),
  patient_profile: text("patient_profile", { mode: "json" }).notNull(),
  example_prompt: text("example_prompt").notNull(),
  example_good_response: text("example_good_response"),
  objectives: text("objectives", { mode: "json" }).notNull(),
  grading: text("grading", { mode: "json" }).notNull(),
  tags: text("tags", { mode: "json" }).notNull(),
  is_published: integer("is_published", { mode: "boolean" }).notNull(),
  content: text("content", { mode: "json" }).notNull().default({}),
  source_text: text("source_text"),
  source_url: text("source_url"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull()
});

export const attempts = sqliteTable("attempts", {
  id: text("id").primaryKey(),
  user_id: text("user_id").notNull(),
  exercise_id: text("exercise_id").notNull(),
  started_at: integer("started_at").notNull(),
  completed_at: integer("completed_at"),
  audio_ref: text("audio_ref"),
  transcript: text("transcript").notNull(),
  evaluation: text("evaluation", { mode: "json" }).notNull(),
  overall_pass: integer("overall_pass", { mode: "boolean" }).notNull(),
  overall_score: real("overall_score").notNull(),
  model_info: text("model_info", { mode: "json" })
});
