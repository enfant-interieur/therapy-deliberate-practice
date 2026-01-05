import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ApiDatabase } from "../db/types";
import {
  minigamePlayers,
  minigameRoundResults,
  minigameRounds,
  minigameSessions,
  minigameTeams
} from "../db/schema";

export type MinigameSessionSummary = {
  id: string;
  game_type: "ffa" | "tdm";
  created_at: number;
  ended_at: number | null;
  last_active_at: number | null;
  current_round_id: string | null;
  current_player_id: string | null;
  progress: {
    completed: number;
    total: number;
  };
  players_count: number;
  teams_count: number;
  winner?: {
    label: string;
    score: number;
    player_id?: string;
    team_id?: string;
  } | null;
};

type ListParams = {
  userId: string;
  status?: "active" | "ended" | "all";
  sort?: "newest" | "oldest" | "recently_active";
};

const hasDbChanges = (result: unknown) => {
  const value = result as {
    rowsAffected?: number;
    changes?: number;
    meta?: { changes?: number };
  };
  const changes = value.rowsAffected ?? value.changes ?? value.meta?.changes ?? 0;
  return Number(changes) > 0;
};

const sortSessions = (sessions: MinigameSessionSummary[], sort?: ListParams["sort"]) => {
  if (sort === "oldest") {
    sessions.sort((a, b) => a.created_at - b.created_at);
    return sessions;
  }
  if (sort === "recently_active") {
    sessions.sort((a, b) => {
      const aScore = a.last_active_at ?? a.created_at;
      const bScore = b.last_active_at ?? b.created_at;
      return bScore - aScore;
    });
    return sessions;
  }
  sessions.sort((a, b) => b.created_at - a.created_at);
  return sessions;
};

export const listMinigameSessions = async (db: ApiDatabase, params: ListParams) => {
  const filters = [eq(minigameSessions.user_id, params.userId), isNull(minigameSessions.deleted_at)];
  if (params.status === "active") {
    filters.push(isNull(minigameSessions.ended_at));
  }
  if (params.status === "ended") {
    filters.push(sql`${minigameSessions.ended_at} IS NOT NULL`);
  }

  const sessions = await db
    .select()
    .from(minigameSessions)
    .where(and(...filters))
    .orderBy(desc(minigameSessions.created_at));

  if (!sessions.length) {
    return [] as MinigameSessionSummary[];
  }

  const sessionIds = sessions.map((session) => session.id);

  const players = await db
    .select({
      id: minigamePlayers.id,
      session_id: minigamePlayers.session_id,
      name: minigamePlayers.name,
      team_id: minigamePlayers.team_id
    })
    .from(minigamePlayers)
    .where(inArray(minigamePlayers.session_id, sessionIds));

  const teams = await db
    .select({
      id: minigameTeams.id,
      session_id: minigameTeams.session_id,
      name: minigameTeams.name
    })
    .from(minigameTeams)
    .where(inArray(minigameTeams.session_id, sessionIds));

  const rounds = await db
    .select({
      session_id: minigameRounds.session_id,
      status: minigameRounds.status
    })
    .from(minigameRounds)
    .where(inArray(minigameRounds.session_id, sessionIds));

  const results = await db
    .select({
      session_id: minigameRounds.session_id,
      player_id: minigameRoundResults.player_id,
      score: minigameRoundResults.overall_score,
      team_id: minigamePlayers.team_id
    })
    .from(minigameRoundResults)
    .leftJoin(minigameRounds, eq(minigameRoundResults.round_id, minigameRounds.id))
    .leftJoin(minigamePlayers, eq(minigameRoundResults.player_id, minigamePlayers.id))
    .where(inArray(minigameRounds.session_id, sessionIds));

  const playerMap = new Map(players.map((player) => [player.id, player]));
  const teamMap = new Map(teams.map((team) => [team.id, team]));

  const playersBySession = new Map<string, number>();
  for (const player of players) {
    playersBySession.set(player.session_id, (playersBySession.get(player.session_id) ?? 0) + 1);
  }

  const teamsBySession = new Map<string, number>();
  for (const team of teams) {
    teamsBySession.set(team.session_id, (teamsBySession.get(team.session_id) ?? 0) + 1);
  }

  const roundTotals = new Map<string, { total: number; completed: number }>();
  for (const round of rounds) {
    const entry = roundTotals.get(round.session_id) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (round.status === "completed") {
      entry.completed += 1;
    }
    roundTotals.set(round.session_id, entry);
  }

  const winners = new Map<string, MinigameSessionSummary["winner"]>();
  const scoresBySessionPlayer = new Map<string, Map<string, number>>();
  const scoresBySessionTeam = new Map<string, Map<string, number>>();

  for (const result of results) {
    if (!result.session_id) continue;
    const playerScores = scoresBySessionPlayer.get(result.session_id) ?? new Map<string, number>();
    playerScores.set(result.player_id, (playerScores.get(result.player_id) ?? 0) + result.score);
    scoresBySessionPlayer.set(result.session_id, playerScores);

    if (result.team_id) {
      const teamScores = scoresBySessionTeam.get(result.session_id) ?? new Map<string, number>();
      teamScores.set(result.team_id, (teamScores.get(result.team_id) ?? 0) + result.score);
      scoresBySessionTeam.set(result.session_id, teamScores);
    }
  }

  for (const session of sessions) {
    if (!session.ended_at) {
      winners.set(session.id, null);
      continue;
    }
    if (session.game_type === "tdm") {
      const teamScores = scoresBySessionTeam.get(session.id) ?? new Map<string, number>();
      let best: { id: string; score: number } | null = null;
      for (const [teamId, score] of teamScores.entries()) {
        if (!best || score > best.score) {
          best = { id: teamId, score };
        }
      }
      if (best) {
        const team = teamMap.get(best.id);
        winners.set(session.id, {
          label: team?.name ?? "Team",
          score: best.score,
          team_id: best.id
        });
      } else {
        winners.set(session.id, null);
      }
    } else {
      const playerScores = scoresBySessionPlayer.get(session.id) ?? new Map<string, number>();
      let best: { id: string; score: number } | null = null;
      for (const [playerId, score] of playerScores.entries()) {
        if (!best || score > best.score) {
          best = { id: playerId, score };
        }
      }
      if (best) {
        const player = playerMap.get(best.id);
        winners.set(session.id, {
          label: player?.name ?? "Player",
          score: best.score,
          player_id: best.id
        });
      } else {
        winners.set(session.id, null);
      }
    }
  }

  const summaries: MinigameSessionSummary[] = sessions.map((session) => {
    const progress = roundTotals.get(session.id) ?? { total: 0, completed: 0 };
    return {
      id: session.id,
      game_type: session.game_type as "ffa" | "tdm",
      created_at: session.created_at,
      ended_at: session.ended_at ?? null,
      last_active_at: session.last_active_at ?? null,
      current_round_id: session.current_round_id ?? null,
      current_player_id: session.current_player_id ?? null,
      progress,
      players_count: playersBySession.get(session.id) ?? 0,
      teams_count: teamsBySession.get(session.id) ?? 0,
      winner: winners.get(session.id) ?? null
    };
  });

  return sortSessions(summaries, params.sort);
};

export const updateMinigameResume = async (
  db: ApiDatabase,
  params: {
    userId: string;
    sessionId: string;
    currentRoundId?: string | null;
    currentPlayerId?: string | null;
    lastActiveAt?: number | null;
  }
) => {
  const now = params.lastActiveAt ?? Date.now();
  const update = {
    last_active_at: now,
    current_round_id: params.currentRoundId ?? null,
    current_player_id: params.currentPlayerId ?? null
  };
  const result = await db
    .update(minigameSessions)
    .set(update)
    .where(
      and(
        eq(minigameSessions.id, params.sessionId),
        eq(minigameSessions.user_id, params.userId),
        isNull(minigameSessions.deleted_at)
      )
    );
  return hasDbChanges(result);
};

export const softDeleteMinigameSession = async (
  db: ApiDatabase,
  params: {
    userId: string;
    sessionId: string;
  }
) => {
  const now = Date.now();
  const result = await db
    .update(minigameSessions)
    .set({
      deleted_at: now,
      ended_at: sql`coalesce(${minigameSessions.ended_at}, ${now})`
    })
    .where(
      and(
        eq(minigameSessions.id, params.sessionId),
        eq(minigameSessions.user_id, params.userId),
        isNull(minigameSessions.deleted_at)
      )
    );
  return hasDbChanges(result);
};
