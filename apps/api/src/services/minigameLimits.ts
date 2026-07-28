export const MINIGAME_LIMITS = {
  teams: 4,
  players: 16,
  roundsPerPlayer: 20,
  ffaRoundBatch: 100,
  totalRounds: 320,
  teamNameLength: 80,
  teamColorLength: 64,
  playerNameLength: 80,
  playerAvatarLength: 256,
  selectionValueLength: 200,
  mutationBodyBytes: 32_768,
} as const;

export const MINIGAME_LIMIT_CODES = {
  teams: "MINIGAME_TEAM_LIMIT",
  players: "MINIGAME_PLAYER_LIMIT",
  rounds: "MINIGAME_ROUND_LIMIT",
  activeRound: "MINIGAME_ACTIVE_ROUND",
  startRound: "MINIGAME_ROUND_START_NOT_PENDING",
  position: "MINIGAME_POSITION_CONFLICT",
} as const;

export const getMinigameLimitCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return Object.values(MINIGAME_LIMIT_CODES).find((code) =>
    message.includes(code),
  );
};
