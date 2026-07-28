import { and, desc, eq, inArray } from "drizzle-orm";
import type { ApiDatabase } from "../db/types";
import {
  minigamePlayerPromptHistory,
  minigamePlayers,
  minigameRedrawClaims,
  minigameRounds,
  minigameSessions,
  minigameTeams,
  taskExamples,
  tasks,
} from "../db/schema";
import { generateUuid } from "../utils/uuid";
import {
  NoUniquePatientStatementsLeftError,
  NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
  pickUnusedExampleForPair,
  pickUnusedExampleForPlayer,
  type CandidateExample,
} from "./minigamePromptSelection";
import { runAtomicMutation } from "../db/atomic";
import {
  getMinigameLimitCode,
  MINIGAME_LIMIT_CODES,
  MINIGAME_LIMITS,
} from "./minigameLimits";
import { publishedTasksCondition } from "./taskPublication";

export {
  NoUniquePatientStatementsLeftError,
  NO_UNIQUE_PATIENT_STATEMENTS_LEFT,
};

type Logger = (
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

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

export class MinigameRedrawConflictError extends Error {
  constructor() {
    super("The round can no longer be redrawn.");
    this.name = "MinigameRedrawConflictError";
  }
}

export class NoAvailableMinigameTasksError extends Error {
  constructor() {
    super("The selected tasks are no longer available.");
    this.name = "NoAvailableMinigameTasksError";
  }
}

export class InvalidTdmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTdmConfigurationError";
  }
}

const isRedrawClaimConflict = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes("minigame_redraw_claims.replaced_round_id") ||
    error.message.includes("MINIGAME_REDRAW_NOT_PENDING"));

const isRetryableInsertConflict = (error: unknown) =>
  isUniqueConstraintError(error) ||
  getMinigameLimitCode(error) === MINIGAME_LIMIT_CODES.position;

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

export const resolveMinigameTasks = async (
  db: ApiDatabase,
  selection: TaskSelection,
) => {
  if (selection.strategy === "manual") {
    if (!selection.task_ids?.length) {
      return [];
    }
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(inArray(tasks.id, selection.task_ids), publishedTasksCondition()),
      );
    return rows.length === new Set(selection.task_ids).size ? rows : [];
  }

  const filters = [publishedTasksCondition()];
  if (selection.skill_domains?.length) {
    filters.push(inArray(tasks.skill_domain, selection.skill_domains));
  }
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(...filters));
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
  seed: string,
  validTeamIds?: ReadonlySet<string>,
) => {
  if (!Number.isInteger(roundsPerPlayer) || roundsPerPlayer < 1) {
    throw new InvalidTdmConfigurationError(
      "Team games require a positive whole-number rounds-per-player setting.",
    );
  }
  if (players.length < 2) {
    throw new InvalidTdmConfigurationError(
      "Team games require at least two players.",
    );
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new InvalidTdmConfigurationError(
      "Team-game player identifiers must be unique.",
    );
  }
  if (
    players.some(
      (player) =>
        !player.team_id ||
        (validTeamIds !== undefined && !validTeamIds.has(player.team_id)),
    )
  ) {
    throw new InvalidTdmConfigurationError(
      "Every team-game player must be assigned to a team in this game.",
    );
  }
  const teamIds = new Set(players.map((player) => player.team_id as string));
  if (teamIds.size < 2) {
    throw new InvalidTdmConfigurationError(
      "Team games require players from at least two teams.",
    );
  }

  const rng = createSeededRandom(seed);
  const remaining = new Map(
    players.map((player) => [player.id, roundsPerPlayer]),
  );
  const opponentsPlayed = new Map<string, Map<string, number>>();
  const teamsFaced = new Map<string, Map<string, number>>();
  for (const player of players) {
    opponentsPlayed.set(player.id, new Map());
    teamsFaced.set(player.id, new Map());
  }

  const matches: Array<{ playerA: string; playerB: string }> = [];
  const getRemaining = (id: string) => remaining.get(id) ?? 0;

  const residualIsFeasible = () => {
    const total = players.reduce(
      (sum, player) => sum + getRemaining(player.id),
      0,
    );
    if (total % 2 !== 0) return false;
    const byTeam = new Map<string, number>();
    for (const player of players) {
      const teamId = player.team_id as string;
      byTeam.set(teamId, (byTeam.get(teamId) ?? 0) + getRemaining(player.id));
    }
    return [...byTeam.values()].every(
      (teamTotal) => teamTotal <= total - teamTotal,
    );
  };

  if (!residualIsFeasible()) {
    throw new InvalidTdmConfigurationError(
      "The team sizes and rounds-per-player setting cannot give every player the requested number of cross-team rounds.",
    );
  }

  while ([...remaining.values()].some((value) => value > 0)) {
    const candidates: Array<{
      playerA: (typeof players)[number];
      playerB: (typeof players)[number];
      opponentCount: number;
      teamCount: number;
      remainingTotal: number;
    }> = [];
    for (let aIndex = 0; aIndex < players.length; aIndex += 1) {
      const playerA = players[aIndex];
      if (getRemaining(playerA.id) < 1) continue;
      for (let bIndex = aIndex + 1; bIndex < players.length; bIndex += 1) {
        const playerB = players[bIndex];
        if (
          getRemaining(playerB.id) < 1 ||
          playerA.team_id === playerB.team_id
        ) {
          continue;
        }
        remaining.set(playerA.id, getRemaining(playerA.id) - 1);
        remaining.set(playerB.id, getRemaining(playerB.id) - 1);
        const remainsFeasible = residualIsFeasible();
        remaining.set(playerA.id, getRemaining(playerA.id) + 1);
        remaining.set(playerB.id, getRemaining(playerB.id) + 1);
        if (!remainsFeasible) continue;
        candidates.push({
          playerA,
          playerB,
          opponentCount: opponentsPlayed.get(playerA.id)?.get(playerB.id) ?? 0,
          teamCount:
            (teamsFaced.get(playerA.id)?.get(playerB.team_id as string) ?? 0) +
            (teamsFaced.get(playerB.id)?.get(playerA.team_id as string) ?? 0),
          remainingTotal: getRemaining(playerA.id) + getRemaining(playerB.id),
        });
      }
    }
    if (!candidates.length) {
      throw new InvalidTdmConfigurationError(
        "A complete cross-team schedule could not be generated for every player.",
      );
    }
    candidates.sort(
      (a, b) =>
        a.opponentCount - b.opponentCount ||
        a.teamCount - b.teamCount ||
        b.remainingTotal - a.remainingTotal ||
        a.playerA.id.localeCompare(b.playerA.id) ||
        a.playerB.id.localeCompare(b.playerB.id),
    );
    const best = candidates[0];
    const equivalent = candidates.filter(
      (candidate) =>
        candidate.opponentCount === best.opponentCount &&
        candidate.teamCount === best.teamCount &&
        candidate.remainingTotal === best.remainingTotal,
    );
    const chosen = equivalent[Math.floor(rng() * equivalent.length)];
    const { playerA, playerB } = chosen;
    const opponentMapA = opponentsPlayed.get(playerA.id) ?? new Map();
    opponentMapA.set(playerB.id, (opponentMapA.get(playerB.id) ?? 0) + 1);
    const opponentMapB = opponentsPlayed.get(playerB.id) ?? new Map();
    opponentMapB.set(playerA.id, (opponentMapB.get(playerA.id) ?? 0) + 1);
    const teamsMapA = teamsFaced.get(playerA.id) ?? new Map();
    teamsMapA.set(
      playerB.team_id ?? "",
      (teamsMapA.get(playerB.team_id ?? "") ?? 0) + 1,
    );
    const teamsMapB = teamsFaced.get(playerB.id) ?? new Map();
    teamsMapB.set(
      playerA.team_id ?? "",
      (teamsMapB.get(playerA.team_id ?? "") ?? 0) + 1,
    );
    remaining.set(playerA.id, getRemaining(playerA.id) - 1);
    remaining.set(playerB.id, getRemaining(playerB.id) - 1);
    matches.push({ playerA: playerA.id, playerB: playerB.id });
  }

  const appearances = new Map(players.map((player) => [player.id, 0]));
  for (const match of matches) {
    appearances.set(match.playerA, (appearances.get(match.playerA) ?? 0) + 1);
    appearances.set(match.playerB, (appearances.get(match.playerB) ?? 0) + 1);
  }
  if (
    matches.length * 2 !== players.length * roundsPerPlayer ||
    players.some((player) => appearances.get(player.id) !== roundsPerPlayer)
  ) {
    throw new InvalidTdmConfigurationError(
      "A complete cross-team schedule could not be generated for every player.",
    );
  }
  return matches;
};

const buildSeedKey = (seed: string, parts: Array<string | number>) =>
  `${seed}:${parts.join(":")}`;

const normalizeExamples = (examples: CandidateExample[]) =>
  [...examples].sort((a, b) => a.id.localeCompare(b.id));

const buildHistoryRowsFromRounds = (
  sessionId: string,
  rounds: Array<{
    example_id: string;
    player_a_id: string;
    player_b_id: string | null;
  }>,
  now: number,
) => {
  const history: HistoryInsert[] = [];
  for (const round of rounds) {
    history.push({
      session_id: sessionId,
      player_id: round.player_a_id,
      patient_statement_id: round.example_id,
      created_at: now,
    });
    if (round.player_b_id) {
      history.push({
        session_id: sessionId,
        player_id: round.player_b_id,
        patient_statement_id: round.example_id,
        created_at: now,
      });
    }
  }
  return history;
};

const loadUsedPromptHistory = async (
  db: ApiDatabase,
  sessionId: string,
  playerIds: string[],
) => {
  if (!playerIds.length) return new Map<string, Set<string>>();
  const existingRounds = await db
    .select({
      example_id: minigameRounds.example_id,
      player_a_id: minigameRounds.player_a_id,
      player_b_id: minigameRounds.player_b_id,
    })
    .from(minigameRounds)
    .where(eq(minigameRounds.session_id, sessionId));

  if (existingRounds.length) {
    const now = Date.now();
    const historyRows = buildHistoryRowsFromRounds(
      sessionId,
      existingRounds,
      now,
    );
    if (historyRows.length) {
      await db
        .insert(minigamePlayerPromptHistory)
        .values(historyRows)
        .onConflictDoNothing();
    }
  }

  const history = await db
    .select({
      player_id: minigamePlayerPromptHistory.player_id,
      patient_statement_id: minigamePlayerPromptHistory.patient_statement_id,
    })
    .from(minigamePlayerPromptHistory)
    .where(
      and(
        eq(minigamePlayerPromptHistory.session_id, sessionId),
        inArray(minigamePlayerPromptHistory.player_id, playerIds),
      ),
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
  rounds: Array<
    Pick<RoundInsert, "player_a_id" | "player_b_id" | "example_id">
  >,
  now: number,
) => {
  const historyRows: HistoryInsert[] = [];
  for (const round of rounds) {
    historyRows.push({
      session_id: sessionId,
      player_id: round.player_a_id,
      patient_statement_id: round.example_id,
      created_at: now,
    });
    if (round.player_b_id) {
      historyRows.push({
        session_id: sessionId,
        player_id: round.player_b_id,
        patient_statement_id: round.example_id,
        created_at: now,
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
  attempt,
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
  const teamByPlayer = new Map(
    players.map((player) => [player.id, player.team_id ?? null]),
  );
  const normalizedExamples = normalizeExamples(examples);

  if (session.game_type === "tdm") {
    const roundsPerPlayer = Number(
      (session.settings as { rounds_per_player?: number }).rounds_per_player ??
        1,
    );
    if (
      !Number.isInteger(roundsPerPlayer) ||
      roundsPerPlayer < 1 ||
      roundsPerPlayer > MINIGAME_LIMITS.roundsPerPlayer
    ) {
      throw new Error(
        "The rounds-per-player setting is outside the supported range.",
      );
    }
    const matches = generateTdmSchedule(
      players.map((player) => ({
        id: player.id,
        team_id: player.team_id ?? null,
      })),
      roundsPerPlayer,
      seed,
      new Set(teams.map((team) => team.id)),
    );
    for (const match of matches) {
      const usedA = usedByPlayer.get(match.playerA) ?? new Set();
      const usedB = usedByPlayer.get(match.playerB) ?? new Set();
      const seedKey = buildSeedKey(seed, [
        session.id,
        match.playerA,
        match.playerB,
        position,
        attempt,
      ]);
      const example = pickUnusedExampleForPair({
        examples: normalizedExamples,
        usedByPlayerA: usedA,
        usedByPlayerB: usedB,
        seedKey,
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
        completed_at: null,
      });
      position += 1;
    }
  } else {
    if (!players.length) {
      throw new Error("Add at least one player before generating rounds.");
    }
    const totalCount = count ?? 1;
    if (
      !Number.isInteger(totalCount) ||
      totalCount < 1 ||
      totalCount > MINIGAME_LIMITS.ffaRoundBatch
    ) {
      throw new Error(
        "The requested round count is outside the supported range.",
      );
    }
    for (let i = 0; i < totalCount; i += 1) {
      const player = players[i % players.length];
      const used = usedByPlayer.get(player.id) ?? new Set();
      const seedKey = buildSeedKey(seed, [
        session.id,
        player.id,
        position,
        attempt,
      ]);
      const example = pickUnusedExampleForPlayer({
        examples: normalizedExamples,
        usedExampleIds: used,
        seedKey,
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
        completed_at: null,
      });
      position += 1;
    }
  }

  return roundsToInsert;
};

const generateRoundsWithRetries = async ({
  db,
  session,
  count,
  logEvent,
}: {
  db: ApiDatabase;
  session: typeof minigameSessions.$inferSelect;
  count?: number;
  logEvent?: Logger;
}) => {
  const selection = session.task_selection as TaskSelection;
  const tasksForSelection = await resolveMinigameTasks(db, selection);
  if (!tasksForSelection.length) {
    throw new NoAvailableMinigameTasksError();
  }
  const examples = await db
    .select({ id: taskExamples.id, task_id: taskExamples.task_id })
    .from(taskExamples)
    .where(
      inArray(
        taskExamples.task_id,
        tasksForSelection.map((task) => task.id),
      ),
    );

  if (!examples.length) {
    if (session.game_type === "tdm") {
      throw new InvalidTdmConfigurationError(
        "Team-game rounds cannot be generated because the selected tasks have no examples.",
      );
    }
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

  const seed = selection.seed ?? session.id;
  const maxRetries = 3;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const [lastRound] = await db
        .select({ position: minigameRounds.position })
        .from(minigameRounds)
        .where(eq(minigameRounds.session_id, session.id))
        .orderBy(desc(minigameRounds.position))
        .limit(1);
      const startPosition =
        lastRound?.position != null ? lastRound.position + 1 : 0;
      const usedByPlayer = await loadUsedPromptHistory(
        db,
        session.id,
        players.map((player) => player.id),
      );
      const roundsToInsert = buildRoundsForSession({
        session,
        players,
        teams,
        examples,
        startPosition,
        count: session.game_type === "tdm" ? null : (count ?? 1),
        usedByPlayer,
        seed,
        attempt,
      });
      if (!roundsToInsert.length) {
        return { roundCount: 0, retries: attempt };
      }
      const historyRows = buildPromptHistoryRows(
        session.id,
        roundsToInsert,
        Date.now(),
      );
      await runAtomicMutation(db, (executor) => [
        executor.insert(minigamePlayerPromptHistory).values(historyRows),
        executor.insert(minigameRounds).values(roundsToInsert),
      ]);
      logEvent?.("info", "minigames.prompt_history.insert", {
        sessionId: session.id,
        mode: session.game_type,
        rows: historyRows.length,
      });
      if (attempt > 0) {
        logEvent?.("info", "minigames.prompt_history.retry_success", {
          sessionId: session.id,
          retries: attempt,
          mode: session.game_type,
        });
      }
      return { roundCount: roundsToInsert.length, retries: attempt };
    } catch (error) {
      if (error instanceof NoUniquePatientStatementsLeftError) {
        logEvent?.("warn", "minigames.prompt_history.exhausted", {
          sessionId: session.id,
          metadata: error.metadata,
          mode: session.game_type,
        });
        throw error;
      }
      if (isRetryableInsertConflict(error)) {
        logEvent?.("warn", "minigames.prompt_history.conflict", {
          sessionId: session.id,
          attempt,
          mode: session.game_type,
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
  logEvent,
}: {
  db: ApiDatabase;
  session: typeof minigameSessions.$inferSelect;
  count?: number;
  logEvent?: Logger;
}) => generateRoundsWithRetries({ db, session, count, logEvent });

export const redrawMinigameRound = async ({
  db,
  session,
  replacedRoundId,
  logEvent,
}: {
  db: ApiDatabase;
  session: typeof minigameSessions.$inferSelect;
  replacedRoundId: string;
  logEvent?: Logger;
}) => {
  const selection = session.task_selection as TaskSelection;
  const tasksForSelection = await resolveMinigameTasks(db, selection);
  if (!tasksForSelection.length) {
    throw new NoAvailableMinigameTasksError();
  }
  const examples = await db
    .select({ id: taskExamples.id, task_id: taskExamples.task_id })
    .from(taskExamples)
    .where(
      inArray(
        taskExamples.task_id,
        tasksForSelection.map((task) => task.id),
      ),
    );

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

  const playerById = new Map(players.map((player) => [player.id, player]));
  const teamByPlayer = new Map(
    players.map((player) => [player.id, player.team_id ?? null]),
  );
  const validTeamIds = new Set(teams.map((team) => team.id));
  const seed = selection.seed ?? session.id;

  const maxRetries = 3;
  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= maxRetries) {
    try {
      const [replaceableRound] = await db
        .select({
          status: minigameRounds.status,
          player_a_id: minigameRounds.player_a_id,
          player_b_id: minigameRounds.player_b_id,
        })
        .from(minigameRounds)
        .where(
          and(
            eq(minigameRounds.id, replacedRoundId),
            eq(minigameRounds.session_id, session.id),
          ),
        )
        .limit(1);
      if (replaceableRound?.status !== "pending") {
        throw new MinigameRedrawConflictError();
      }
      const playerA = playerById.get(replaceableRound.player_a_id);
      const playerB = replaceableRound.player_b_id
        ? playerById.get(replaceableRound.player_b_id)
        : undefined;
      if (
        !playerA?.team_id ||
        !playerB?.team_id ||
        !validTeamIds.has(playerA.team_id) ||
        !validTeamIds.has(playerB.team_id) ||
        playerA.team_id === playerB.team_id
      ) {
        throw new InvalidTdmConfigurationError(
          "The round being redrawn must contain two current players from different teams in this game.",
        );
      }
      const match = {
        playerA: playerA.id,
        playerB: playerB.id,
      };
      const [lastRound] = await db
        .select({ position: minigameRounds.position })
        .from(minigameRounds)
        .where(eq(minigameRounds.session_id, session.id))
        .orderBy(desc(minigameRounds.position))
        .limit(1);
      const position = lastRound?.position != null ? lastRound.position + 1 : 0;
      const usedByPlayer = await loadUsedPromptHistory(
        db,
        session.id,
        players.map((player) => player.id),
      );
      const usedA = usedByPlayer.get(match.playerA) ?? new Set();
      const usedB = usedByPlayer.get(match.playerB) ?? new Set();
      const seedKey = buildSeedKey(seed, [
        session.id,
        match.playerA,
        match.playerB,
        position,
        attempt,
      ]);
      const example = pickUnusedExampleForPair({
        examples: normalizeExamples(examples),
        usedByPlayerA: usedA,
        usedByPlayerB: usedB,
        seedKey,
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
        completed_at: null,
      };
      const historyRows = buildPromptHistoryRows(
        session.id,
        [round],
        Date.now(),
      );
      await runAtomicMutation(db, (executor) => [
        executor.insert(minigameRedrawClaims).values({
          replaced_round_id: replacedRoundId,
          replacement_round_id: round.id,
          created_at: Date.now(),
        }),
        executor
          .update(minigameRounds)
          .set({ status: "completed", completed_at: Date.now() })
          .where(
            and(
              eq(minigameRounds.id, replacedRoundId),
              eq(minigameRounds.session_id, session.id),
              eq(minigameRounds.status, "pending"),
            ),
          ),
        executor.insert(minigamePlayerPromptHistory).values(historyRows),
        executor.insert(minigameRounds).values(round),
      ]);
      logEvent?.("info", "minigames.prompt_history.insert", {
        sessionId: session.id,
        mode: session.game_type,
        rows: historyRows.length,
      });
      if (attempt > 0) {
        logEvent?.("info", "minigames.prompt_history.retry_success", {
          sessionId: session.id,
          retries: attempt,
          mode: session.game_type,
        });
      }
      return { roundCount: 1, retries: attempt };
    } catch (error) {
      if (error instanceof NoUniquePatientStatementsLeftError) {
        logEvent?.("warn", "minigames.prompt_history.exhausted", {
          sessionId: session.id,
          metadata: error.metadata,
          mode: session.game_type,
        });
        throw error;
      }
      if (isRedrawClaimConflict(error)) {
        throw new MinigameRedrawConflictError();
      }
      if (isRetryableInsertConflict(error)) {
        logEvent?.("warn", "minigames.prompt_history.conflict", {
          sessionId: session.id,
          attempt,
          mode: session.game_type,
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
