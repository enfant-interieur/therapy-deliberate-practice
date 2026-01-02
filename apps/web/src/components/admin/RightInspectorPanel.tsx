import type { Task, TaskCriterion, TaskExample } from "@deliberate/shared";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Divider, Textarea } from "./AdminUi";

export type EditableTask = Task & { criteria: TaskCriterion[]; examples: TaskExample[] };

type RightInspectorPanelProps = {
  task: EditableTask | null;
  activeTab: "preview" | "json" | "meta";
  onTabChange: (tab: "preview" | "json" | "meta") => void;
  jsonValue: string;
  jsonEditable: boolean;
  jsonError?: string | null;
  onJsonChange: (value: string) => void;
  onToggleEditable: (editable: boolean) => void;
  onApplyJson: () => void;
  onFormatJson: () => void;
  onValidateJson: () => void;
};

const sampleExample = (examples: TaskExample[]) => examples[0];

export const RightInspectorPanel = ({
  task,
  activeTab,
  onTabChange,
  jsonValue,
  jsonEditable,
  jsonError,
  onJsonChange,
  onToggleEditable,
  onApplyJson,
  onFormatJson,
  onValidateJson
}: RightInspectorPanelProps) => {
  const { t } = useTranslation();
  const example = useMemo(() => (task ? sampleExample(task.examples) : null), [task]);

  return (
    <Card className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
          {t("admin.inspector.kicker")}
        </p>
        <div className="flex rounded-full border border-white/10 bg-slate-950/50 p-1">
          {([
            ["preview", t("admin.inspector.preview")],
            ["json", t("admin.inspector.json")],
            ["meta", t("admin.inspector.meta")]
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === tab ? "bg-teal-500/20 text-teal-100" : "text-slate-400"
              }`}
              onClick={() => onTabChange(tab)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!task && (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
          {t("admin.inspector.empty")}
        </div>
      )}

      {task && activeTab === "preview" && (
        <div className="space-y-4 overflow-auto pr-1">
          <div>
            <h3 className="text-lg font-semibold text-white">{task.title}</h3>
            <p className="text-sm text-slate-400">{task.skill_domain}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge>{t("admin.editor.difficulty", { difficulty: task.base_difficulty })}</Badge>
              {task.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </div>
          <Divider />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("admin.sections.description")}
            </p>
            <p className="mt-2 text-sm text-slate-200">{task.description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("admin.sections.criteria")}
            </p>
            <ul className="mt-2 space-y-2 text-sm text-slate-200">
              {task.criteria.map((criterion) => (
                <li key={criterion.id}>
                  <span className="font-semibold text-white">{criterion.label}:</span>{" "}
                  {criterion.description}
                </li>
              ))}
            </ul>
          </div>
          {example && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t("admin.sections.examples")}
              </p>
              <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-200">
                <p className="text-xs text-slate-400">
                  {t("admin.content.examplePreview", { id: example.id })}
                </p>
                <p className="mt-2">{example.patient_text}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {task && activeTab === "json" && (
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{t("admin.inspector.jsonTitle")}</p>
              <p className="text-xs text-slate-400">{t("admin.inspector.jsonSubtitle")}</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={jsonEditable}
                onChange={(event) => onToggleEditable(event.target.checked)}
              />
              {t("admin.inspector.editable")}
            </label>
          </div>
          <Textarea
            className="min-h-[320px] font-mono text-xs"
            value={jsonValue}
            onChange={(event) => onJsonChange(event.target.value)}
            readOnly={!jsonEditable}
          />
          {jsonError && <p className="text-xs text-rose-300">{jsonError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={onFormatJson}>
              {t("admin.inspector.format")}
            </Button>
            <Button type="button" variant="secondary" onClick={onValidateJson}>
              {t("admin.inspector.validate")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(jsonValue)}
            >
              {t("admin.inspector.copyJson")}
            </Button>
            <Button type="button" variant="primary" onClick={onApplyJson}>
              {t("admin.inspector.apply")}
            </Button>
          </div>
        </div>
      )}

      {task && activeTab === "meta" && (
        <div className="flex flex-1 flex-col gap-4 overflow-auto pr-1">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">{t("admin.inspector.metaTitle")}</p>
            <div className="text-xs text-slate-400">
              <p>{t("admin.inspector.taskId")}: {task.id}</p>
              <p>{t("admin.inspector.slug")}: {task.slug}</p>
              <p>{t("admin.inspector.createdAt")}: {new Date(task.created_at).toLocaleString()}</p>
              <p>{t("admin.inspector.updatedAt")}: {new Date(task.updated_at).toLocaleString()}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(task.id)}
              >
                {t("admin.inspector.copyId")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigator.clipboard.writeText(jsonValue)}
              >
                {t("admin.inspector.copyJson")}
              </Button>
            </div>
          </div>
          <Divider />
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("admin.inspector.counts")}
            </p>
            <p className="text-sm text-slate-200">
              {t("admin.inspector.criteriaCount", { count: task.criteria.length })}
            </p>
            <div className="space-y-1 text-xs text-slate-400">
              {[1, 2, 3, 4, 5].map((difficulty) => (
                <p key={`difficulty-${difficulty}`}>
                  {t("admin.inspector.examplesByDifficulty", {
                    difficulty,
                    count: task.examples.filter((example) => example.difficulty === difficulty).length
                  })}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
