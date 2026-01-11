import { useMemo, useState } from "react";
import type { TaskInteractionExample } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Badge, Button, IconButton, Input, Label, Textarea } from "./AdminUi";

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 19V5m0 0l-6 6m6-6l6 6" strokeLinecap="round" />
  </svg>
);

const ArrowDown = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 5v14m0 0l-6-6m6 6l6-6" strokeLinecap="round" />
  </svg>
);

const DuplicateIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 8h10v10H8z" />
    <path d="M6 16H4V4h12v2" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 7h16" strokeLinecap="round" />
    <path d="M9 7V5h6v2" strokeLinecap="round" />
    <path d="M8 7l1 12h6l1-12" strokeLinecap="round" />
  </svg>
);

const updateArrayItem = <T,>(items: T[], index: number, updater: (item: T) => T): T[] =>
  items.map((item, idx) => (idx === index ? updater(item) : item));

type InteractionErrors = {
  id?: string;
  difficulty?: string;
  patient_text?: string;
  therapist_text?: string;
};

type InteractionExamplesEditorProps = {
  interactions: TaskInteractionExample[];
  errors: Record<number, InteractionErrors>;
  onChange: (examples: TaskInteractionExample[]) => void;
};

export const InteractionExamplesEditor = ({
  interactions,
  errors,
  onChange
}: InteractionExamplesEditorProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [difficultyFilter, setDifficultyFilter] = useState<number | "all">("all");

  const filtered = useMemo(() => {
    if (difficultyFilter === "all") return interactions;
    return interactions.filter((example) => example.difficulty === difficultyFilter);
  }, [difficultyFilter, interactions]);

  const averageDifficulty = useMemo(() => {
    if (!interactions.length) return 0;
    return interactions.reduce((sum, example) => sum + example.difficulty, 0) / interactions.length;
  }, [interactions]);

  const addInteraction = () => {
    const nextIndex = interactions.length + 1;
    onChange([
      ...interactions,
      {
        id: `ix${nextIndex}`,
        difficulty: 3,
        title: "",
        patient_text: "",
        therapist_text: ""
      }
    ]);
  };

  const duplicateInteraction = (index: number) => {
    const base = interactions[index];
    const clone = { ...base, id: `${base.id || "ix"}${interactions.length + 1}` };
    const next = [...interactions];
    next.splice(index + 1, 0, clone);
    onChange(next);
  };

  const removeInteraction = (index: number) => {
    onChange(interactions.filter((_, idx) => idx !== index));
  };

  const moveInteraction = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= interactions.length) return;
    const next = [...interactions];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-teal-200">{t("admin.content.interactions")}</h4>
          <p className="text-xs text-slate-400">{t("admin.content.interactionsHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-2 text-xs text-slate-300">
            <div className="flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                {t("admin.content.interactionStats")}
              </span>
              <span className="text-sm font-semibold text-white">
                {interactions.length} {t("admin.content.items")}
              </span>
              <span className="text-slate-500">•</span>
              <span>
                {t("admin.content.avgDifficulty", { value: averageDifficulty.toFixed(1) })}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-2 py-1">
            <span className="px-2 text-[11px] font-semibold uppercase text-slate-400">
              {t("admin.content.filterDifficulty")}
            </span>
            {["all", 1, 2, 3, 4, 5].map((value) => (
              <button
                key={`interaction-filter-${value}`}
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
          <Button type="button" variant="secondary" onClick={addInteraction}>
            {t("admin.content.addInteraction")}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {filtered.map((interaction) => {
          const index = interactions.findIndex((item) => item.id === interaction.id);
          const interactionErrors = errors[index] || {};
          const isCollapsed = collapsed[interaction.id];
          return (
            <div
              key={`${interaction.id}-${index}`}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950/80 via-slate-950/40 to-teal-950/30 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <button
                  type="button"
                  className="text-left"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [interaction.id]: !prev[interaction.id] }))
                  }
                >
                  <p className="text-sm font-semibold text-white">
                    {interaction.title?.trim() || interaction.id}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t("admin.content.difficultyLabel", { difficulty: interaction.difficulty })}
                  </p>
                </button>
                <div className="flex flex-wrap items-center gap-2">
                  {interaction.title && <Badge>{interaction.title}</Badge>}
                  <IconButton
                    type="button"
                    label={t("admin.content.moveUp")}
                    icon={<ArrowUp />}
                    onClick={() => moveInteraction(index, "up")}
                    disabled={index === 0}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.moveDown")}
                    icon={<ArrowDown />}
                    onClick={() => moveInteraction(index, "down")}
                    disabled={index === interactions.length - 1}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.duplicate")}
                    icon={<DuplicateIcon />}
                    onClick={() => duplicateInteraction(index)}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.remove")}
                    variant="danger"
                    icon={<TrashIcon />}
                    onClick={() => removeInteraction(index)}
                  />
                </div>
              </div>

              {!isCollapsed && (
                <div className="mt-4 grid gap-4 lg:grid-cols-[200px_1fr]">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>{t("admin.content.interactionId")}</Label>
                      <Input
                        value={interaction.id}
                        onChange={(event) =>
                          onChange(
                            updateArrayItem(interactions, index, (item) => ({
                              ...item,
                              id: event.target.value
                            }))
                          )
                        }
                      />
                      {interactionErrors.id && (
                        <p className="text-xs text-rose-300">{interactionErrors.id}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.content.interactionTitle")}</Label>
                      <Input
                        value={interaction.title ?? ""}
                        onChange={(event) =>
                          onChange(
                            updateArrayItem(interactions, index, (item) => ({
                              ...item,
                              title: event.target.value || null
                            }))
                          )
                        }
                        placeholder={t("admin.content.interactionTitlePlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.content.difficulty")}</Label>
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((value) => (
                          <button
                            key={`interaction-diff-${interaction.id}-${value}`}
                            type="button"
                            className={`h-8 w-8 rounded-full text-xs font-semibold transition ${
                              interaction.difficulty === value
                                ? "bg-teal-400/30 text-teal-100"
                                : "border border-white/10 text-slate-300"
                            }`}
                            onClick={() =>
                              onChange(
                                updateArrayItem(interactions, index, (item) => ({
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
                      {interactionErrors.difficulty && (
                        <p className="text-xs text-rose-300">{interactionErrors.difficulty}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t("admin.content.patientLine")}</Label>
                      <Textarea
                        className="min-h-[180px]"
                        value={interaction.patient_text}
                        onChange={(event) =>
                          onChange(
                            updateArrayItem(interactions, index, (item) => ({
                              ...item,
                              patient_text: event.target.value
                            }))
                          )
                        }
                        placeholder={t("admin.content.patientTextPlaceholder")}
                      />
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        {interactionErrors.patient_text && (
                          <span className="text-rose-300">{interactionErrors.patient_text}</span>
                        )}
                        <span>
                          {interaction.patient_text.length} {t("admin.content.characters")}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("admin.content.therapistLine")}</Label>
                      <Textarea
                        className="min-h-[180px]"
                        value={interaction.therapist_text}
                        onChange={(event) =>
                          onChange(
                            updateArrayItem(interactions, index, (item) => ({
                              ...item,
                              therapist_text: event.target.value
                            }))
                          )
                        }
                        placeholder={t("admin.content.therapistTextPlaceholder")}
                      />
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        {interactionErrors.therapist_text && (
                          <span className="text-rose-300">
                            {interactionErrors.therapist_text}
                          </span>
                        )}
                        <span>
                          {interaction.therapist_text.length} {t("admin.content.characters")}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!interactions.length && (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
            {t("admin.content.emptyInteractions")}
          </div>
        )}
      </div>
    </div>
  );
};
