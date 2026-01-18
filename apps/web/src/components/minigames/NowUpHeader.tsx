import type { PatientAudioStatus } from "../../patientAudio/PatientAudioBank";
import type { MinigamePlayer, MinigameRound, MinigameTeam } from "../../store/api";

type NowUpHeaderProps = {
  mode: "ffa" | "tdm" | null;
  currentRound?: MinigameRound;
  players: MinigamePlayer[];
  teams: MinigameTeam[];
  activePlayerId?: string | null;
  responseCountdown?: number | null;
  audioStatus?: PatientAudioStatus;
  audioError?: string | null;
};

const teamGradientMap: Record<string, string> = {
  teal: "from-teal-300/70 via-teal-100/80 to-white/60",
  violet: "from-violet-300/70 via-purple-100/80 to-white/60",
  amber: "from-amber-300/70 via-amber-100/80 to-white/60",
  rose: "from-rose-300/70 via-rose-100/80 to-white/60",
  sky: "from-sky-300/70 via-sky-100/80 to-white/60",
  lime: "from-lime-300/70 via-lime-100/80 to-white/60"
};

const modeLabelMap = {
  ffa: "Free For All",
  tdm: "Team Deathmatch"
};

const teamSummary = (team?: MinigameTeam | null) =>
  team ? `${team.name} · ${team.color}` : "Solo";

const teamAccent = (team?: MinigameTeam | null) =>
  team?.color && teamGradientMap[team.color]
    ? teamGradientMap[team.color]
    : "from-teal-300/70 via-white/80 to-slate-200/70";

export const NowUpHeader = ({
  mode,
  currentRound,
  players,
  teams,
  activePlayerId,
  responseCountdown,
  audioStatus,
  audioError
}: NowUpHeaderProps) => {
  const isPlaying = audioStatus === "playing";
  const headerLabel = isPlaying ? "Now playing" : "Now up";
  const responseLabel =
    responseCountdown == null
      ? null
      : responseCountdown > 0
        ? `WAIT ${responseCountdown.toFixed(1)}s`
        : `LATE ${Math.abs(responseCountdown).toFixed(1)}s`;
  const responseTone =
    responseCountdown == null
      ? ""
      : responseCountdown > 0
        ? "border-teal-300/50 bg-teal-500/15 text-teal-100"
        : "border-rose-300/50 bg-rose-500/20 text-rose-100";

  if (!mode) {
    return (
      <div className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-center text-sm text-slate-200 shadow-[0_0_30px_rgba(15,23,42,0.4)] backdrop-blur">
        Select a mode to begin.
      </div>
    );
  }

  const playerA = currentRound
    ? players.find((player) => player.id === currentRound.player_a_id)
    : undefined;
  const playerB = currentRound?.player_b_id
    ? players.find((player) => player.id === currentRound.player_b_id)
    : undefined;
  const teamA = currentRound?.team_a_id
    ? teams.find((team) => team.id === currentRound.team_a_id)
    : playerA?.team_id
      ? teams.find((team) => team.id === playerA.team_id)
      : undefined;
  const teamB = currentRound?.team_b_id
    ? teams.find((team) => team.id === currentRound.team_b_id)
    : playerB?.team_id
      ? teams.find((team) => team.id === playerB.team_id)
      : undefined;
  const activePlayer =
    activePlayerId ? players.find((player) => player.id === activePlayerId) : playerA ?? playerB ?? null;
  const resolvedActiveTeam =
    activePlayer?.id === playerA?.id
      ? teamA
      : activePlayer?.id === playerB?.id
        ? teamB
        : activePlayer?.team_id
          ? teams.find((team) => team.id === activePlayer.team_id)
          : teamA;
  const activeAccent = teamAccent(resolvedActiveTeam);
  const isPlayerAActive = Boolean(activePlayerId && playerA?.id === activePlayerId);
  const isPlayerBActive = Boolean(activePlayerId && playerB?.id === activePlayerId);

  const playerCardClass = (isActive: boolean) =>
    [
      "relative rounded-2xl border px-4 py-3 transition-all duration-200",
      isActive
        ? "border-white/70 bg-slate-900/80 shadow-[0_25px_60px_rgba(15,23,42,0.55)] ring-1 ring-white/40"
        : "border-white/10 bg-slate-950/40 opacity-80"
    ].join(" ");

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-4 text-left shadow-[0_0_30px_rgba(15,23,42,0.4)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.4em] text-teal-200/70">
            {headerLabel}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
            {modeLabelMap[mode]}
          </span>
        </div>
        {audioError && (
          <span className="rounded-full border border-rose-300/60 bg-rose-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-rose-100">
            {audioError}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 shadow-[0_15px_45px_rgba(15,23,42,0.55)]">
        <span className={`rounded-full border border-white/20 bg-gradient-to-r ${activeAccent} px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.35em] text-slate-900/90`}>
          Now playing
        </span>
        <div className="flex flex-col">
          <p className="text-lg font-semibold text-white">
            {activePlayer?.name ?? "Waiting for player"}
          </p>
          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-200/80">
            {teamSummary(resolvedActiveTeam)}
          </p>
        </div>
        {responseLabel && (
          <span
            className={`ml-auto rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${responseTone}`}
          >
            {responseLabel}
          </span>
        )}
      </div>

      {mode === "tdm" ? (
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className={playerCardClass(isPlayerAActive)}>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
              Team A
            </p>
            <p className={`mt-2 text-lg font-semibold text-white`}>
              {playerA?.name ?? "Player A"}
            </p>
            <p className={`text-xs uppercase tracking-[0.2em] bg-gradient-to-r ${teamAccent(teamA)} bg-clip-text text-transparent`}>
              {teamSummary(teamA)}
            </p>
            {isPlayerAActive ? (
              <span className="mt-3 inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-lime-300" />
                Now playing
              </span>
            ) : (
              <span className="mt-3 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-slate-400">
                Stand by
              </span>
            )}
          </div>

          <div className="hidden items-center justify-center md:flex">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.4em] text-slate-200">
              VS
            </span>
          </div>

          <div className={`${playerCardClass(isPlayerBActive)} text-right`}>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
              Team B
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              {playerB?.name ?? "Player B"}
            </p>
            <p className={`text-xs uppercase tracking-[0.2em] bg-gradient-to-r ${teamAccent(teamB)} bg-clip-text text-transparent`}>
              {teamSummary(teamB)}
            </p>
            {isPlayerBActive ? (
              <span className="mt-3 inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-300" />
                Now playing
              </span>
            ) : (
              <span className="mt-3 inline-flex rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-slate-400">
                Stand by
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className={`${playerCardClass(true)} mt-4`}>
          <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">
            Player turn
          </p>
          <p className="mt-2 text-lg font-semibold text-white">
            {players.find((player) => player.id === activePlayerId)?.name ?? playerA?.name ?? "Player"} Turn
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
            {teamSummary(teamA)}
          </p>
          <span className="mt-3 inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-white">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-lime-300" />
            Now playing
          </span>
        </div>
      )}
    </div>
  );
};
