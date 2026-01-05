import type { MinigameRound } from "../../../store/api";

export const roundExampleKey = (round: MinigameRound) =>
  `${round.example_id ?? "example"}`;

export const deriveActivePlayerId = ({
  mode,
  currentRound,
  tdmActivePlayerId
}: {
  mode: "ffa" | "tdm" | null;
  currentRound?: MinigameRound;
  tdmActivePlayerId?: string | null;
}) => {
  if (mode === "tdm") return tdmActivePlayerId ?? null;
  if (mode === "ffa") return currentRound?.player_a_id ?? null;
  return null;
};

export const getUpNextPlayerId = (rounds: MinigameRound[]) => {
  const upcoming = rounds
    .filter((round) => round.status !== "completed")
    .sort((a, b) => a.position - b.position);
  return upcoming[0]?.player_a_id ?? null;
};

export const getNextRoundForPlayer = ({
  rounds,
  playerId,
  playedExampleIds,
  completedRoundIds,
  discardedRoundIds
}: {
  rounds: MinigameRound[];
  playerId: string;
  playedExampleIds?: Set<string>;
  completedRoundIds?: Set<string>;
  discardedRoundIds?: Set<string>;
}) => {
  const upcoming = rounds
    .filter((round) => round.status !== "completed" && round.player_a_id === playerId)
    .sort((a, b) => a.position - b.position);

  for (const round of upcoming) {
    if (discardedRoundIds?.has(round.id)) continue;
    if (completedRoundIds?.has(round.id)) continue;
    const exampleKey = roundExampleKey(round);
    if (playedExampleIds?.has(exampleKey)) continue;
    return round;
  }

  return null;
};
