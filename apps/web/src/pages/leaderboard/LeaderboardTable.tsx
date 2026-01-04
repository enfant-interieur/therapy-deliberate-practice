import { useTranslation } from "react-i18next";
import type { LeaderboardEntry } from "../../store/api";
import { formatDateTime, formatRelativeTime, formatScore } from "../../utils/scoreFormatters";

type LeaderboardTableProps = {
  entries: LeaderboardEntry[];
  isLoading: boolean;
  locale: string;
};

const rankStyles = [
  "bg-gradient-to-br from-amber-300/30 via-amber-100/10 to-transparent text-amber-100 border-amber-200/60",
  "bg-gradient-to-br from-slate-200/30 via-white/10 to-transparent text-slate-100 border-slate-200/60",
  "bg-gradient-to-br from-orange-300/20 via-orange-100/10 to-transparent text-orange-100 border-orange-200/50"
];

export const LeaderboardTable = ({ entries, isLoading, locale }: LeaderboardTableProps) => {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <h2 className="text-lg font-semibold text-white">{t("leaderboard.loading")}</h2>
        <div className="mt-6 space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 px-4 py-3"
            >
              <div className="h-8 w-10 animate-pulse rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 animate-pulse rounded-full bg-white/10" />
                <div className="h-2 w-1/4 animate-pulse rounded-full bg-white/10" />
              </div>
              <div className="h-8 w-20 animate-pulse rounded-full bg-white/10" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-6 py-10 text-center">
          <p className="text-lg font-semibold text-white">{t("leaderboard.empty")}</p>
          <p className="mt-2 text-sm text-slate-400">{t("leaderboard.emptyHint")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.9)]">
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="grid grid-cols-[80px_1fr_120px_120px_160px] gap-2 border-b border-white/10 bg-white/5 px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
          <span>{t("leaderboard.table.rank")}</span>
          <span>{t("leaderboard.table.player")}</span>
          <span>{t("leaderboard.table.score")}</span>
          <span>{t("leaderboard.table.played")}</span>
          <span>{t("leaderboard.table.lastActive")}</span>
        </div>
        <div className="divide-y divide-white/5">
          {entries.map((entry, index) => {
            const rankClass = rankStyles[index] ?? "border-white/10 text-slate-200";
            const relative = formatRelativeTime(entry.last_active_at, locale);
            const absolute = formatDateTime(entry.last_active_at, locale);
            return (
              <div
                key={entry.user_id}
                className="grid grid-cols-[80px_1fr_120px_120px_160px] items-center gap-2 px-6 py-4 text-sm text-slate-200 transition hover:bg-white/5"
              >
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold ${rankClass}`}
                >
                  {index + 1}
                </div>
                <div>
                  <p className="font-semibold text-white">{entry.display_name}</p>
                  <p className="text-xs text-slate-500">{t("leaderboard.table.playerSubtext")}</p>
                </div>
                <div className="text-base font-semibold text-teal-200">
                  {formatScore(entry.score)}
                </div>
                <div className="text-slate-300">{entry.played}</div>
                <div className="text-slate-300" title={absolute}>
                  {relative}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
