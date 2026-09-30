import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useGetAttemptsQuery } from "../store/api";

export const HistoryPage = () => {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, isError, refetch } = useGetAttemptsQuery(
    {},
  );

  return (
    <div className="space-y-8">
      <section className="studio-hero">
        <h2 className="studio-heading text-4xl sm:text-5xl">
          {t("history.title")}
        </h2>
        <p className="mt-2 text-sm text-slate-300">{t("history.subtitle")}</p>
      </section>
      {!isLoading && !isError && data && data.length > 0 && (
        <section
          className="grid gap-3 sm:grid-cols-3"
          aria-label={t("studio.progress.label")}
        >
          <div className="studio-metric">
            <strong>{data.length}</strong>
            <span>{t("studio.progress.attempts")}</span>
          </div>
          <div className="studio-metric">
            <strong>
              {new Set(data.map((attempt) => attempt.task_id)).size}
            </strong>
            <span>{t("studio.progress.skills")}</span>
          </div>
          <div className="studio-metric">
            <strong>
              {data.filter((attempt) => attempt.overall_pass).length}
            </strong>
            <span>{t("studio.progress.passed")}</span>
          </div>
        </section>
      )}
      <p className="studio-guidance">{t("studio.progress.guidance")}</p>
      <section className="studio-card p-5 sm:p-6">
        {isLoading && (
          <p className="text-sm text-slate-400">{t("history.loading")}</p>
        )}
        {!isLoading && isError && (
          <div
            className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4"
            role="alert"
          >
            <p className="text-sm font-semibold text-rose-100">
              {t("history.error")}
            </p>
            <button
              type="button"
              className="mt-3 rounded-full border border-rose-200/40 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:cursor-wait disabled:opacity-60"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? t("history.retrying") : t("history.retry")}
            </button>
          </div>
        )}
        {!isLoading && !isError && (!data || data.length === 0) && (
          <p className="text-sm text-slate-400">{t("history.empty")}</p>
        )}
        <div className="space-y-4">
          {data?.map((attempt) => (
            <div
              key={attempt.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-white/10 p-5"
            >
              <div className="space-y-2">
                <div>
                  <p className="text-sm font-semibold">{attempt.task_title}</p>
                  <p className="text-xs text-slate-400">
                    {t("history.completedLabel", {
                      date: attempt.completed_at,
                    })}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t("history.exampleDifficulty", {
                      difficulty: attempt.example_difficulty,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/tasks/${attempt.task_id}`}
                    className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
                  >
                    {t("history.viewTask")}
                  </Link>
                  {attempt.session_id && (
                    <Link
                      to={`/practice/${attempt.task_id}?session=${attempt.session_id}`}
                      className="rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-white/30 hover:text-white"
                    >
                      {t("history.viewSession")}
                    </Link>
                  )}
                </div>
              </div>
              <div className="text-right">
                {attempt.score_trust === "local_unverified" ? (
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                    {t("history.localUnverified")}
                  </p>
                ) : null}
                <p className="text-sm font-semibold">
                  {t("history.scoreLabel", {
                    score: attempt.overall_score.toFixed(1),
                  })}
                </p>
                <p
                  className={`text-xs ${attempt.overall_pass ? "text-emerald-300" : "text-rose-300"}`}
                >
                  {attempt.overall_pass
                    ? t("history.statusPassed")
                    : t("history.statusNeedsWork")}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
