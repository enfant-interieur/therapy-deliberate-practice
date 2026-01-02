import { useMemo, useState } from "react";
import type { TaskExample } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Badge, Button, IconButton, Input, Label, Textarea } from "./AdminUi";

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 19V5m0 0l-6 6m6-6l6 6" strokeLinecap="round" />
  </svg>
);

const ArrowDown = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14m0 0l-6-6m6 6l6-6" strokeLinecap="round" />
  </svg>
);

const DuplicateIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 8h10v10H8z" />
    <path d="M6 16H4V4h12v2" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 7h16" strokeLinecap="round" />
    <path d="M9 7V5h6v2" strokeLinecap="round" />
    <path d="M8 7l1 12h6l1-12" strokeLinecap="round" />
  </svg>
);

const updateArrayItem = <T,>(items: T[], index: number, updater: (item: T) => T): T[] =>
  items.map((item, idx) => (idx === index ? updater(item) : item));

type ExampleErrors = {
  id?: string;
  difficulty?: string;
  patient_text?: string;
};

type ExamplesListEditorProps = {
  examples: TaskExample[];
  errors: Record<number, ExampleErrors>;
  onChange: (examples: TaskExample[]) => void;
};

export const ExamplesListEditor = ({ examples, errors, onChange }: ExamplesListEditorProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [difficultyFilter, setDifficultyFilter] = useState<number | "all">("all");

  const filtered = useMemo(() => {
    if (difficultyFilter === "all") return examples;
    return examples.filter((example) => example.difficulty === difficultyFilter);
  }, [difficultyFilter, examples]);

  const addExample = () => {
    const nextIndex = examples.length + 1;
    onChange([
      ...examples,
      {
        id: `ex${nextIndex}`,
        difficulty: 3,
        patient_text: "",
        severity_label: null
      }
    ]);
  };

  const duplicateExample = (index: number) => {
    const base = examples[index];
    const clone = { ...base, id: `${base.id || "ex"}${examples.length + 1}` };
    const next = [...examples];
    next.splice(index + 1, 0, clone);
    onChange(next);
  };

  const removeExample = (index: number) => {
    onChange(examples.filter((_, idx) => idx !== index));
  };

  const moveExample = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= examples.length) return;
    const next = [...examples];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.examples")}</h4>
          <p className="text-xs text-slate-400">{t("admin.content.examplesHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-2 py-1">
            <span className="px-2 text-[11px] font-semibold uppercase text-slate-400">
              {t("admin.content.filterDifficulty")}
            </span>
            {["all", 1, 2, 3, 4, 5].map((value) => (
              <button
                key={`filter-${value}`}
                type="button"
                className={`rounded-full px-2 py-1 text-xs font-semibold transition ${
                  difficultyFilter === value ? "bg-teal-400/20 text-teal-100" : "text-slate-300"
                }`}
                onClick={() => setDifficultyFilter(value as number | "all")}
              >
                {value === "all" ? t("admin.content.filterAll") : value}
              </button>
            ))}
          </div>
          <Button type="button" variant="secondary" onClick={addExample}>
            {t("admin.content.addExample")}
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        {filtered.map((example, filteredIndex) => {
          const index = examples.findIndex((item) => item.id === example.id);
          const exampleErrors = errors[index] || {};
          const isCollapsed = collapsed[example.id];
          return (
            <div
              key={`${example.id}-${index}`}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="text-left"
                    onClick={() =>
                      setCollapsed((prev) => ({ ...prev, [example.id]: !prev[example.id] }))
                    }
                  >
                    <p className="text-sm font-semibold text-white">{example.id}</p>
                    <p className="text-xs text-slate-400">
                      {t("admin.content.difficultyLabel", { difficulty: example.difficulty })}
                    </p>
                  </button>
                  {example.severity_label && <Badge>{example.severity_label}</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <IconButton
                    type="button"
                    label={t("admin.content.moveUp")}
                    icon={<ArrowUp />}
                    onClick={() => moveExample(index, "up")}
                    disabled={index === 0}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.moveDown")}
                    icon={<ArrowDown />}
                    onClick={() => moveExample(index, "down")}
                    disabled={index === examples.length - 1}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.duplicate")}
                    icon={<DuplicateIcon />}
                    onClick={() => duplicateExample(index)}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.remove")}
                    variant="danger"
                    icon={<TrashIcon />}
                    onClick={() => removeExample(index)}
                  />
                </div>
              </div>
              {!isCollapsed && (
                <div className="mt-4 grid gap-4 md:grid-cols-[140px_140px_1fr]">
                  <div className="space-y-2">
                    <Label>{t("admin.content.exampleId")}</Label>
                    <Input
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
                    {exampleErrors.id && (
                      <p className="text-xs text-rose-300">{exampleErrors.id}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.content.difficulty")}</Label>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((value) => (
                        <button
                          key={`diff-${example.id}-${value}`}
                          type="button"
                          className={`h-8 w-8 rounded-full text-xs font-semibold transition ${
                            example.difficulty === value
                              ? "bg-teal-400/30 text-teal-100"
                              : "border border-white/10 text-slate-300"
                          }`}
                          onClick={() =>
                            onChange(
                              updateArrayItem(examples, index, (item) => ({
                                ...item,
                                difficulty: value
                              }))
                            )
                          }
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    {exampleErrors.difficulty && (
                      <p className="text-xs text-rose-300">{exampleErrors.difficulty}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>{t("admin.content.severityLabel")}</Label>
                    <Input
                      value={example.severity_label ?? ""}
                      onChange={(event) =>
                        onChange(
                          updateArrayItem(examples, index, (item) => ({
                            ...item,
                            severity_label: event.target.value || null
                          }))
                        )
                      }
                      placeholder={t("admin.content.severityPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-3">
                    <Label>{t("admin.content.patientText")}</Label>
                    <Textarea
                      className="min-h-[140px]"
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
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      {exampleErrors.patient_text && (
                        <span className="text-rose-300">{exampleErrors.patient_text}</span>
                      )}
                      <span>{example.patient_text.length} {t("admin.content.characters")}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!examples.length && (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
            {t("admin.content.emptyExamples")}
          </div>
        )}
      </div>
    </div>
  );
};
