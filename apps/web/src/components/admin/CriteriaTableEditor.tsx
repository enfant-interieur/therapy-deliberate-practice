import type { TaskCriterion } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Button, IconButton, Input } from "./AdminUi";

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

type RowErrors = {
  id?: string;
  label?: string;
  description?: string;
};

type CriteriaTableEditorProps = {
  criteria: TaskCriterion[];
  errors: Record<number, RowErrors>;
  onChange: (criteria: TaskCriterion[]) => void;
};

const updateArrayItem = <T,>(items: T[], index: number, updater: (item: T) => T): T[] =>
  items.map((item, idx) => (idx === index ? updater(item) : item));

export const CriteriaTableEditor = ({ criteria, errors, onChange }: CriteriaTableEditorProps) => {
  const { t } = useTranslation();

  const addCriterion = () => {
    const nextIndex = criteria.length + 1;
    onChange([...criteria, { id: `c${nextIndex}`, label: "", description: "" }]);
  };

  const duplicateCriterion = (index: number) => {
    const base = criteria[index];
    const cloned = {
      ...base,
      id: `${base.id || "c"}${criteria.length + 1}`
    };
    const next = [...criteria];
    next.splice(index + 1, 0, cloned);
    onChange(next);
  };

  const moveCriterion = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= criteria.length) return;
    const next = [...criteria];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  const removeCriterion = (index: number) => {
    onChange(criteria.filter((_, idx) => idx !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-teal-200">
            {t("admin.content.criteria")}
          </h4>
          <p className="text-xs text-slate-400">{t("admin.content.criteriaHint")}</p>
        </div>
        <Button type="button" variant="secondary" onClick={addCriterion}>
          {t("admin.content.addCriterion")}
        </Button>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-950/40">
        <div className="grid grid-cols-[120px_1fr_2fr_140px] gap-3 border-b border-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <span>{t("admin.content.criterionId")}</span>
          <span>{t("admin.content.label")}</span>
          <span>{t("admin.content.description")}</span>
          <span className="text-right">{t("admin.content.actions")}</span>
        </div>
        <div className="divide-y divide-white/5">
          {criteria.map((criterion, index) => {
            const rowErrors = errors[index] || {};
            return (
              <div
                key={`${criterion.id}-${index}`}
                className="grid grid-cols-[120px_1fr_2fr_140px] gap-3 px-4 py-3"
              >
                <div className="space-y-1">
                  <Input
                    aria-label={t("admin.content.criterionId")}
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
                  {rowErrors.id && <p className="text-xs text-rose-300">{rowErrors.id}</p>}
                </div>
                <div className="space-y-1">
                  <Input
                    aria-label={t("admin.content.label")}
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
                  {rowErrors.label && (
                    <p className="text-xs text-rose-300">{rowErrors.label}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <Input
                    aria-label={t("admin.content.description")}
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
                  {rowErrors.description && (
                    <p className="text-xs text-rose-300">{rowErrors.description}</p>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
                  <IconButton
                    type="button"
                    label={t("admin.content.moveUp")}
                    icon={<ArrowUp />}
                    onClick={() => moveCriterion(index, "up")}
                    disabled={index === 0}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.moveDown")}
                    icon={<ArrowDown />}
                    onClick={() => moveCriterion(index, "down")}
                    disabled={index === criteria.length - 1}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.duplicate")}
                    icon={<DuplicateIcon />}
                    onClick={() => duplicateCriterion(index)}
                  />
                  <IconButton
                    type="button"
                    label={t("admin.content.remove")}
                    variant="danger"
                    icon={<TrashIcon />}
                    onClick={() => removeCriterion(index)}
                  />
                </div>
              </div>
            );
          })}
          {!criteria.length && (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              {t("admin.content.emptyCriteria")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
