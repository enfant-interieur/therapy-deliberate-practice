import type { Task, TaskCriterion, TaskExample } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Label, Select, Textarea } from "./AdminUi";
import { CriteriaTableEditor } from "./CriteriaTableEditor";
import { ExamplesListEditor } from "./ExamplesListEditor";

export type EditableTask = Task & { criteria: TaskCriterion[]; examples: TaskExample[] };

type ValidationErrors = {
  task?: Record<string, string>;
  criteria: Record<number, { id?: string; label?: string; description?: string }>;
  examples: Record<number, { id?: string; difficulty?: string; patient_text?: string }>;
};

type TaskEditorPanelProps = {
  task: EditableTask;
  onChange: (task: EditableTask) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  errors: ValidationErrors;
};

const sectionIds = [
  { id: "overview", label: "admin.sections.overview" },
  { id: "description", label: "admin.sections.description" },
  { id: "tags", label: "admin.sections.tags" },
  { id: "criteria", label: "admin.sections.criteria" },
  { id: "examples", label: "admin.sections.examples" }
];

export const TaskEditorPanel = ({ task, onChange, onDuplicate, onDelete, errors }: TaskEditorPanelProps) => {
  const { t } = useTranslation();

  const updateTask = (patch: Partial<EditableTask>) => onChange({ ...task, ...patch });
  const updateLanguage = (language: string) =>
    onChange({
      ...task,
      language,
      examples: task.examples.map((example) => ({
        ...example,
        language
      }))
    });

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
              {t("admin.editor.kicker")}
            </p>
            <h3 className="text-xl font-semibold text-white">{task.title || t("admin.editor.untitled")}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{task.skill_domain}</Badge>
              <Badge>{t("admin.editor.difficulty", { difficulty: task.base_difficulty })}</Badge>
              <Badge className={task.is_published ? "border-teal-400/40 text-teal-100" : "border-amber-400/40 text-amber-100"}>
                {task.is_published ? t("admin.editor.published") : t("admin.editor.draft")}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onDuplicate}>
              {t("admin.actions.duplicate")}
            </Button>
            <Button type="button" variant="danger" onClick={onDelete}>
              {t("admin.actions.delete")}
            </Button>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {sectionIds.map((section) => (
            <button
              key={section.id}
              type="button"
              className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 hover:border-white/30"
              onClick={() => scrollToSection(section.id)}
            >
              {t(section.label)}
            </button>
          ))}
        </div>
      </Card>

      <Card id="overview" className="p-6">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-teal-200">{t("admin.sections.overview")}</h4>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("admin.task.titleLabel")}</Label>
              <Input
                value={task.title}
                onChange={(event) => updateTask({ title: event.target.value })}
                placeholder={t("admin.task.titlePlaceholder")}
              />
              {errors.task?.title && <p className="text-xs text-rose-300">{errors.task.title}</p>}
            </div>
            <div className="space-y-2">
              <Label>{t("admin.task.skillDomainLabel")}</Label>
              <Input
                value={task.skill_domain}
                onChange={(event) => updateTask({ skill_domain: event.target.value })}
                placeholder={t("admin.task.skillDomainPlaceholder")}
              />
              {errors.task?.skill_domain && (
                <p className="text-xs text-rose-300">{errors.task.skill_domain}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("admin.task.difficultyLabel")}</Label>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={`diff-${value}`}
                    type="button"
                    className={`h-9 w-9 rounded-full text-xs font-semibold transition ${
                      task.base_difficulty === value
                        ? "bg-teal-400/30 text-teal-100"
                        : "border border-white/10 text-slate-300"
                    }`}
                    onClick={() => updateTask({ base_difficulty: value })}
                  >
                    {value}
                  </button>
                ))}
              </div>
              {errors.task?.base_difficulty && (
                <p className="text-xs text-rose-300">{errors.task.base_difficulty}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("appShell.language.label")}</Label>
              <Select
                value={task.language}
                onChange={(event) => updateLanguage(event.target.value)}
              >
                <option value="en">{t("appShell.language.english")}</option>
                <option value="fr">{t("appShell.language.french")}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("admin.task.publishLabel")}</Label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
                    task.is_published
                      ? "border-teal-400/40 bg-teal-500/10 text-teal-100"
                      : "border-white/10 text-slate-300"
                  }`}
                  onClick={() => updateTask({ is_published: true })}
                >
                  {t("admin.edit.publishLabel")}
                </button>
                <button
                  type="button"
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
                    !task.is_published
                      ? "border-amber-400/40 bg-amber-500/10 text-amber-100"
                      : "border-white/10 text-slate-300"
                  }`}
                  onClick={() => updateTask({ is_published: false })}
                >
                  {t("admin.editor.draft")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card id="description" className="p-6">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-teal-200">{t("admin.sections.description")}</h4>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>{t("admin.task.descriptionLabel")}</Label>
              <Textarea
                value={task.description}
                onChange={(event) => updateTask({ description: event.target.value })}
                placeholder={t("admin.task.descriptionPlaceholder")}
                className="min-h-[140px]"
              />
              {errors.task?.description && (
                <p className="text-xs text-rose-300">{errors.task.description}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("admin.task.generalObjectiveLabel")}</Label>
              <Textarea
                value={task.general_objective ?? ""}
                onChange={(event) => updateTask({ general_objective: event.target.value })}
                placeholder={t("admin.task.generalObjectivePlaceholder")}
                className="min-h-[120px]"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card id="tags" className="p-6">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-teal-200">{t("admin.sections.tags")}</h4>
          <div className="space-y-3">
            <Label>{t("admin.task.tagsLabel")}</Label>
            <Input
              value={task.tags.join(", ")}
              onChange={(event) =>
                updateTask({
                  tags: event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                })
              }
              placeholder={t("admin.task.tagsPlaceholder")}
            />
            {task.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {task.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card id="criteria" className="p-6">
        <CriteriaTableEditor
          criteria={task.criteria}
          errors={errors.criteria}
          onChange={(criteria) => updateTask({ criteria })}
        />
      </Card>

      <Card id="examples" className="p-6">
        <ExamplesListEditor
          examples={task.examples}
          errors={errors.examples}
          onChange={(examples) => updateTask({ examples })}
        />
      </Card>
    </div>
  );
};
