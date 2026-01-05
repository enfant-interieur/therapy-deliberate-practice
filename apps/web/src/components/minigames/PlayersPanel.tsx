import { useMemo } from "react";
import { PlayerCard } from "./PlayerCard";
import { RoundHUD } from "./RoundHUD";
import type { MinigamePlayer, MinigameRound, MinigameRoundResult, MinigameTeam } from "../../store/api";

type PlayersPanelProps = {
  mode: "ffa" | "tdm" | null;
  rounds: MinigameRound[];
  currentRound?: MinigameRound;
  players: MinigamePlayer[];
  teams: MinigameTeam[];
  results: MinigameRoundResult[];
  activePlayerId?: string | null;
  upNextPlayerId?: string | null;
  canSwitchPlayer: boolean;
  onRequestSwitchPlayer?: (playerId: string) => void;
  onNextTurn?: () => void;
  nextTurnDisabled?: boolean;
};

export const PlayersPanel = ({
  mode,
  rounds,
  currentRound,
  players,
  teams,
  results,
  activePlayerId,
  upNextPlayerId,
  canSwitchPlayer,
  onRequestSwitchPlayer,
  onNextTurn,
  nextTurnDisabled
}: PlayersPanelProps) => {
  const activePlayer = players.find((player) => player.id === activePlayerId);
  const scoresByPlayer = useMemo(() => {
    return players.reduce<Record<string, number>>((acc, player) => {
      acc[player.id] = results
        .filter((result) => result.player_id === player.id)
        .reduce((sum, result) => sum + result.overall_score, 0);
      return acc;
    }, {});
  }, [players, results]);

  const remainingRoundsByPlayer = useMemo(() => {
    const remaining: Record<string, number> = {};
    players.forEach((player) => {
      remaining[player.id] = 0;
    });
    rounds.forEach((round) => {
      if (round.status === "completed") return;
      if (round.player_a_id) {
        remaining[round.player_a_id] = (remaining[round.player_a_id] ?? 0) + 1;
      }
      if (round.player_b_id) {
        remaining[round.player_b_id] = (remaining[round.player_b_id] ?? 0) + 1;
      }
    });
    return remaining;
  }, [players, rounds]);

  return (
    <div className="space-y-3">
      <RoundHUD
        round={currentRound}
        player={activePlayer}
        teams={teams}
        onNextTurn={onNextTurn}
        nextTurnDisabled={nextTurnDisabled}
      />
      <div className="rounded-3xl border border-white/10 bg-slate-900/60 px-4 py-4 shadow-[0_0_20px_rgba(15,23,42,0.4)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Players</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {activePlayer ? `${activePlayer.name} Turn` : "Waiting for players"}
            </p>
          </div>
          {mode === "ffa" && activePlayer && (
            <span className="rounded-full border border-teal-300/50 bg-teal-500/15 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-teal-100">
              Player Turn
            </span>
          )}
          {mode === "tdm" && (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.25em] text-white/70">
              Team Match
            </span>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {players.map((player) => {
            const team = player.team_id ? teams.find((entry) => entry.id === player.team_id) : null;
            const isActive = player.id === activePlayerId;
            const isUpNext = !isActive && player.id === upNextPlayerId;
            return (
              <PlayerCard
                key={player.id}
                player={player}
                team={team}
                score={scoresByPlayer[player.id] ?? 0}
                remainingRounds={remainingRoundsByPlayer[player.id] ?? 0}
                isActive={isActive}
                isUpNext={isUpNext}
                canSwitch={canSwitchPlayer}
                onClick={
                  mode === "ffa" && onRequestSwitchPlayer
                    ? () => onRequestSwitchPlayer(player.id)
                    : undefined
                }
              />
            );
          })}
        </div>
        {mode === "ffa" && !canSwitchPlayer && (
          <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-slate-400">
            Finish the current action to switch players.
          </p>
        )}
      </div>
    </div>
  );
};
