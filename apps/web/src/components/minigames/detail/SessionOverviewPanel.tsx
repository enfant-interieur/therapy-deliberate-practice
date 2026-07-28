import type { MinigameSession } from "../../../store/api";
import { useTranslation } from "react-i18next";

const formatDate = (timestamp?: number | null) =>
  timestamp ? new Date(timestamp).toLocaleString() : "—";

type SessionOverviewPanelProps = {
  session: MinigameSession;
};

export const SessionOverviewPanel = ({
  session,
}: SessionOverviewPanelProps) => {
  const { t } = useTranslation();
  const isActive = !session.ended_at;
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">
            {t("minigameUi.sessionOverview")}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            {session.game_type === "tdm"
              ? t("minigameUi.teamDeathmatch")
              : t("minigameUi.freeForAll")}
          </h2>
        </div>
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
      <div className="mt-4 grid gap-4 text-sm text-slate-200 md:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.created")}
          </p>
          <p className="mt-1 text-sm text-white">
            {formatDate(session.created_at)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {t("minigameUi.ended")}
          </p>
          <p className="mt-1 text-sm text-white">
            {formatDate(session.ended_at)}
          </p>
        </div>
      </div>
    </section>
  );
};
