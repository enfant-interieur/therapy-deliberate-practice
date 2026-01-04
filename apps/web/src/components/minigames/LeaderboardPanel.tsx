import type { MinigamePlayer, MinigameRoundResult, MinigameTeam } from "../../store/api";

type LeaderboardPanelProps = {
  mode: "ffa" | "tdm";
  players: MinigamePlayer[];
  teams: MinigameTeam[];
  results: MinigameRoundResult[];
  variant?: "standalone" | "embedded";
};

const colorMap: Record<string, string> = {
  teal: "bg-teal-400/20 text-teal-100",
  violet: "bg-violet-400/20 text-violet-100",
  amber: "bg-amber-400/20 text-amber-100",
  rose: "bg-rose-400/20 text-rose-100",
  sky: "bg-sky-400/20 text-sky-100",
  lime: "bg-lime-400/20 text-lime-100"
};

export const LeaderboardPanel = ({
  mode,
  players,
  teams,
  results,
  variant = "standalone"
}: LeaderboardPanelProps) => {
  const playerStats = players.map((player) => {
    const attempts = results.filter((result) => result.player_id === player.id);
    const average =
      attempts.length > 0
        ? attempts.reduce((sum, entry) => sum + entry.overall_score, 0) / attempts.length
        : 0;
    return {
      ...player,
      rounds: attempts.length,
      average
    };
  });
  const sortedPlayers = [...playerStats].sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    return b.rounds - a.rounds;
  });

  const teamSummary = teams
    .map((team) => {
      const members = playerStats.filter((player) => player.team_id === team.id);
      const average =
        members.length > 0
          ? members.reduce((sum, player) => sum + player.average, 0) / members.length
          : 0;
      return { ...team, average };
    })
    .sort((a, b) => b.average - a.average);

  return (
    <aside
      className={
        variant === "standalone"
          ? "w-full rounded-3xl border border-white/10 bg-slate-900/60 p-4 shadow-[0_0_30px_rgba(15,23,42,0.4)] backdrop-blur md:w-80"
          : "w-full"
      }
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Leaderboard</h3>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
          Live
        </span>
      </div>
      {mode === "tdm" && (
        <div className="mt-4 space-y-2">
          {teamSummary.map((team) => (
            <div
              key={team.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200"
            >
              <span className={`rounded-full px-2 py-1 text-[10px] ${colorMap[team.color] ?? "bg-white/10 text-white"}`}>
                {team.name}
              </span>
              <span className="text-sm font-semibold text-white">
                {team.average.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 space-y-2">
        {sortedPlayers.map((player, index) => {
          const team = teams.find((teamEntry) => teamEntry.id === player.team_id);
          return (
            <div
              key={player.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2 text-xs text-slate-200"
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-400">#{index + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-white">{player.name}</p>
                  <p className="text-[10px] text-slate-400">{player.rounds} rounds</p>
                </div>
              </div>
              <div className="text-right">
                {team && (
                  <span
                    className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] ${colorMap[team.color] ?? "bg-white/10 text-white"}`}
                  >
                    {team.name}
                  </span>
                )}
                <p className="text-sm font-semibold text-white">{player.average.toFixed(2)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
