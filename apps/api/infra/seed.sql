PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
-- ============================================================
-- Reset (delete only) for tasks + related collections (en + fr)
-- Safe to run even if rows do not exist.
-- ============================================================

-- ---------- Delete children first ----------
DELETE FROM task_examples
WHERE task_id IN (
  'task_limited_reparenting',
  'task_disarming_critic',
  'task_limited_reparenting_fr',
  'task_disarming_critic_fr'
);

DELETE FROM task_interaction_examples
WHERE task_id IN (
  'task_limited_reparenting',
  'task_disarming_critic',
  'task_limited_reparenting_fr',
  'task_disarming_critic_fr'
);

DELETE FROM task_criteria
WHERE task_id IN (
  'task_limited_reparenting',
  'task_disarming_critic',
  'task_limited_reparenting_fr',
  'task_disarming_critic_fr'
);

-- ---------- Delete tasks (delete fr children before en parents) ----------
DELETE FROM tasks
WHERE id IN (
  'task_limited_reparenting_fr',
  'task_disarming_critic_fr'
);

DELETE FROM tasks
WHERE id IN (
  'task_limited_reparenting',
  'task_disarming_critic'
);

-- ============================================================
-- Seed tasks + related collections (en + fr)
-- ============================================================

INSERT INTO tasks (
  id, slug, title, description, skill_domain, base_difficulty, general_objective, tags, language, is_published, parent_task_id, created_at, updated_at
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
  'en',
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
  'en',
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
INSERT INTO task_examples (id, task_id, difficulty, severity_label, patient_text, language, meta, created_at, updated_at) VALUES
(
  'ex_lr_1','task_limited_reparenting',1,'mild',
  'I keep second-guessing myself after our sessions. Part of me wishes you could just tell me I did it “right.”',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_2','task_limited_reparenting',2,'moderate',
  'When I don’t hear back quickly, I start spiraling. I know you’re busy, but it feels like I don’t matter.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_3','task_limited_reparenting',3,'moderate-high',
  'I’m embarrassed to say this, but I really need you to reassure me right now. If you can’t, I don’t know what I’ll do with these feelings.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_4','task_limited_reparenting',4,'high',
  'I hate needing anyone. But I’m so alone this week that I caught myself thinking you’re the only safe person. Can we talk more often?',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_5','task_limited_reparenting',5,'very high',
  'If you set limits with me, it feels like rejection. I get angry and then ashamed. I want you to promise you won’t leave, but I also hate myself for asking.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Examples: Disarming the Critic (difficulty 1–5) ----------
INSERT INTO task_examples (id, task_id, difficulty, severity_label, patient_text, language, meta, created_at, updated_at) VALUES
(
  'ex_dc_1','task_disarming_critic',1,'mild',
  'I made a small mistake in an email and I can’t stop thinking, “Seriously? How hard is it to be competent?”',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_2','task_disarming_critic',2,'moderate',
  'When someone gives me feedback, my brain instantly goes, “Of course they see you’re not good enough.”',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_3','task_disarming_critic',3,'moderate-high',
  'It’s like there’s a voice that keeps listing everything wrong with me. It says I’m lazy, selfish, and a disappointment.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_4','task_disarming_critic',4,'high',
  'Even when I succeed, the voice says it was luck and I’ll get exposed. I end up working until I’m exhausted to prove it wrong.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_5','task_disarming_critic',5,'very high',
  'When I’m stressed, the critic gets vicious: “You ruin everything. Nobody would choose you if they really knew you.” I feel small and frozen when it shows up.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Interaction Examples: Limited Reparenting ----------
INSERT INTO task_interaction_examples (id, task_id, difficulty, title, patient_text, therapist_text, language, meta, created_at, updated_at) VALUES
(
  'ix_lr_1','task_limited_reparenting',2,'Warmth with limits',
  'I keep checking my phone hoping you’ll respond. Can you just tell me I’m not too much?',
  'I hear how scared and exposed that feels, and it makes sense you’re wanting reassurance. I care about you, and I also want us to build your own steadying skills so you’re not alone between sessions. I can’t provide constant contact, but I can help you practice a kinder inner voice. Right now, can we name the younger part’s need and take one slow breath together? Then let’s choose one small, nurturing action you can do today to support your Healthy Adult.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ix_lr_2','task_limited_reparenting',3,'Bounded reassurance',
  'If I mess up this week, I need you to promise you won’t get tired of me.',
  'It sounds like a vulnerable part of you is afraid of being rejected, and I want you to know I’m here with you in that fear. I also can’t make promises about always being available or never feeling tired—that wouldn’t be honest or helpful. What I can promise is that we will keep working on this together and that I’ll be consistent with our sessions. Let’s notice how that part shows up and practice a compassionate response you can give yourself when the fear spikes.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ix_lr_3','task_limited_reparenting',4,'Promote autonomy',
  'Can we add another session? I don’t feel safe otherwise.',
  'I can hear how unsafe this feels right now, and I’m glad you told me. I want to respond with care and also keep our structure steady, so we can’t add another session this week. Let’s make a plan for support between sessions: we can identify the hardest time of day, practice a grounding routine, and choose one person or resource you can reach out to. We’ll check in next time about how it went and adjust together.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Interaction Examples: Disarming the Critic ----------
INSERT INTO task_interaction_examples (id, task_id, difficulty, title, patient_text, therapist_text, language, meta, created_at, updated_at) VALUES
(
  'ix_dc_1','task_disarming_critic',2,'Name the critic',
  'I missed one deadline and now I’m telling myself I’m a total failure.',
  'Notice how quickly that harsh, all-or-nothing voice jumped in—calling you a “total failure.” That sounds like your inner critic, not a balanced view of the situation. The critic is trying to push you with shame, but it ends up crushing you. What would a more compassionate, realistic voice say? Maybe: “I missed a deadline, and I can repair it and learn from it.” Let’s try speaking that back and see how it feels in your body.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ix_dc_2','task_disarming_critic',3,'Protective function',
  'The voice keeps saying, “If you’re not perfect, you’re worthless.”',
  'That voice is really intense. I wonder if it’s trying to protect you from rejection by pushing you to be perfect. The problem is it leaves you feeling ashamed and stuck. Can we separate from it for a moment—maybe call it the “Drill Sergeant”? Then let’s have your Healthy Adult respond: “I want to do well, and I’m still worthy even when I’m imperfect.” We can practice that response when the Drill Sergeant shows up this week.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ix_dc_3','task_disarming_critic',4,'Compassionate reply',
  'It keeps calling me lazy, and then I shut down completely.',
  'When the critic calls you “lazy,” it’s using an attack that makes you collapse rather than move forward. That’s a sign the critic is in charge. Let’s name it and step back: “That’s the critic talking.” Then we can offer a compassionate, reality-based alternative: “I’m overwhelmed, and I can take one small step.” What would be one tiny, doable action today? We can practice responding this way and notice if it changes the shut-down.',
  'en',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- =====================================================================================
-- ================================== FRENCH (fr) ======================================
-- =====================================================================================

-- ---------- Tasks (fr) ----------
INSERT INTO tasks (
  id, slug, title, description, skill_domain, base_difficulty, general_objective, tags, language, is_published, parent_task_id, created_at, updated_at
) VALUES
(
  'task_limited_reparenting_fr',
  'limited-reparenting-fr',
  'Reparentage limité',
  'S’entraîner à offrir chaleur, validation et un soutien nourrissant adapté, tout en maintenant des limites thérapeutiques claires et en favorisant l’autonomie.',
  'Schema Therapy',
  3,
  'Offrir un soutien émotionnel accordé, nommer le besoin non satisfait, proposer une dose de réassurance cadrée, puis aider la personne à mobiliser ses ressources d’Adulte sain.',
  '["schema-therapy","limited-reparenting","boundaries","attachment"]',
  'fr',
  1,
  'task_limited_reparenting',
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'task_disarming_critic_fr',
  'disarming-the-critic-fr',
  'Désarmer le critique',
  'S’entraîner à identifier le critique intérieur, à l’externaliser, à valider sa fonction protectrice et à renforcer une posture d’Adulte sain compatissante.',
  'Schema Therapy',
  3,
  'Aider la personne à repérer le langage en mode Critique, à s’en désidentifier, à comprendre sa fonction et ses coûts, puis à répondre par une alternative compatissante et ancrée dans la réalité.',
  '["schema-therapy","inner-critic","compassion","modes"]',
  'fr',
  1,
  'task_disarming_critic',
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Criteria: Reparentage limité (fr) ----------
INSERT INTO task_criteria (task_id, id, label, description, rubric, sort_order) VALUES
(
  'task_limited_reparenting_fr','c1','Valider l’émotion et le besoin',
  'Nommer avec justesse l’émotion et le besoin sous-jacent non satisfait, sans minimiser ni se précipiter pour « réparer ».',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Ne repère pas l’émotion/le besoin ou les invalide."},{"score":2,"meaning":"Identifie partiellement l’émotion ou le besoin ; accordage limité."},{"score":4,"meaning":"Nomme clairement l’émotion et le besoin non satisfait avec chaleur et précision."}]}',
  1
),
(
  'task_limited_reparenting_fr','c2','Offrir une réassurance cadrée',
  'Proposer chaleur et réassurance de façon mesurée, soutenant la sécurité sans renforcer la dépendance.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Peu ou pas de chaleur/réassurance ; posture trop détachée ou trop sauveuse."},{"score":2,"meaning":"Réassurance présente mais cadre/limites peu clairs."},{"score":4,"meaning":"Réassurance chaleureuse et soutenante, avec des limites appropriées."}]}',
  2
),
(
  'task_limited_reparenting_fr','c3','Maintenir les limites thérapeutiques',
  'Poser des limites bienveillantes et claires lorsque la demande de réassurance ou l’urgence tire la relation.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Évite les limites ou devient rigide/défensif."},{"score":2,"meaning":"Évoque des limites mais sans clarté."},{"score":4,"meaning":"Énonce des limites clairement et avec compassion, en expliquant le sens/le rationnel."}]}',
  3
),
(
  'task_limited_reparenting_fr','c4','Soutenir l’autonomie de l’Adulte sain',
  'Aider la personne à accéder à des compétences d’adaptation, d’auto-apaisement ou à une action guidée par les valeurs afin de réduire la dépendance au thérapeute.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Pas de soutien à l’autonomie ; le thérapeute prend le relais."},{"score":2,"meaning":"Propose une suggestion générique."},{"score":4,"meaning":"Construit en collaboration une étape concrète qui renforce le fonctionnement de l’Adulte sain."}]}',
  4
);

-- ---------- Criteria: Désarmer le critique (fr) ----------
INSERT INTO task_criteria (task_id, id, label, description, rubric, sort_order) VALUES
(
  'task_disarming_critic_fr','c1','Repérer le langage en mode Critique',
  'Repérer l’auto-jugement dur et le refléter comme un schéma (ton, absolus, insultes, catastrophisation).',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Ne repère pas le langage du Critique."},{"score":2,"meaning":"Le repère mais le reflet est faible."},{"score":4,"meaning":"Identifie clairement le langage en mode Critique et son impact."}]}',
  1
),
(
  'task_disarming_critic_fr','c2','Externaliser le Critique',
  'Aider la personne à se séparer du Critique (le nommer, lui donner une voix), en réduisant la fusion.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Reste fusionné au contenu ; argumente uniquement sur les faits."},{"score":2,"meaning":"Séparation partielle mais inconstante."},{"score":4,"meaning":"Externalisation solide qui augmente la prise de perspective et la liberté de choix."}]}',
  2
),
(
  'task_disarming_critic_fr','c3','Valider la fonction et le coût',
  'Reconnaître l’intention protectrice du Critique tout en clarifiant ses coûts émotionnels et comportementaux.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Invalide ou confronte durement ; ne repère pas la fonction."},{"score":2,"meaning":"Évoque la fonction ou le coût, mais pas les deux."},{"score":4,"meaning":"Équilibre empathie pour la fonction et vision claire des coûts."}]}',
  3
),
(
  'task_disarming_critic_fr','c4','Renforcer une réponse compatissante',
  'Évoquer une voix alternative compatissante et ancrée dans la réalité, et proposer un bref pas de pratique.',
  '{"score_min":0,"score_max":4,"anchors":[{"score":0,"meaning":"Aucune posture alternative n’est proposée."},{"score":2,"meaning":"Propose de la réassurance sans plan de pratique."},{"score":4,"meaning":"Construit une réponse compatissante crédible et une micro-pratique concrète."}]}',
  4
);

-- ---------- Examples: Reparentage limité (fr) (difficulty 1–5) ----------
INSERT INTO task_examples (id, task_id, difficulty, severity_label, patient_text, language, meta, created_at, updated_at) VALUES
(
  'ex_lr_1_fr','task_limited_reparenting_fr',1,'léger',
  'Après nos séances, je me remets tout le temps en question. Une partie de moi aimerait que vous me disiez simplement que je l’ai fait « comme il faut ».',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_2_fr','task_limited_reparenting_fr',2,'modéré',
  'Quand je n’ai pas de réponse rapidement, je pars en vrille. Je sais que vous êtes occupé·e, mais j’ai l’impression de ne pas compter.',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_3_fr','task_limited_reparenting_fr',3,'modéré-élevé',
  'J’ai honte de le dire, mais j’ai vraiment besoin que vous me rassuriez maintenant. Si vous ne pouvez pas, je ne sais pas quoi faire de ces émotions.',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_4_fr','task_limited_reparenting_fr',4,'élevé',
  'Je déteste avoir besoin de quelqu’un. Mais cette semaine je suis tellement seul·e que je me surprends à penser que vous êtes la seule personne vraiment sûre. Est-ce qu’on peut se parler plus souvent ?',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_lr_5_fr','task_limited_reparenting_fr',5,'très élevé',
  'Quand vous posez des limites, je le vis comme un rejet. Je me mets en colère puis j’ai honte. Je veux que vous me promettiez que vous ne partirez pas, mais je me déteste aussi de le demander.',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

-- ---------- Examples: Désarmer le critique (fr) (difficulty 1–5) ----------
INSERT INTO task_examples (id, task_id, difficulty, severity_label, patient_text, language, meta, created_at, updated_at) VALUES
(
  'ex_dc_1_fr','task_disarming_critic_fr',1,'léger',
  'J’ai fait une petite erreur dans un e-mail et je n’arrête pas de penser : « Sérieusement ? C’est si difficile d’être compétent·e ? »',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_2_fr','task_disarming_critic_fr',2,'modéré',
  'Quand quelqu’un me fait un retour, mon cerveau part direct : « Évidemment qu’ils voient que tu n’es pas à la hauteur. »',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_3_fr','task_disarming_critic_fr',3,'modéré-élevé',
  'C’est comme s’il y avait une voix qui énumère tout ce qui ne va pas chez moi. Elle dit que je suis paresseux·se, égoïste et une déception.',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_4_fr','task_disarming_critic_fr',4,'élevé',
  'Même quand je réussis, la voix dit que c’était de la chance et que je vais être démasqué·e. Je finis par travailler jusqu’à l’épuisement pour lui prouver le contraire.',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
),
(
  'ex_dc_5_fr','task_disarming_critic_fr',5,'très élevé',
  'Quand je suis stressé·e, le critique devient vicieux : « Tu gâches tout. Personne ne te choisirait s’ils te connaissaient vraiment. » Je me sens petit·e et figé·e quand ça arrive.',
  'fr',
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
