import { nanoid } from "nanoid";

export type PlayerDraft = {
  id: string;
  name: string;
  avatar: string;
  team_id?: string | null;
};

export type TeamDraft = {
  id: string;
  name: string;
  color: string;
};

type PlayersTeamsStepProps = {
  mode: "ffa" | "tdm";
  players: PlayerDraft[];
  teams: TeamDraft[];
  onChangePlayers: (players: PlayerDraft[]) => void;
  onChangeTeams: (teams: TeamDraft[]) => void;
  roundsPerPlayer: number;
  onRoundsPerPlayerChange: (value: number) => void;
};

const avatarOptions = ["astro", "nova", "ember", "pulse", "lumen", "halo"];
const teamColors = ["teal", "violet", "amber", "rose", "sky", "lime"];

export const PlayersTeamsStep = ({
  mode,
  players,
  teams,
  onChangePlayers,
  onChangeTeams,
  roundsPerPlayer,
  onRoundsPerPlayerChange
}: PlayersTeamsStepProps) => {
  const addTeam = () => {
    const next = [
      ...teams,
      {
        id: nanoid(),
        name: `Team ${teams.length + 1}`,
        color: teamColors[teams.length % teamColors.length]
      }
    ];
    onChangeTeams(next);
  };

  const addPlayer = () => {
    onChangePlayers([
      ...players,
      {
        id: nanoid(),
        name: `Player ${players.length + 1}`,
        avatar: avatarOptions[players.length % avatarOptions.length],
        team_id: mode === "tdm" ? teams[0]?.id ?? null : null
      }
    ]);
  };

  return (
    <div className="space-y-6">
      {mode === "tdm" && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Teams</p>
              <p className="text-xs text-slate-300">Create teams and assign players.</p>
            </div>
            <button
              onClick={addTeam}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
            >
              Add team
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {teams.map((team, index) => (
              <div
                key={team.id}
                className="rounded-xl border border-white/10 bg-slate-950/60 p-3"
              >
                <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Team {index + 1}
                </label>
                <input
                  value={team.name}
                  onChange={(event) => {
                    const next = [...teams];
                    next[index] = { ...team, name: event.target.value };
                    onChangeTeams(next);
                  }}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {teamColors.map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        const next = [...teams];
                        next[index] = { ...team, color };
                        onChangeTeams(next);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        team.color === color
                          ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                          : "border-white/10 bg-white/5 text-white/70"
                      }`}
                    >
                      {color}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Players</p>
            <p className="text-xs text-slate-300">Add the participants for this match.</p>
          </div>
          <button
            onClick={addPlayer}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
          >
            Add player
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {players.map((player, index) => (
            <div
              key={player.id}
              className="rounded-xl border border-white/10 bg-slate-950/60 p-3"
            >
              <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Player {index + 1}
              </label>
              <input
                value={player.name}
                onChange={(event) => {
                  const next = [...players];
                  next[index] = { ...player, name: event.target.value };
                  onChangePlayers(next);
                }}
                className="mt-2 w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {avatarOptions.map((avatar) => (
                  <button
                    key={avatar}
                    onClick={() => {
                      const next = [...players];
                      next[index] = { ...player, avatar };
                      onChangePlayers(next);
                    }}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      player.avatar === avatar
                        ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                        : "border-white/10 bg-white/5 text-white/70"
                    }`}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
              {mode === "tdm" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {teams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => {
                        const next = [...players];
                        next[index] = { ...player, team_id: team.id };
                        onChangePlayers(next);
                      }}
                      className={`rounded-full border px-3 py-1 text-xs ${
                        player.team_id === team.id
                          ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                          : "border-white/10 bg-white/5 text-white/70"
                      }`}
                    >
                      {team.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <p className="text-sm font-semibold text-white">Rounds per player</p>
        <p className="mt-1 text-xs text-slate-300">
          Each player will complete this many turns across the match.
        </p>
        <input
          type="number"
          min={1}
          value={roundsPerPlayer}
          onChange={(event) => onRoundsPerPlayerChange(Number(event.target.value))}
          className="mt-2 w-24 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
        />
      </div>
    </div>
  );
};
