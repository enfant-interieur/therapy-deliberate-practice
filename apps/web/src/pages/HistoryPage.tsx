import { useTranslation } from "react-i18next";
import { useGetAttemptsQuery } from "../store/api";

export const HistoryPage = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useGetAttemptsQuery({});

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <h2 className="text-2xl font-semibold">{t("history.title")}</h2>
        <p className="mt-2 text-sm text-slate-300">{t("history.subtitle")}</p>
      </section>
      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
        {isLoading && <p className="text-sm text-slate-400">{t("history.loading")}</p>}
        {!isLoading && (!data || data.length === 0) && (
          <p className="text-sm text-slate-400">{t("history.empty")}</p>
        )}
        <div className="space-y-4">
          {data?.map((attempt) => (
            <div
              key={attempt.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 p-4"
            >
              <div>
                <p className="text-sm font-semibold">
                  {t("history.exerciseLabel", { id: attempt.exercise_id })}
                </p>
                <p className="text-xs text-slate-400">
                  {t("history.completedLabel", { date: attempt.completed_at })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">
                  {t("history.scoreLabel", { score: attempt.overall_score.toFixed(1) })}
                </p>
                <p className={`text-xs ${attempt.overall_pass ? "text-emerald-300" : "text-rose-300"}`}>
                  {attempt.overall_pass ? t("history.statusPassed") : t("history.statusNeedsWork")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
