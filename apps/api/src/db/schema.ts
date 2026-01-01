import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  created_at: integer("created_at").notNull()
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    skill_domain: text("skill_domain").notNull(),
    base_difficulty: integer("base_difficulty").notNull(),
    general_objective: text("general_objective"),
    tags: text("tags", { mode: "json" }).notNull(),
    is_published: integer("is_published", { mode: "boolean" }).notNull(),
    parent_task_id: text("parent_task_id"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    skillDomainIdx: index("tasks_skill_domain_idx").on(table.skill_domain),
    isPublishedIdx: index("tasks_is_published_idx").on(table.is_published),
    parentTaskIdx: index("tasks_parent_task_id_idx").on(table.parent_task_id)
  })
);

export const taskCriteria = sqliteTable(
  "task_criteria",
  {
    id: text("id").notNull(),
    task_id: text("task_id").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    rubric: text("rubric", { mode: "json" }),
    sort_order: integer("sort_order").notNull().default(0)
  },
  (table) => ({
    pk: uniqueIndex("task_criteria_pk").on(table.task_id, table.id)
  })
);

export const taskExamples = sqliteTable(
  "task_examples",
  {
    id: text("id").primaryKey(),
    task_id: text("task_id").notNull(),
    difficulty: integer("difficulty").notNull(),
    severity_label: text("severity_label"),
    patient_text: text("patient_text").notNull(),
    meta: text("meta", { mode: "json" }),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    taskIdx: index("task_examples_task_id_idx").on(table.task_id),
    taskDifficultyIdx: index("task_examples_task_id_difficulty_idx").on(
      table.task_id,
      table.difficulty
    )
  })
);

export const practiceSessions = sqliteTable(
  "practice_sessions",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    mode: text("mode").notNull(),
    source_task_id: text("source_task_id"),
    random_seed: text("random_seed"),
    created_at: integer("created_at").notNull(),
    ended_at: integer("ended_at")
  },
  (table) => ({
    userCreatedIdx: index("practice_sessions_user_id_created_at_idx").on(
      table.user_id,
      table.created_at
    )
  })
);

export const practiceSessionItems = sqliteTable(
  "practice_session_items",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id").notNull(),
    position: integer("position").notNull(),
    task_id: text("task_id").notNull(),
    example_id: text("example_id").notNull(),
    target_difficulty: integer("target_difficulty").notNull(),
    created_at: integer("created_at").notNull()
  },
  (table) => ({
    sessionPositionIdx: uniqueIndex("practice_session_items_session_position_idx").on(
      table.session_id,
      table.position
    ),
    sessionIdx: index("practice_session_items_session_id_idx").on(table.session_id),
    taskIdx: index("practice_session_items_task_id_idx").on(table.task_id),
    exampleIdx: index("practice_session_items_example_id_idx").on(table.example_id)
  })
);

export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    session_id: text("session_id"),
    session_item_id: text("session_item_id"),
    task_id: text("task_id").notNull(),
    example_id: text("example_id").notNull(),
    started_at: integer("started_at").notNull(),
    completed_at: integer("completed_at"),
    audio_ref: text("audio_ref"),
    transcript: text("transcript").notNull(),
    evaluation: text("evaluation", { mode: "json" }).notNull(),
    overall_pass: integer("overall_pass", { mode: "boolean" }).notNull(),
    overall_score: real("overall_score").notNull(),
    model_info: text("model_info", { mode: "json" })
  },
  (table) => ({
    userStartedIdx: index("attempts_user_id_started_at_idx").on(
      table.user_id,
      table.started_at
    ),
    taskStartedIdx: index("attempts_task_id_started_at_idx").on(
      table.task_id,
      table.started_at
    ),
    exampleStartedIdx: index("attempts_example_id_started_at_idx").on(
      table.example_id,
      table.started_at
    ),
    sessionStartedIdx: index("attempts_session_id_started_at_idx").on(
      table.session_id,
      table.started_at
    )
  })
);

export const userTaskProgress = sqliteTable(
  "user_task_progress",
  {
    user_id: text("user_id").notNull(),
    task_id: text("task_id").notNull(),
    current_difficulty: integer("current_difficulty").notNull().default(2),
    last_overall_score: real("last_overall_score"),
    last_pass: integer("last_pass", { mode: "boolean" }),
    streak: integer("streak").notNull().default(0),
    attempt_count: integer("attempt_count").notNull().default(0),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    pk: uniqueIndex("user_task_progress_pk").on(table.user_id, table.task_id),
    userUpdatedIdx: index("user_task_progress_user_id_updated_at_idx").on(
      table.user_id,
      table.updated_at
    )
  })
);

export const userSettings = sqliteTable("user_settings", {
  user_id: text("user_id").primaryKey(),
  ai_mode: text("ai_mode").notNull().default("local_prefer"),
  local_stt_url: text("local_stt_url"),
  local_llm_url: text("local_llm_url"),
  store_audio: integer("store_audio", { mode: "boolean" }).notNull().default(false),
  openai_key_ciphertext: text("openai_key_ciphertext"),
  openai_key_iv: text("openai_key_iv"),
  openai_key_kid: text("openai_key_kid"),
  updated_at: integer("updated_at").notNull(),
  created_at: integer("created_at").notNull()
});

export const ttsAssets = sqliteTable(
  "tts_assets",
  {
    id: text("id").primaryKey(),
    cache_key: text("cache_key").notNull(),
    text: text("text").notNull(),
    voice: text("voice").notNull(),
    model: text("model").notNull(),
    format: text("format").notNull(),
    r2_key: text("r2_key").notNull(),
    bytes: integer("bytes"),
    content_type: text("content_type").notNull(),
    etag: text("etag"),
    status: text("status").notNull(),
    error: text("error"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull()
  },
  (table) => ({
    cacheKeyIdx: uniqueIndex("tts_assets_cache_key_idx").on(table.cache_key)
  })
);
