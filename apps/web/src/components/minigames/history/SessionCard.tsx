import type { MinigameSessionSummary } from "../../../store/api";
import { useTranslation } from "react-i18next";

const formatDate = (timestamp: number | null | undefined, locale: string) =>
  timestamp ? new Date(timestamp).toLocaleString(locale) : "—";

type SessionCardProps = {
  session: MinigameSessionSummary;
  onOpen: () => void;
  onDelete: () => void;
};

export const SessionCard = ({
  session,
  onOpen,
  onDelete,
}: SessionCardProps) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const isActive = !session.ended_at;
  const modeLabel = t(
    session.game_type === "tdm"
      ? "minigameUi.teamDeathmatch"
      : "minigameUi.freeForAll",
  );
  const progressLabel = t("minigameUi.sessionProgress", {
    completed: session.progress.completed,
    total: session.progress.total,
    count: session.progress.total,
  });
  const winnerLabel = session.winner?.label
    ? `${session.winner.label} · ${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(session.winner.score)}`
    : "—";

  return (
    <article className="w-full rounded-3xl border border-white/10 bg-slate-900/60 p-5 text-left shadow-[0_0_30px_rgba(15,23,42,0.4)] transition hover:border-white/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/70">
            {modeLabel}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] ${
              isActive
                ? "border-emerald-300/40 bg-emerald-500/20 text-emerald-100"
                : "border-slate-400/40 bg-slate-500/20 text-slate-200"
            }`}
          >
            {isActive ? t("minigameUi.active") : t("minigameUi.ended")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="rounded-full border border-rose-300/40 bg-rose-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-rose-100 hover:border-rose-200/70"
          >
            {t("minigameUi.delete")}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/80 hover:border-white/30 hover:text-white"
          >
            {isActive ? t("minigameUi.resume") : t("minigameUi.view")}
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 text-sm text-slate-200 md:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.created")}
          </p>
          <p className="mt-1 text-sm text-white">
            {formatDate(session.created_at, locale)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.ended")}
          </p>
          <p className="mt-1 text-sm text-white">
            {formatDate(session.ended_at, locale)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.progress")}
          </p>
          <p className="mt-1 text-sm text-white">{progressLabel}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.players")}
          </p>
          <p className="mt-1 text-sm text-white">{session.players_count}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.teams")}
          </p>
          <p className="mt-1 text-sm text-white">{session.teams_count}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.winner")}
          </p>
          <p className="mt-1 text-sm text-white">{winnerLabel}</p>
        </div>
      </div>
    </article>
  );
};
