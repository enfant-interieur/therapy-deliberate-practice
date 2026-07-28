import type { TaskCriterion } from "@deliberate/shared";
import { useTranslation } from "react-i18next";

type RoundTaskCardProps = {
  title?: string;
  criteria: TaskCriterion[];
  visibilityMode: "normal" | "hard" | "extreme";
};

const visibilityTranslationKeys: Record<
  RoundTaskCardProps["visibilityMode"],
  string
> = {
  normal: "minigameUi.visibility.normal.title",
  hard: "minigameUi.visibility.hard.title",
  extreme: "minigameUi.visibility.extreme.title",
};

export const RoundTaskCard = ({
  title,
  criteria,
  visibilityMode,
}: RoundTaskCardProps) => {
  const { t } = useTranslation();
  if (visibilityMode === "extreme") return null;

  const hasCriteria = criteria.length > 0;
  const visibilityLabel = t(visibilityTranslationKeys[visibilityMode]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
            {t("minigameUi.taskBrief")}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-white">
            {title ?? t("practice.loadingExercise")}
          </h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-200/80">
          {visibilityLabel}
        </span>
      </div>
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
          {t("minigameUi.criteria")}
        </p>
        {hasCriteria ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {criteria.map((criterion) => (
              <div
                key={criterion.id}
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-3"
              >
                <p className="text-sm font-semibold text-white">
                  {criterion.label}
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  {criterion.description}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-300">
            {t("minigameUi.criteriaPending")}
          </p>
        )}
      </div>
    </div>
  );
};
