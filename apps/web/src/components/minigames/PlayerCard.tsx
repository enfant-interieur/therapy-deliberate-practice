import { teamColorMap } from "./LeaderboardPanel";
import type { MinigamePlayer, MinigameTeam } from "../../store/api";
import { useTranslation } from "react-i18next";

const avatarIconMap: Record<string, string> = {
  astro: "🚀",
  nova: "🌟",
  ember: "🔥",
  pulse: "💓",
  lumen: "💡",
  halo: "🪩",
};

type PlayerCardProps = {
  player: MinigamePlayer;
  team?: MinigameTeam | null;
  score: number;
  remainingRounds: number;
  isActive: boolean;
  isUpNext: boolean;
  canSwitch: boolean;
  onClick?: () => void;
};

export const PlayerCard = ({
  player,
  team,
  score,
  remainingRounds,
  isActive,
  isUpNext,
  canSwitch,
  onClick,
}: PlayerCardProps) => {
  const { t } = useTranslation();
  const statusLabel = isActive
    ? t("minigameUi.playerTurn")
    : isUpNext
      ? t("minigameUi.upNext")
      : remainingRounds === 0
        ? t("minigameUi.done")
        : t("minigameUi.queued");
  const statusTone = isActive
    ? "border-teal-300/60 bg-teal-500/20 text-teal-100"
    : isUpNext
      ? "border-sky-300/50 bg-sky-500/15 text-sky-100"
      : "border-white/10 bg-white/5 text-white/70";
  const cardTone = isActive
    ? "border-teal-400/50 bg-slate-900/80 shadow-[0_0_30px_rgba(45,212,191,0.25)]"
    : "border-white/10 bg-slate-950/50";
  const interactionTone =
    onClick && canSwitch && !isActive
      ? "hover:border-white/40 hover:-translate-y-0.5"
      : "cursor-not-allowed opacity-60";

  const avatarIcon = avatarIconMap[player.avatar] ?? "👤";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || !canSwitch || isActive}
      aria-label={`${player.name}, ${statusLabel}, ${t("minigameUi.roundsRemaining", { count: remainingRounds })}, ${t("minigameUi.score")} ${score.toFixed(1)}`}
      title={
        !canSwitch && !isActive
          ? t("minigameUi.switchBlocked")
          : isActive
            ? t("minigameUi.currentTurn")
            : undefined
      }
      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${cardTone} ${interactionTone}`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg">
          {avatarIcon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">
              {player.name}
            </p>
            {team && (
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
                  teamColorMap[team.color] ?? "bg-white/10 text-white"
                }`}
              >
                {team.name}
              </span>
            )}
          </div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">
            {t("minigameUi.roundsRemaining", { count: remainingRounds })}
          </p>
        </div>
        <div className="text-right">
          <span
            className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${statusTone}`}
          >
            {statusLabel}
          </span>
          <p className="mt-2 text-sm font-semibold text-white">
            {score.toFixed(1)}
          </p>
        </div>
      </div>
      {isActive && (
        <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-teal-200/80">
          {t("minigameUi.playerTurn")}
        </p>
      )}
    </button>
  );
};
