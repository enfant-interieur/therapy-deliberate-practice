import type { MinigamePlayer, MinigameRound, MinigameTeam } from "../../store/api";

type RoundHUDProps = {
  round?: MinigameRound;
  player?: MinigamePlayer;
  teams: MinigameTeam[];
  onNextTurn?: () => void;
  nextTurnDisabled?: boolean;
};

export const RoundHUD = ({ round, player, teams, onNextTurn, nextTurnDisabled }: RoundHUDProps) => {
  const team = teams.find((entry) => entry.id === player?.team_id);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/60 px-6 py-4 shadow-[0_0_25px_rgba(15,23,42,0.4)] backdrop-blur">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-full border border-white/20 bg-white/5" />
        <div>
          <p className="text-sm font-semibold text-white">{player?.name ?? "Choose player"}</p>
          <p className="text-xs text-slate-300">
            {team ? `${team.name} · ${team.color}` : "Solo"}
          </p>
        </div>
      </div>
      <div className="text-xs text-slate-300">
        Round {round ? round.position + 1 : "--"}
      </div>
      {onNextTurn && (
        <button
          onClick={onNextTurn}
          disabled={nextTurnDisabled}
          className="rounded-full border border-teal-300/60 bg-teal-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 hover:border-teal-200 disabled:border-white/10 disabled:bg-white/5 disabled:text-white/50 disabled:hover:border-white/10"
        >
          Next turn
        </button>
      )}
    </div>
  );
};
