import { useEffect, useMemo, useState } from "react";
import {
  useGetAdminTaskQuery,
  useGetAdminTasksQuery,
  useImportTaskMutation,
  useParseTaskMutation,
  useUpdateTaskMutation
} from "../store/api";
import type { DeliberatePracticeTaskV2, Task, TaskCriterion, TaskExample } from "@deliberate/shared";
import { deliberatePracticeTaskV2Schema } from "@deliberate/shared";
import { useTranslation } from "react-i18next";

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

type CriteriaEditorProps = {
  criteria: TaskCriterion[];
  onChange: (criteria: TaskCriterion[]) => void;
};

const CriteriaEditor = ({ criteria, onChange }: CriteriaEditorProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.criteria")}</h4>
      {criteria.map((criterion, index) => (
        <div key={criterion.id} className="grid gap-2 md:grid-cols-3">
          <input
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.criterionIdPlaceholder")}
            value={criterion.id}
            onChange={(event) =>
              onChange(
                updateArrayItem(criteria, index, (item) => ({
                  ...item,
                  id: event.target.value
                }))
              )
            }
          />
          <input
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.labelPlaceholder")}
            value={criterion.label}
            onChange={(event) =>
              onChange(
                updateArrayItem(criteria, index, (item) => ({
                  ...item,
                  label: event.target.value
                }))
              )
            }
          />
          <input
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.descriptionPlaceholder")}
            value={criterion.description}
            onChange={(event) =>
              onChange(
                updateArrayItem(criteria, index, (item) => ({
                  ...item,
                  description: event.target.value
                }))
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
        onClick={() =>
          onChange([
            ...criteria,
            { id: `c${criteria.length + 1}`, label: "", description: "" }
          ])
        }
      >
        {t("admin.content.addCriterion")}
      </button>
    </div>
  );
};

type ExamplesEditorProps = {
  examples: TaskExample[];
  onChange: (examples: TaskExample[]) => void;
};

const ExamplesEditor = ({ examples, onChange }: ExamplesEditorProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
      <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.examples")}</h4>
      {examples.map((example, index) => (
        <div key={example.id} className="grid gap-2 md:grid-cols-6">
          <input
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.exampleIdPlaceholder")}
            value={example.id}
            onChange={(event) =>
              onChange(
                updateArrayItem(examples, index, (item) => ({
                  ...item,
                  id: event.target.value
                }))
              )
            }
          />
          <input
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.difficultyPlaceholder")}
            type="number"
            min={1}
            max={5}
            value={example.difficulty}
            onChange={(event) =>
              onChange(
                updateArrayItem(examples, index, (item) => ({
                  ...item,
                  difficulty: Number(event.target.value)
                }))
              )
            }
          />
          <input
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.severityPlaceholder")}
            value={example.severity_label ?? ""}
            onChange={(event) =>
              onChange(
                updateArrayItem(examples, index, (item) => ({
                  ...item,
                  severity_label: event.target.value || null
                }))
              )
            }
          />
          <input
            className="md:col-span-3 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
            placeholder={t("admin.content.patientTextPlaceholder")}
            value={example.patient_text}
            onChange={(event) =>
              onChange(
                updateArrayItem(examples, index, (item) => ({
                  ...item,
                  patient_text: event.target.value
                }))
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200"
        onClick={() =>
          onChange([
            ...examples,
            {
              id: `ex${examples.length + 1}`,
              difficulty: 3,
              patient_text: "",
              severity_label: null
            }
          ])
        }
      >
        {t("admin.content.addExample")}
      </button>
    </div>
  );
};

const toEditableTask = (task: Task & { criteria?: TaskCriterion[]; examples?: TaskExample[] }) => ({
  ...task,
  general_objective: task.general_objective ?? "",
  criteria: task.criteria ?? [],
  examples: task.examples ?? []
});

export const AdminLibraryPage = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [freeText, setFreeText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [taskDraft, setTaskDraft] = useState<DeliberatePracticeTaskV2 | null>(null);
  const [taskJson, setTaskJson] = useState("");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [editableTask, setEditableTask] = useState<
    (Task & { criteria: TaskCriterion[]; examples: TaskExample[] }) | null
  >(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: tasks } = useGetAdminTasksQuery();
  const { data: selectedTask } = useGetAdminTaskQuery(selectedTaskId ?? "", {
    skip: !selectedTaskId
  });
  const [parseTask, parseState] = useParseTaskMutation();
  const [importTask, importState] = useImportTaskMutation();
  const [updateTask, updateState] = useUpdateTaskMutation();

  useEffect(() => {
    if (selectedTask) {
      setEditableTask(toEditableTask(selectedTask));
      setSaveError(null);
    }
  }, [selectedTask]);

  useEffect(() => {
    if (taskDraft) {
      setTaskJson(JSON.stringify(taskDraft, null, 2));
    }
  }, [taskDraft]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter((task) => task.title.toLowerCase().includes(search.toLowerCase()));
  }, [tasks, search]);

  const handleParse = async () => {
    setTaskError(null);
    try {
      const result = await parseTask({
        free_text: freeText || undefined,
        source_url: sourceUrl || undefined
      }).unwrap();
      setTaskDraft(result);
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
      await importTask({ task_v2: validated.data }).unwrap();
      setTaskError(null);
    } catch (error) {
      setTaskError((error as Error).message ?? t("admin.task.importFailed"));
    }
  };

  const handleSaveTask = async () => {
    if (!editableTask) return;
    try {
      await updateTask({ id: editableTask.id, task: editableTask }).unwrap();
      setSaveError(null);
    } catch (error) {
      setSaveError((error as Error).message ?? t("admin.edit.saveFailed"));
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
            <h3 className="text-sm font-semibold text-teal-200">{t("admin.tasksTitle")}</h3>
            {filteredTasks.map((task) => (
              <button
                type="button"
                key={task.id}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm ${
                  task.id === selectedTaskId
                    ? "bg-teal-500/20 text-white"
                    : "bg-slate-950/40 text-slate-200"
                }`}
                onClick={() => setSelectedTaskId(task.id)}
              >
                {task.title}
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
                    value={taskDraft.task.title}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: { ...taskDraft.task, title: event.target.value }
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
                    placeholder={t("admin.task.difficultyNumericPlaceholder")}
                    type="number"
                    min={1}
                    max={5}
                    value={taskDraft.task.base_difficulty}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: {
                          ...taskDraft.task,
                          base_difficulty: Number(event.target.value)
                        }
                      })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.generalObjectivePlaceholder")}
                    value={taskDraft.task.general_objective ?? ""}
                    onChange={(event) =>
                      setTaskDraft({
                        ...taskDraft,
                        task: {
                          ...taskDraft.task,
                          general_objective: event.target.value
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

                <CriteriaEditor
                  criteria={taskDraft.criteria}
                  onChange={(criteria) => setTaskDraft({ ...taskDraft, criteria })}
                />

                <ExamplesEditor
                  examples={taskDraft.examples}
                  onChange={(examples) => setTaskDraft({ ...taskDraft, examples })}
                />

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
            {editableTask ? (
              <div className="space-y-6">
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.titlePlaceholder")}
                    value={editableTask.title}
                    onChange={(event) =>
                      setEditableTask({ ...editableTask, title: event.target.value })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.skillDomainPlaceholder")}
                    value={editableTask.skill_domain}
                    onChange={(event) =>
                      setEditableTask({ ...editableTask, skill_domain: event.target.value })
                    }
                  />
                  <textarea
                    className="md:col-span-2 h-20 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-white"
                    placeholder={t("admin.task.descriptionPlaceholder")}
                    value={editableTask.description}
                    onChange={(event) =>
                      setEditableTask({ ...editableTask, description: event.target.value })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.difficultyNumericPlaceholder")}
                    type="number"
                    min={1}
                    max={5}
                    value={editableTask.base_difficulty}
                    onChange={(event) =>
                      setEditableTask({
                        ...editableTask,
                        base_difficulty: Number(event.target.value)
                      })
                    }
                  />
                  <input
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.generalObjectivePlaceholder")}
                    value={editableTask.general_objective ?? ""}
                    onChange={(event) =>
                      setEditableTask({
                        ...editableTask,
                        general_objective: event.target.value
                      })
                    }
                  />
                  <input
                    className="md:col-span-2 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
                    placeholder={t("admin.task.tagsPlaceholder")}
                    value={joinTags(editableTask.tags)}
                    onChange={(event) =>
                      setEditableTask({
                        ...editableTask,
                        tags: parseTags(event.target.value)
                      })
                    }
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={editableTask.is_published}
                      onChange={(event) =>
                        setEditableTask({
                          ...editableTask,
                          is_published: event.target.checked
                        })
                      }
                    />
                    {t("admin.edit.publishLabel")}
                  </label>
                </div>

                <CriteriaEditor
                  criteria={editableTask.criteria}
                  onChange={(criteria) => setEditableTask({ ...editableTask, criteria })}
                />

                <ExamplesEditor
                  examples={editableTask.examples}
                  onChange={(examples) => setEditableTask({ ...editableTask, examples })}
                />

                {saveError && <p className="text-sm text-rose-400">{saveError}</p>}
                <button
                  type="button"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
                  onClick={handleSaveTask}
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
