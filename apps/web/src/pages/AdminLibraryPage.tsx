import { useEffect, useMemo, useState } from "react";
import {
  useGetExercisesQuery,
  useGetExerciseQuery,
  useImportExerciseMutation,
  useParseExerciseMutation,
  useUpdateExerciseMutation
} from "../store/api";
import type { DeliberatePracticeTaskV2, Exercise, ExerciseContentV2 } from "@deliberate/shared";
import { deliberatePracticeTaskV2Schema, exerciseSchema } from "@deliberate/shared";
import { useTranslation } from "react-i18next";

const emptyContent = (): ExerciseContentV2 => ({
  criteria: [],
  roleplay_sets: [],
  example_dialogues: [],
  patient_cues: []
});

const updateArrayItem = <T,>(
  items: T[],
  index: number,
  updater: (item: T) => T
): T[] => items.map((item, idx) => (idx === index ? updater(item) : item));

const parseTags = (value: string) =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const joinTags = (tags: string[]) => tags.join(", ");

const autoLinkStatements = (content: ExerciseContentV2): ExerciseContentV2 => {
  const criteriaKeywords = content.criteria.map((criterion) => ({
    id: criterion.id,
    keywords: `${criterion.label} ${criterion.description}`
      .toLowerCase()
      .split(/\\W+/)
      .filter((word) => word.length > 3)
  }));
  const cueKeywords = content.patient_cues.map((cue) => ({
    id: cue.id,
    keywords: `${cue.label} ${cue.text}`
      .toLowerCase()
      .split(/\\W+/)
      .filter((word) => word.length > 3)
  }));

  const updatedSets = content.roleplay_sets.map((set) => ({
    ...set,
    statements: set.statements.map((statement) => {
      const text = statement.text.toLowerCase();
      const matchedCriteria = criteriaKeywords
        .filter((criterion) => criterion.keywords.some((word) => text.includes(word)))
        .map((criterion) => criterion.id);
      const matchedCues = cueKeywords
        .filter((cue) => cue.keywords.some((word) => text.includes(word)))
        .map((cue) => cue.id);
      return {
        ...statement,
        criterion_ids: matchedCriteria.length ? matchedCriteria : content.criteria.map((c) => c.id),
        cue_ids: matchedCues
      };
    })
  }));
  return { ...content, roleplay_sets: updatedSets };
};

type ContentEditorProps = {
  content: ExerciseContentV2;
  onChange: (content: ExerciseContentV2) => void;
};

const ContentEditor = ({ content, onChange }: ContentEditorProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.criteria")}</h4>
        {content.criteria.map((criterion, index) => (
          <div key={criterion.id} className="grid gap-2 md:grid-cols-2">
            <input
              className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              placeholder={t("admin.content.labelPlaceholder")}
              value={criterion.label}
              onChange={(event) =>
                onChange({
                  ...content,
                  criteria: updateArrayItem(content.criteria, index, (item) => ({
                    ...item,
                    label: event.target.value
                  }))
                })
              }
            />
            <input
              className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              placeholder={t("admin.content.descriptionPlaceholder")}
              value={criterion.description}
              onChange={(event) =>
                onChange({
                  ...content,
                  criteria: updateArrayItem(content.criteria, index, (item) => ({
                    ...item,
                    description: event.target.value
                  }))
                })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
          onClick={() =>
            onChange({
              ...content,
              criteria: [
                ...content.criteria,
                { id: `criterion-${content.criteria.length + 1}`, label: "", description: "" }
              ]
            })
          }
        >
          {t("admin.content.addCriterion")}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.roleplaySets")}</h4>
        {content.roleplay_sets.map((set, setIndex) => (
          <div key={set.id} className="space-y-3 rounded-xl border border-white/10 p-3">
            <input
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              placeholder={t("admin.content.setLabelPlaceholder")}
              value={set.label}
              onChange={(event) =>
                onChange({
                  ...content,
                  roleplay_sets: updateArrayItem(content.roleplay_sets, setIndex, (item) => ({
                    ...item,
                    label: event.target.value
                  }))
                })
              }
            />
            <div className="space-y-2">
              {set.statements.map((statement, statementIndex) => (
                <div key={statement.id} className="grid gap-2 md:grid-cols-4">
                  <select
                    className="rounded-xl border border-white/10 bg-slate-950/60 px-2 py-2 text-sm text-white"
                    value={statement.difficulty}
                    onChange={(event) =>
                      onChange({
                        ...content,
                        roleplay_sets: updateArrayItem(content.roleplay_sets, setIndex, (item) => ({
                          ...item,
                          statements: updateArrayItem(item.statements, statementIndex, (entry) => ({
                            ...entry,
                            difficulty: event.target.value as ExerciseContentV2["roleplay_sets"][number]["statements"][number]["difficulty"]
                          }))
                        }))
                      })
                    }
                  >
                    <option value="beginner">{t("admin.content.difficulty.beginner")}</option>
                    <option value="intermediate">{t("admin.content.difficulty.intermediate")}</option>
                    <option value="advanced">{t("admin.content.difficulty.advanced")}</option>
                  </select>
                  <input
                    className="md:col-span-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                    placeholder={t("admin.content.clientStatementPlaceholder")}
                    value={statement.text}
                    onChange={(event) =>
                      onChange({
                        ...content,
                        roleplay_sets: updateArrayItem(content.roleplay_sets, setIndex, (item) => ({
                          ...item,
                          statements: updateArrayItem(item.statements, statementIndex, (entry) => ({
                            ...entry,
                            text: event.target.value
                          }))
                        }))
                      })
                    }
                  />
                  <input
                    className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
                    placeholder={t("admin.content.criterionIdsPlaceholder")}
                    value={(statement.criterion_ids ?? []).join(", ")}
                    onChange={(event) =>
                      onChange({
                        ...content,
                        roleplay_sets: updateArrayItem(content.roleplay_sets, setIndex, (item) => ({
                          ...item,
                          statements: updateArrayItem(item.statements, statementIndex, (entry) => ({
                            ...entry,
                            criterion_ids: parseTags(event.target.value)
                          }))
                        }))
                      })
                    }
                  />
                  <input
                    className="md:col-span-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
                    placeholder={t("admin.content.cueIdsPlaceholder")}
                    value={(statement.cue_ids ?? []).join(", ")}
                    onChange={(event) =>
                      onChange({
                        ...content,
                        roleplay_sets: updateArrayItem(content.roleplay_sets, setIndex, (item) => ({
                          ...item,
                          statements: updateArrayItem(item.statements, statementIndex, (entry) => ({
                            ...entry,
                            cue_ids: parseTags(event.target.value)
                          }))
                        }))
                      })
                    }
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
              onClick={() =>
                onChange({
                  ...content,
                  roleplay_sets: updateArrayItem(content.roleplay_sets, setIndex, (item) => ({
                    ...item,
                    statements: [
                      ...item.statements,
                      {
                        id: `statement-${item.statements.length + 1}`,
                        difficulty: "beginner",
                        text: ""
                      }
                    ]
                  }))
                })
              }
            >
              {t("admin.content.addStatement")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
          onClick={() =>
            onChange({
              ...content,
              roleplay_sets: [
                ...content.roleplay_sets,
                { id: `set-${content.roleplay_sets.length + 1}`, label: "", statements: [] }
              ]
            })
          }
        >
          {t("admin.content.addRoleplaySet")}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.exampleDialogues")}</h4>
        {content.example_dialogues.map((dialogue, index) => (
          <div key={dialogue.id} className="space-y-2 rounded-xl border border-white/10 p-3">
            <input
              className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              placeholder={t("admin.content.dialogueLabelPlaceholder")}
              value={dialogue.label}
              onChange={(event) =>
                onChange({
                  ...content,
                  example_dialogues: updateArrayItem(content.example_dialogues, index, (item) => ({
                    ...item,
                    label: event.target.value
                  }))
                })
              }
            />
            {dialogue.turns.map((turn, turnIndex) => (
              <div key={`${dialogue.id}-${turnIndex}`} className="grid gap-2 md:grid-cols-4">
                <select
                  className="rounded-xl border border-white/10 bg-slate-950/60 px-2 py-2 text-sm text-white"
                  value={turn.role}
                  onChange={(event) =>
                    onChange({
                      ...content,
                      example_dialogues: updateArrayItem(content.example_dialogues, index, (item) => ({
                        ...item,
                        turns: updateArrayItem(item.turns, turnIndex, (entry) => ({
                          ...entry,
                          role: event.target.value as ExerciseContentV2["example_dialogues"][number]["turns"][number]["role"]
                        }))
                      }))
                    })
                  }
                >
                  <option value="client">{t("admin.content.role.client")}</option>
                  <option value="therapist">{t("admin.content.role.therapist")}</option>
                </select>
                <input
                  className="md:col-span-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                  placeholder={t("admin.content.turnPlaceholder")}
                  value={turn.text}
                  onChange={(event) =>
                    onChange({
                      ...content,
                      example_dialogues: updateArrayItem(content.example_dialogues, index, (item) => ({
                        ...item,
                        turns: updateArrayItem(item.turns, turnIndex, (entry) => ({
                          ...entry,
                          text: event.target.value
                        }))
                      }))
                    })
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
              onClick={() =>
                onChange({
                  ...content,
                  example_dialogues: updateArrayItem(content.example_dialogues, index, (item) => ({
                    ...item,
                    turns: [...item.turns, { role: "client", text: "" }]
                  }))
                })
              }
            >
              {t("admin.content.addTurn")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
          onClick={() =>
            onChange({
              ...content,
              example_dialogues: [
                ...content.example_dialogues,
                { id: `dialogue-${content.example_dialogues.length + 1}`, label: "", turns: [] }
              ]
            })
          }
        >
          {t("admin.content.addDialogue")}
        </button>
      </div>

      <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
        <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.patientCues")}</h4>
        {content.patient_cues.map((cue, index) => (
          <div key={cue.id} className="grid gap-2 md:grid-cols-3">
            <input
              className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              placeholder={t("admin.content.cueLabelPlaceholder")}
              value={cue.label}
              onChange={(event) =>
                onChange({
                  ...content,
                  patient_cues: updateArrayItem(content.patient_cues, index, (item) => ({
                    ...item,
                    label: event.target.value
                  }))
                })
              }
            />
            <input
              className="md:col-span-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
              placeholder={t("admin.content.cueTextPlaceholder")}
              value={cue.text}
              onChange={(event) =>
                onChange({
                  ...content,
                  patient_cues: updateArrayItem(content.patient_cues, index, (item) => ({
                    ...item,
                    text: event.target.value
                  }))
                })
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
          onClick={() =>
            onChange({
              ...content,
              patient_cues: [
                ...content.patient_cues,
                { id: `cue-${content.patient_cues.length + 1}`, label: "", text: "" }
              ]
            })
          }
        >
          {t("admin.content.addCue")}
        </button>
      </div>
    </div>
  );
};

export const AdminLibraryPage = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [taskDraft, setTaskDraft] = useState<DeliberatePracticeTaskV2 | null>(null);
  const [taskJson, setTaskJson] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [exerciseDraft, setExerciseDraft] = useState<Exercise | null>(null);
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  const { data: exercises } = useGetExercisesQuery({ q: search });
  const { data: selectedExercise } = useGetExerciseQuery(selectedExerciseId ?? "", {
    skip: !selectedExerciseId
  });
  const [parseExercise, parseState] = useParseExerciseMutation();
  const [importExercise, importState] = useImportExerciseMutation();
  const [updateExercise, updateState] = useUpdateExerciseMutation();

  useEffect(() => {
    if (selectedExercise) {
      setExerciseDraft(selectedExercise);
      setExerciseError(null);
    }
  }, [selectedExercise]);

  useEffect(() => {
    if (taskDraft) {
      setTaskJson(JSON.stringify(taskDraft, null, 2));
    }
  }, [taskDraft]);

  const filteredExercises = useMemo(() => {
    if (!exercises) return [];
    return exercises.filter((exercise) =>
      exercise.title.toLowerCase().includes(search.toLowerCase())
    );
  }, [exercises, search]);

  const handleParse = async () => {
    setTaskError(null);
    try {
      const result = await parseExercise({
        free_text: freeText || undefined,
        source_url: sourceUrl || undefined
      }).unwrap();
      const enriched: DeliberatePracticeTaskV2 = {
        ...result,
        content: {
          ...result.content,
          source: { text: freeText || null, url: sourceUrl || null }
        }
      };
      setTaskDraft(enriched);
    } catch (error) {
      setTaskError((error as Error).message ?? t("admin.createFromText.errorFallback"));
    }
  };

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(taskJson);
      const validated = deliberatePracticeTaskV2Schema.parse(parsed);
      setTaskDraft(validated);
      setTaskError(null);
    } catch (error) {
      setTaskError((error as Error).message ?? t("admin.task.invalidJson"));
    }
  };

  const handleImport = async () => {
    if (!taskDraft) return;
    const validated = deliberatePracticeTaskV2Schema.safeParse(taskDraft);
    if (!validated.success) {
      setTaskError(validated.error.message);
      return;
    }
    try {
      await importExercise({ task_v2: validated.data }).unwrap();
      setTaskError(null);
    } catch (error) {
      setTaskError((error as Error).message ?? t("admin.task.importFailed"));
    }
  };

  const handleRegenerateCues = async () => {
    if (!taskDraft) return;
    const text =
      taskDraft.content.source?.text ??
      taskDraft.content.roleplay_sets
        .flatMap((set) => set.statements.map((statement) => statement.text))
        .join("\\n");
    try {
      const result = await parseExercise({ free_text: text }).unwrap();
      setTaskDraft({ ...taskDraft, content: { ...taskDraft.content, patient_cues: result.content.patient_cues } });
    } catch (error) {
      setTaskError((error as Error).message ?? t("admin.task.regenerateFailed"));
    }
  };

  const handleAutoLink = () => {
    if (!taskDraft) return;
    setTaskDraft({ ...taskDraft, content: autoLinkStatements(taskDraft.content) });
  };

  const handleSaveExercise = async () => {
    if (!exerciseDraft) return;
    const content = exerciseDraft.content ?? emptyContent();
    const exerciseToSave: Exercise = {
      ...exerciseDraft,
      content,
      criteria: content.criteria,
      tags: exerciseDraft.tags ?? [],
      example_good_response: exerciseDraft.example_good_response ?? null
    };
    const validated = exerciseSchema.safeParse(exerciseToSave);
    if (!validated.success) {
      setExerciseError(validated.error.message);
      return;
    }
    try {
      await updateExercise({ id: exerciseDraft.id, exercise: validated.data }).unwrap();
      setExerciseError(null);
    } catch (error) {
      setExerciseError((error as Error).message ?? t("admin.edit.saveFailed"));
    }
  };

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <h2 className="text-2xl font-semibold">{t("admin.title")}</h2>
        <p className="text-sm text-slate-300">{t("admin.subtitle")}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-4">
          <input
            className="w-full rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
            placeholder={t("admin.searchPlaceholder")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <h3 className="text-sm font-semibold text-teal-200">{t("admin.exercisesTitle")}</h3>
            {filteredExercises.map((exercise) => (
              <button
                type="button"
                key={exercise.id}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  exercise.id === selectedExerciseId
                    ? "bg-teal-500/20 text-white"
                    : "bg-slate-950/40 text-slate-200"
                }`}
                onClick={() => setSelectedExerciseId(exercise.id)}
              >
                {exercise.title}
              </button>
            ))}
          </div>
        </aside>

        <div className="space-y-8">
          <section className="space-y-6 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <div>
              <h3 className="text-lg font-semibold">{t("admin.createFromText.title")}</h3>
              <p className="text-sm text-slate-400">{t("admin.createFromText.subtitle")}</p>
            </div>
            <textarea
              className="h-32 w-full rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-white"
              placeholder={t("admin.createFromText.placeholderText")}
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
            />
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
              placeholder={t("admin.createFromText.placeholderUrl")}
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
            />
            <button
              type="button"
              className="rounded-full bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950"
              onClick={handleParse}
              disabled={parseState.isLoading}
            >
              {parseState.isLoading ? t("admin.createFromText.parsing") : t("admin.createFromText.parse")}
            </button>
            {taskError && <p className="text-sm text-rose-400">{taskError}</p>}

            {taskDraft && (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.titlePlaceholder")}
                    value={taskDraft.task.name}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: { ...taskDraft.task, name: event.target.value }
                      })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.skillDomainPlaceholder")}
                    value={taskDraft.task.skill_domain}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: { ...taskDraft.task, skill_domain: event.target.value }
                      })
                    }
                  />
                  <input
                    className="md:col-span-2 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.descriptionPlaceholder")}
                    value={taskDraft.task.description}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: { ...taskDraft.task, description: event.target.value }
                      })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.difficultyLabelPlaceholder")}
                    value={taskDraft.task.skill_difficulty_label ?? ""}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: { ...taskDraft.task, skill_difficulty_label: event.target.value }
                      })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.difficultyNumericPlaceholder")}
                    type="number"
                    min={1}
                    max={5}
                    value={taskDraft.task.skill_difficulty_numeric}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: {
                          ...taskDraft.task,
                          skill_difficulty_numeric: Number(event.target.value)
                        }
                      })
                    }
                  />
                  <input
                    className="md:col-span-2 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.tagsPlaceholder")}
                    value={joinTags(taskDraft.task.tags)}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: { ...taskDraft.task, tags: parseTags(event.target.value) }
                      })
                    }
                  />
                </div>

                <ContentEditor
                  content={taskDraft.content}
                  onChange={(updated) => setTaskDraft({ ...taskDraft, content: updated })}
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-4 py-2 text-xs text-white"
                    onClick={handleRegenerateCues}
                  >
                    {t("admin.task.regenerateCues")}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-4 py-2 text-xs text-white"
                    onClick={handleAutoLink}
                  >
                    {t("admin.task.autoLink")}
                  </button>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-teal-200">{t("admin.task.rawJson")}</h4>
                  <textarea
                    className="h-48 w-full rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-white"
                    value={taskJson}
                    onChange={(event) => setTaskJson(event.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-full border border-white/10 px-4 py-2 text-xs text-white"
                    onClick={handleApplyJson}
                  >
                    {t("admin.task.applyJson")}
                  </button>
                </div>

                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={handleImport}
                  disabled={importState.isLoading}
                >
                  {importState.isLoading ? t("admin.task.importing") : t("admin.task.import")}
                </button>
              </div>
            )}
          </section>

          <section className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <div>
              <h3 className="text-lg font-semibold">{t("admin.edit.title")}</h3>
              <p className="text-sm text-slate-400">{t("admin.edit.subtitle")}</p>
            </div>
            {exerciseDraft ? (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.titlePlaceholder")}
                    value={exerciseDraft.title}
                    onChange={(event) =>
                      setExerciseDraft({ ...exerciseDraft, title: event.target.value })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.skillDomainPlaceholder")}
                    value={exerciseDraft.skill_domain}
                    onChange={(event) =>
                      setExerciseDraft({ ...exerciseDraft, skill_domain: event.target.value })
                    }
                  />
                  <textarea
                    className="md:col-span-2 h-20 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-white"
                    placeholder={t("admin.task.descriptionPlaceholder")}
                    value={exerciseDraft.description}
                    onChange={(event) =>
                      setExerciseDraft({ ...exerciseDraft, description: event.target.value })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.tagsPlaceholder")}
                    value={joinTags(exerciseDraft.tags)}
                    onChange={(event) =>
                      setExerciseDraft({ ...exerciseDraft, tags: parseTags(event.target.value) })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={exerciseDraft.is_published}
                      onChange={(event) =>
                        setExerciseDraft({ ...exerciseDraft, is_published: event.target.checked })
                      }
                    />
                    {t("admin.edit.publishLabel")}
                  </label>
                </div>

                <ContentEditor
                  content={exerciseDraft.content ?? emptyContent()}
                  onChange={(updated) =>
                    setExerciseDraft({
                      ...exerciseDraft,
                      content: updated,
                      criteria: updated.criteria
                    })
                  }
                />

                {exerciseError && <p className="text-sm text-rose-400">{exerciseError}</p>}
                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={handleSaveExercise}
                  disabled={updateState.isLoading}
                >
                  {updateState.isLoading ? t("admin.edit.saving") : t("admin.edit.save")}
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-400">{t("admin.edit.selectPrompt")}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
