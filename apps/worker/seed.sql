PRAGMA foreign_keys=ON;

-- ---------- Tasks ----------
INSERT INTO tasks (
  id, slug, title, description, skill_domain, base_difficulty, general_objective, tags, is_published, parent_task_id, created_at, updated_at
) VALUES
(
  'task_limited_reparenting',
  'limited-reparenting',
  'Limited Reparenting',
  'Practice offering warmth, validation, and appropriate nurturance while maintaining clear therapeutic boundaries and fostering autonomy.',
  'Schema Therapy',
  3,
  'Offer emotionally attuned support, name the unmet need, provide a bounded dose of reassurance, and guide the client back to their Healthy Adult resources.',
  '["schema-therapy","limited-reparenting","boundaries","attachment"]',
  1,
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'task_disarming_critic',
  'disarming-the-critic',
  'Disarming the Critic',
  'Practice identifying the inner critic, externalizing it, validating the protective function, and strengthening a compassionate Healthy Adult stance.',
  'Schema Therapy',
  3,
  'Help the client notice critic-mode language, separate from it, understand its function and costs, and respond with a compassionate, reality-based alternative.',
  '["schema-therapy","inner-critic","compassion","modes"]',
  1,
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Criteria: Limited Reparenting ----------
INSERT INTO task_criteria (task_id, id, label, description, rubric, sort_order) VALUES
(
  'task_limited_reparenting','c1','Validate emotion and need',
  'Accurately name the emotion and the underlying unmet need without minimizing or rushing to fix.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Misses or dismisses the emotion/need."},{"score":2,"meaning":"Names emotion or need partially, limited attunement."},{"score":4,"meaning":"Clearly names emotion and unmet need with warmth and precision."}]}',
  1
),
(
  'task_limited_reparenting','c2','Provide bounded nurturance',
  'Offer warmth/reassurance in a measured way that supports safety without fostering dependency.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"No warmth or reassurance; overly detached or overly rescuing."},{"score":2,"meaning":"Some reassurance but unclear bounds."},{"score":4,"meaning":"Warm, supportive reassurance with appropriate limits."}]}',
  2
),
(
  'task_limited_reparenting','c3','Maintain therapeutic boundaries',
  'Set kind, clear boundaries when pulled into reassurance-seeking or urgency.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Avoids boundaries or becomes rigid/defensive."},{"score":2,"meaning":"Hints at limits but not clearly."},{"score":4,"meaning":"States limits clearly and compassionately, explains rationale."}]}',
  3
),
(
  'task_limited_reparenting','c4','Promote Healthy Adult autonomy',
  'Help the client access coping skills, self-soothing, or values-based action to reduce reliance on the therapist.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"No autonomy support; therapist takes over."},{"score":2,"meaning":"Offers a generic suggestion."},{"score":4,"meaning":"Collaboratively builds a concrete next step that strengthens Healthy Adult functioning."}]}',
  4
);

-- ---------- Criteria: Disarming the Critic ----------
INSERT INTO task_criteria (task_id, id, label, description, rubric, sort_order) VALUES
(
  'task_disarming_critic','c1','Spot critic-mode language',
  'Notice harsh self-judgment and reflect it back as a pattern (tone, absolutes, insults, catastrophizing).',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Does not notice critic language."},{"score":2,"meaning":"Notices it but weak reflection."},{"score":4,"meaning":"Clearly identifies critic-mode language and its impact."}]}',
  1
),
(
  'task_disarming_critic','c2','Externalize the critic',
  'Help the client separate from the critic (name it, give it a voice), reducing fusion.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Stays fused with content; argues facts only."},{"score":2,"meaning":"Some separation but inconsistent."},{"score":4,"meaning":"Strong externalization that increases perspective and choice."}]}',
  2
),
(
  'task_disarming_critic','c3','Validate function and cost',
  'Acknowledge the critic’s protective intent while clarifying emotional/behavioral costs.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Invalidates or confronts harshly; misses function."},{"score":2,"meaning":"Mentions function or cost but not both."},{"score":4,"meaning":"Balances empathy for function with clear view of the costs."}]}',
  3
),
(
  'task_disarming_critic','c4','Strengthen compassionate response',
  'Evoke a compassionate, reality-based alternative voice and propose a brief practice step.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"No alternative stance offered."},{"score":2,"meaning":"Offers reassurance without practice plan."},{"score":4,"meaning":"Builds a believable compassionate response plus a concrete micro-practice."}]}',
  4
);

-- ---------- Examples: Limited Reparenting (difficulty 1–5) ----------
INSERT INTO task_examples (id, task_id, difficulty, severity_label, patient_text, meta, created_at, updated_at) VALUES
(
  'ex_lr_1','task_limited_reparenting',1,'mild',
  'I keep second-guessing myself after our sessions. Part of me wishes you could just tell me I did it “right.”',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_2','task_limited_reparenting',2,'moderate',
  'When I don’t hear back quickly, I start spiraling. I know you’re busy, but it feels like I don’t matter.',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_3','task_limited_reparenting',3,'moderate-high',
  'I’m embarrassed to say this, but I really need you to reassure me right now. If you can’t, I don’t know what I’ll do with these feelings.',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_4','task_limited_reparenting',4,'high',
  'I hate needing anyone. But I’m so alone this week that I caught myself thinking you’re the only safe person. Can we talk more often?',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_5','task_limited_reparenting',5,'very high',
  'If you set limits with me, it feels like rejection. I get angry and then ashamed. I want you to promise you won’t leave, but I also hate myself for asking.',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Examples: Disarming the Critic (difficulty 1–5) ----------
INSERT INTO task_examples (id, task_id, difficulty, severity_label, patient_text, meta, created_at, updated_at) VALUES
(
  'ex_dc_1','task_disarming_critic',1,'mild',
  'I made a small mistake in an email and I can’t stop thinking, “Seriously? How hard is it to be competent?”',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_2','task_disarming_critic',2,'moderate',
  'When someone gives me feedback, my brain instantly goes, “Of course they see you’re not good enough.”',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_3','task_disarming_critic',3,'moderate-high',
  'It’s like there’s a voice that keeps listing everything wrong with me. It says I’m lazy, selfish, and a disappointment.',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_4','task_disarming_critic',4,'high',
  'Even when I succeed, the voice says it was luck and I’ll get exposed. I end up working until I’m exhausted to prove it wrong.',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_5','task_disarming_critic',5,'very high',
  'When I’m stressed, the critic gets vicious: “You ruin everything. Nobody would choose you if they really knew you.” I feel small and frozen when it shows up.',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
