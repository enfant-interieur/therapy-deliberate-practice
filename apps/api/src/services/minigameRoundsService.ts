import { and, desc, eq, inArray } from "drizzle-orm";
import type { ApiDatabase } from "../db/types";
import {
  minigamePlayerPromptHistory,
  minigamePlayers,
  minigameRounds,
  minigameSessions,
  minigameTeams,
  taskExamples,
  tasks
} from "../db/schema";
import { generateUuid } from "../utils/uuid";
import {
  NoUniquePatientStatementsLeftError,
  NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
  pickUnusedExampleForPair,
  pickUnusedExampleForPlayer,
  type CandidateExample
} from "./minigamePromptSelection";

export { NoUniquePatientStatementsLeftError, NO_UNIQUE_PATIENT_STATEMENTS_LEFT };

type Logger = (level: "debug" | "info" | "warn" | "error", event: string, fields?: Record<string, unknown>) => void;

type TaskSelection = {
  strategy: "manual" | "random" | "filtered_random";
  task_ids?: string[];
  tags?: string[];
  skill_domains?: string[];
  shuffle?: boolean;
  seed?: string;
};

type RoundInsert = typeof minigameRounds.$inferInsert;

type HistoryInsert = typeof minigamePlayerPromptHistory.$inferInsert;

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed");

export const createSeededRandom = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const resolveMinigameTasks = async (db: ApiDatabase, selection: TaskSelection) => {
  if (selection.strategy === "manual") {
    if (!selection.task_ids?.length) {
      return [];
    }
    return db.select().from(tasks).where(inArray(tasks.id, selection.task_ids));
  }

  const filters = [eq(tasks.is_published, true)];
  if (selection.skill_domains?.length) {
    filters.push(inArray(tasks.skill_domain, selection.skill_domains));
  }
  const taskRows = await db.select().from(tasks).where(and(...filters));
  if (!selection.tags?.length) {
    return taskRows;
  }
  return taskRows.filter((task) => {
    const tags = (task.tags ?? []) as string[];
    return selection.tags?.some((tag) => tags.includes(tag));
  });
};

export const generateTdmSchedule = (
  players: Array<{ id: string; team_id: string | null }>,
  roundsPerPlayer: number,
  seed: string
) => {
  const rng = createSeededRandom(seed);
  const remaining = new Map(players.map((player) => [player.id, roundsPerPlayer]));
  const opponentsPlayed = new Map<string, Map<string, number>>();
  const teamsFaced = new Map<string, Map<string, number>>();
  for (const player of players) {
    opponentsPlayed.set(player.id, new Map());
    teamsFaced.set(player.id, new Map());
  }

  const matches: Array<{ playerA: string; playerB: string }> = [];
  const getRemaining = (id: string) => remaining.get(id) ?? 0;

  const pickPlayerA = () => {
    const candidates = players.filter((player) => getRemaining(player.id) > 0);
    if (!candidates.length) return null;
    candidates.sort((a, b) => getRemaining(b.id) - getRemaining(a.id));
    const topRemaining = getRemaining(candidates[0].id);
    const topCandidates = candidates.filter((player) => getRemaining(player.id) === topRemaining);
    return topCandidates[Math.floor(rng() * topCandidates.length)];
  };

  const pickPlayerB = (playerA: { id: string; team_id: string | null }) => {
    const candidates = players.filter(
      (player) =>
        player.id !== playerA.id && player.team_id !== playerA.team_id && getRemaining(player.id) > 0
    );
    if (!candidates.length) return null;
    const opponentsMap = opponentsPlayed.get(playerA.id) ?? new Map();
    const teamsMapA = teamsFaced.get(playerA.id) ?? new Map();
    candidates.sort((a, b) => {
      const opponentDiff = (opponentsMap.get(a.id) ?? 0) - (opponentsMap.get(b.id) ?? 0);
      if (opponentDiff !== 0) return opponentDiff;
      const teamDiff =
        (teamsMapA.get(a.team_id ?? "") ?? 0) - (teamsMapA.get(b.team_id ?? "") ?? 0);
      if (teamDiff !== 0) return teamDiff;
      return (getRemaining(b.id) ?? 0) - (getRemaining(a.id) ?? 0);
    });
    const bestScore = opponentsMap.get(candidates[0].id) ?? 0;
    const bestCandidates = candidates.filter((player) => (opponentsMap.get(player.id) ?? 0) === bestScore);
    return bestCandidates[Math.floor(rng() * bestCandidates.length)];
  };

  for (;;) {
    const playerA = pickPlayerA();
    if (!playerA) break;
    const playerB = pickPlayerB(playerA);
    if (!playerB) {
      remaining.set(playerA.id, 0);
      continue;
    }
    const opponentMapA = opponentsPlayed.get(playerA.id) ?? new Map();
    opponentMapA.set(playerB.id, (opponentMapA.get(playerB.id) ?? 0) + 1);
    const opponentMapB = opponentsPlayed.get(playerB.id) ?? new Map();
    opponentMapB.set(playerA.id, (opponentMapB.get(playerA.id) ?? 0) + 1);
    const teamsMapA = teamsFaced.get(playerA.id) ?? new Map();
    teamsMapA.set(playerB.team_id ?? "", (teamsMapA.get(playerB.team_id ?? "") ?? 0) + 1);
    const teamsMapB = teamsFaced.get(playerB.id) ?? new Map();
    teamsMapB.set(playerA.team_id ?? "", (teamsMapB.get(playerA.team_id ?? "") ?? 0) + 1);
    remaining.set(playerA.id, getRemaining(playerA.id) - 1);
    remaining.set(playerB.id, getRemaining(playerB.id) - 1);
    matches.push({ playerA: playerA.id, playerB: playerB.id });
  }

  return matches;
};

const buildSeedKey = (seed: string, parts: Array<string | number>) => `${seed}:${parts.join(":")}`;

const normalizeExamples = (examples: CandidateExample[]) =>
  [...examples].sort((a, b) => a.id.localeCompare(b.id));

const buildHistoryRowsFromRounds = (
  sessionId: string,
  rounds: Array<{ example_id: string; player_a_id: string; player_b_id: string | null }>,
  now: number
) => {
  const history: HistoryInsert[] = [];
  for (const round of rounds) {
    history.push({
      session_id: sessionId,
      player_id: round.player_a_id,
      patient_statement_id: round.example_id,
      created_at: now
    });
    if (round.player_b_id) {
      history.push({
        session_id: sessionId,
        player_id: round.player_b_id,
        patient_statement_id: round.example_id,
        created_at: now
      });
    }
  }
  return history;
};

const loadUsedPromptHistory = async (db: ApiDatabase, sessionId: string, playerIds: string[]) => {
  if (!playerIds.length) return new Map<string, Set<string>>();
  const existingRounds = await db
    .select({
      example_id: minigameRounds.example_id,
      player_a_id: minigameRounds.player_a_id,
      player_b_id: minigameRounds.player_b_id
    })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, sessionId));

  if (existingRounds.length) {
    const now = Date.now();
    const historyRows = buildHistoryRowsFromRounds(sessionId, existingRounds, now);
    if (historyRows.length) {
      await db.insert(minigamePlayerPromptHistory).values(historyRows).onConflictDoNothing();
    }
  }

  const history = await db
    .select({
      player_id: minigamePlayerPromptHistory.player_id,
      patient_statement_id: minigamePlayerPromptHistory.patient_statement_id
    })
    .from(minigamePlayerPromptHistory)
    .where(
      and(
        eq(minigamePlayerPromptHistory.session_id, sessionId),
        inArray(minigamePlayerPromptHistory.player_id, playerIds)
      )
    );

  const usedByPlayer = new Map<string, Set<string>>();
  for (const playerId of playerIds) {
    usedByPlayer.set(playerId, new Set());
  }
  for (const row of history) {
    if (!usedByPlayer.has(row.player_id)) {
      usedByPlayer.set(row.player_id, new Set());
    }
    usedByPlayer.get(row.player_id)?.add(row.patient_statement_id);
  }
  return usedByPlayer;
};

const buildPromptHistoryRows = (
  sessionId: string,
  rounds: Array<Pick<RoundInsert, "player_a_id" | "player_b_id" | "example_id">>,
  now: number
) => {
  const historyRows: HistoryInsert[] = [];
  for (const round of rounds) {
    historyRows.push({
      session_id: sessionId,
      player_id: round.player_a_id,
      patient_statement_id: round.example_id,
      created_at: now
    });
    if (round.player_b_id) {
      historyRows.push({
        session_id: sessionId,
        player_id: round.player_b_id,
        patient_statement_id: round.example_id,
        created_at: now
      });
    }
  }
  return historyRows;
};

const buildRoundsForSession = ({
  session,
  players,
  teams,
  examples,
  startPosition,
  count,
  usedByPlayer,
  seed,
  attempt
}: {
  session: typeof minigameSessions.$inferSelect;
  players: Array<typeof minigamePlayers.$inferSelect>;
  teams: Array<typeof minigameTeams.$inferSelect>;
  examples: CandidateExample[];
  startPosition: number;
  count: number | null;
  usedByPlayer: Map<string, Set<string>>;
  seed: string;
  attempt: number;
}) => {
  const roundsToInsert: RoundInsert[] = [];
  let position = startPosition;
  const teamByPlayer = new Map(players.map((player) => [player.id, player.team_id ?? null]));
  const normalizedExamples = normalizeExamples(examples);

  if (session.game_type === "tdm") {
    const roundsPerPlayer = Number((session.settings as { rounds_per_player?: number }).rounds_per_player ?? 1);
    const matches = generateTdmSchedule(
      players.map((player) => ({ id: player.id, team_id: player.team_id ?? null })),
      roundsPerPlayer,
      seed
    );
    for (const match of matches) {
      const usedA = usedByPlayer.get(match.playerA) ?? new Set();
      const usedB = usedByPlayer.get(match.playerB) ?? new Set();
      const seedKey = buildSeedKey(seed, [session.id, match.playerA, match.playerB, position, attempt]);
      const example = pickUnusedExampleForPair({
        examples: normalizedExamples,
        usedByPlayerA: usedA,
        usedByPlayerB: usedB,
        seedKey
      });
      usedA.add(example.id);
      usedB.add(example.id);
      roundsToInsert.push({
        id: generateUuid(),
        session_id: session.id,
        position,
        task_id: example.task_id,
        example_id: example.id,
        player_a_id: match.playerA,
        player_b_id: match.playerB,
        team_a_id: teamByPlayer.get(match.playerA),
        team_b_id: teamByPlayer.get(match.playerB),
        status: "pending",
        started_at: null,
        completed_at: null
      });
      position += 1;
    }
  } else {
    if (!players.length) {
      throw new Error("Add at least one player before generating rounds.");
    }
    const totalCount = count ?? 1;
    for (let i = 0; i < totalCount; i += 1) {
      const player = players[i % players.length];
      const used = usedByPlayer.get(player.id) ?? new Set();
      const seedKey = buildSeedKey(seed, [session.id, player.id, position, attempt]);
      const example = pickUnusedExampleForPlayer({
        examples: normalizedExamples,
        usedExampleIds: used,
        seedKey
      });
      used.add(example.id);
      roundsToInsert.push({
        id: generateUuid(),
        session_id: session.id,
        position,
        task_id: example.task_id,
        example_id: example.id,
        player_a_id: player.id,
        player_b_id: null,
        team_a_id: player.team_id ?? null,
        team_b_id: null,
        status: "pending",
        started_at: null,
        completed_at: null
      });
      position += 1;
    }
  }

  return roundsToInsert;
};

const insertPromptHistoryWithRetry = async ({
  db,
  sessionId,
  rounds,
  logEvent,
  mode
}: {
  db: ApiDatabase;
  sessionId: string;
  rounds: RoundInsert[];
  logEvent?: Logger;
  mode: string;
}) => {
  const historyRows = buildPromptHistoryRows(sessionId, rounds, Date.now());
  if (!historyRows.length) return;
  await db.insert(minigamePlayerPromptHistory).values(historyRows);
  logEvent?.("info", "minigames.prompt_history.insert", {
    sessionId,
    mode,
    rows: historyRows.length
  });
};

const generateRoundsWithRetries = async ({
  db,
  session,
  count,
  logEvent
}: {
  db: ApiDatabase;
  session: typeof minigameSessions.$inferSelect;
  count?: number;
  logEvent?: Logger;
}) => {
  const selection = session.task_selection as TaskSelection;
  const tasksForSelection = await resolveMinigameTasks(db, selection);
  if (!tasksForSelection.length) {
    throw new Error("No tasks available for selection.");
  }
  const examples = await db
    .select({ id: taskExamples.id, task_id: taskExamples.task_id })
    .from(taskExamples)
    .where(inArray(taskExamples.task_id, tasksForSelection.map((task) => task.id)));

  if (!examples.length) {
    return { roundCount: 0, retries: 0 };
  }

  const players = await db
    .select()
    .from(minigamePlayers)
    .where(eq(minigamePlayers.session_id, session.id));
  const teams = await db
    .select()
    .from(minigameTeams)
    .where(eq(minigameTeams.session_id, session.id));

  const [lastRound] = await db
    .select({ position: minigameRounds.position })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, session.id))
    .orderBy(desc(minigameRounds.position))
    .limit(1);
  const startPosition = lastRound?.position != null ? lastRound.position + 1 : 0;

  const seed = selection.seed ?? session.id;
  const maxRetries = 3;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const usedByPlayer = await loadUsedPromptHistory(
        db,
        session.id,
        players.map((player) => player.id)
      );
      const roundsToInsert = buildRoundsForSession({
        session,
        players,
        teams,
        examples,
        startPosition,
        count: session.game_type === "tdm" ? null : count ?? 1,
        usedByPlayer,
        seed,
        attempt
      });
      if (!roundsToInsert.length) {
        return { roundCount: 0, retries: attempt };
      }
      await insertPromptHistoryWithRetry({
        db,
        sessionId: session.id,
        rounds: roundsToInsert,
        logEvent,
        mode: session.game_type
      });
      await db.insert(minigameRounds).values(roundsToInsert);
      if (attempt > 0) {
        logEvent?.("info", "minigames.prompt_history.retry_success", {
          sessionId: session.id,
          retries: attempt,
          mode: session.game_type
        });
      }
      return { roundCount: roundsToInsert.length, retries: attempt };
    } catch (error) {
      if (error instanceof NoUniquePatientStatementsLeftError) {
        logEvent?.("warn", "minigames.prompt_history.exhausted", {
          sessionId: session.id,
          metadata: error.metadata,
          mode: session.game_type
        });
        throw error;
      }
      if (isUniqueConstraintError(error)) {
        logEvent?.("warn", "minigames.prompt_history.conflict", {
          sessionId: session.id,
          attempt,
          mode: session.game_type
        });
        attempt += 1;
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return { roundCount: 0, retries: attempt };
};

export const generateMinigameRounds = async ({
  db,
  session,
  count,
  logEvent
}: {
  db: ApiDatabase;
  session: typeof minigameSessions.$inferSelect;
  count?: number;
  logEvent?: Logger;
}) => generateRoundsWithRetries({ db, session, count, logEvent });

export const redrawMinigameRound = async ({
  db,
  session,
  logEvent
}: {
  db: ApiDatabase;
  session: typeof minigameSessions.$inferSelect;
  logEvent?: Logger;
}) => {
  const selection = session.task_selection as TaskSelection;
  const tasksForSelection = await resolveMinigameTasks(db, selection);
  if (!tasksForSelection.length) {
    throw new Error("No tasks available for selection.");
  }
  const examples = await db
    .select({ id: taskExamples.id, task_id: taskExamples.task_id })
    .from(taskExamples)
    .where(inArray(taskExamples.task_id, tasksForSelection.map((task) => task.id)));

  if (!examples.length) {
    return { roundCount: 0, retries: 0 };
  }

  const players = await db
    .select()
    .from(minigamePlayers)
    .where(eq(minigamePlayers.session_id, session.id));
  if (players.length < 2) {
    throw new Error("Not enough players to redraw.");
  }
  const teams = await db
    .select()
    .from(minigameTeams)
    .where(eq(minigameTeams.session_id, session.id));

  const teamByPlayer = new Map(players.map((player) => [player.id, player.team_id ?? null]));
  const seed = selection.seed ?? session.id;
  const matches = generateTdmSchedule(
    players.map((player) => ({ id: player.id, team_id: player.team_id ?? null })),
    1,
    seed
  );
  const match = matches[0];
  if (!match) {
    return { roundCount: 0, retries: 0 };
  }

  const [lastRound] = await db
    .select({ position: minigameRounds.position })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, session.id))
    .orderBy(desc(minigameRounds.position))
    .limit(1);
  const position = lastRound?.position != null ? lastRound.position + 1 : 0;

  const maxRetries = 3;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const usedByPlayer = await loadUsedPromptHistory(
        db,
        session.id,
        players.map((player) => player.id)
      );
      const usedA = usedByPlayer.get(match.playerA) ?? new Set();
      const usedB = usedByPlayer.get(match.playerB) ?? new Set();
      const seedKey = buildSeedKey(seed, [session.id, match.playerA, match.playerB, position, attempt]);
      const example = pickUnusedExampleForPair({
        examples: normalizeExamples(examples),
        usedByPlayerA: usedA,
        usedByPlayerB: usedB,
        seedKey
      });
      const round: RoundInsert = {
        id: generateUuid(),
        session_id: session.id,
        position,
        task_id: example.task_id,
        example_id: example.id,
        player_a_id: match.playerA,
        player_b_id: match.playerB,
        team_a_id: teamByPlayer.get(match.playerA),
        team_b_id: teamByPlayer.get(match.playerB),
        status: "pending",
        started_at: null,
        completed_at: null
      };
      await insertPromptHistoryWithRetry({
        db,
        sessionId: session.id,
        rounds: [round],
        logEvent,
        mode: session.game_type
      });
      await db.insert(minigameRounds).values(round);
      if (attempt > 0) {
        logEvent?.("info", "minigames.prompt_history.retry_success", {
          sessionId: session.id,
          retries: attempt,
          mode: session.game_type
        });
      }
      return { roundCount: 1, retries: attempt };
    } catch (error) {
      if (error instanceof NoUniquePatientStatementsLeftError) {
        logEvent?.("warn", "minigames.prompt_history.exhausted", {
          sessionId: session.id,
          metadata: error.metadata,
          mode: session.game_type
        });
        throw error;
      }
      if (isUniqueConstraintError(error)) {
        logEvent?.("warn", "minigames.prompt_history.conflict", {
          sessionId: session.id,
          attempt,
          mode: session.game_type
        });
        attempt += 1;
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastError) {
    throw lastError;
  }
  return { roundCount: 0, retries: attempt };
};
