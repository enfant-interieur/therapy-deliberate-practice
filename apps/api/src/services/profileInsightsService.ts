import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { ApiDatabase } from "../db/types";
import {
  attempts,
  minigamePlayers,
  minigameRounds,
  minigameSessions,
  practiceSessions,
  taskExamples,
  tasks
} from "../db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

type AttemptInsightRow = {
  started_at: number;
  completed_at: number | null;
  overall_score: number;
  session_id: string | null;
  skill_domain: string;
  tags: unknown;
  difficulty: number;
};

type PracticeSessionRow = {
  id: string;
  created_at: number;
  ended_at: number | null;
};

type MinigameSessionRow = {
  id: string;
  created_at: number;
  ended_at: number | null;
  last_active_at: number | null;
};

type RoundCountRow = {
  session_id: string;
  count: number;
  completed: number;
};

type PlayerCountRow = {
  session_id: string;
  count: number;
};

export type ProfileInsights = {
  score_trend: Array<{
    period_start: number;
    period_end: number;
    average_score: number;
    attempts: number;
  }>;
  skill_domain_breakdown: Array<{
    label: string;
    average_score: number;
    attempts: number;
  }>;
  tag_breakdown: Array<{
    label: string;
    average_score: number;
    attempts: number;
  }>;
  difficulty_mix: Array<{
    difficulty: number;
    average_score: number;
    attempts: number;
  }>;
  practice_summary: {
    total_attempts: number;
    total_minutes: number;
    sessions: number;
    average_session_minutes: number;
    average_attempt_score: number;
    current_streak_days: number;
    best_streak_days: number;
  };
  minigame_summary: {
    sessions_hosted: number;
    rounds_logged: number;
    completed_rounds: number;
    players_hosted: number;
    average_rounds_per_session: number;
    recent_sessions: Array<{
      session_id: string;
      started_at: number;
      ended_at: number | null;
      duration_minutes: number;
      rounds: number;
      players: number;
    }>;
  };
};

const coerceTags = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((tag) => (typeof tag === "string" ? tag.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => (typeof tag === "string" ? tag.trim() : "")).filter(Boolean);
      }
    } catch (error) {
      return [];
    }
  }
  return [];
};

const startOfWeekUtc = (timestamp: number) => {
  const date = new Date(timestamp);
  const day = date.getUTCDay();
  const diff = (day + 6) % 7; // Monday as start of week
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

const startOfDayUtc = (timestamp: number) => {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

const buildScoreTrend = (attemptRows: AttemptInsightRow[]): ProfileInsights["score_trend"] => {
  const buckets = new Map<number, { totalScore: number; count: number }>();
  attemptRows.forEach((attempt) => {
    if (!attempt.completed_at) return;
    const bucketStart = startOfWeekUtc(attempt.completed_at);
    const bucket = buckets.get(bucketStart) ?? { totalScore: 0, count: 0 };
    bucket.totalScore += attempt.overall_score;
    bucket.count += 1;
    buckets.set(bucketStart, bucket);
  });
  const entries = Array.from(buckets.entries())
    .map(([start, value]) => ({
      period_start: start,
      period_end: start + WEEK_MS,
      average_score: value.count ? value.totalScore / value.count : 0,
      attempts: value.count
    }))
    .sort((a, b) => a.period_start - b.period_start);
  return entries.slice(-12);
};

const buildAverageBreakdown = (
  attemptRows: AttemptInsightRow[],
  selector: (row: AttemptInsightRow) => string
) => {
  const groups = new Map<string, { totalScore: number; count: number }>();
  attemptRows.forEach((row) => {
    const key = selector(row).trim();
    if (!key) return;
    const bucket = groups.get(key) ?? { totalScore: 0, count: 0 };
    bucket.totalScore += row.overall_score;
    bucket.count += 1;
    groups.set(key, bucket);
  });
  return Array.from(groups.entries())
    .map(([label, value]) => ({
      label,
      average_score: value.count ? value.totalScore / value.count : 0,
      attempts: value.count
    }))
    .sort((a, b) => b.attempts - a.attempts || b.average_score - a.average_score);
};

const buildTagBreakdown = (attemptRows: AttemptInsightRow[]): ProfileInsights["tag_breakdown"] => {
  const groups = new Map<string, { totalScore: number; count: number }>();
  attemptRows.forEach((row) => {
    const tags = coerceTags(row.tags);
    tags.forEach((tag) => {
      if (!tag) return;
      const bucket = groups.get(tag) ?? { totalScore: 0, count: 0 };
      bucket.totalScore += row.overall_score;
      bucket.count += 1;
      groups.set(tag, bucket);
    });
  });
  return Array.from(groups.entries())
    .map(([label, value]) => ({
      label,
      average_score: value.count ? value.totalScore / value.count : 0,
      attempts: value.count
    }))
    .sort((a, b) => b.attempts - a.attempts || b.average_score - a.average_score)
    .slice(0, 12);
};

const buildDifficultyMix = (attemptRows: AttemptInsightRow[]): ProfileInsights["difficulty_mix"] => {
  const groups = new Map<number, { totalScore: number; count: number }>();
  attemptRows.forEach((row) => {
    const difficulty = row.difficulty;
    const bucket = groups.get(difficulty) ?? { totalScore: 0, count: 0 };
    bucket.totalScore += row.overall_score;
    bucket.count += 1;
    groups.set(difficulty, bucket);
  });
  return Array.from(groups.entries())
    .map(([difficulty, value]) => ({
      difficulty,
      average_score: value.count ? value.totalScore / value.count : 0,
      attempts: value.count
    }))
    .sort((a, b) => a.difficulty - b.difficulty);
};

const computeStreaks = (days: number[]) => {
  if (days.length === 0) {
    return { best: 0, current: 0 };
  }
  const sorted = Array.from(new Set(days)).sort((a, b) => a - b);
  let best = 1;
  let current = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] === DAY_MS) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 1;
    }
  }

  let rolling = 1;
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    if (sorted[i] - sorted[i - 1] === DAY_MS) {
      rolling += 1;
    } else {
      break;
    }
  }

  return {
    best,
    current: sorted.length === 0 ? 0 : rolling
  };
};

const buildPracticeSummary = (
  attemptRows: AttemptInsightRow[],
  sessions: PracticeSessionRow[]
): ProfileInsights["practice_summary"] => {
  const totalAttempts = attemptRows.length;
  const totalScore = attemptRows.reduce((sum, row) => sum + row.overall_score, 0);
  const totalMinutes = attemptRows.reduce((sum, row) => {
    const completed = row.completed_at ?? row.started_at;
    const duration = Math.max(0, completed - row.started_at);
    return sum + duration / 60000;
  }, 0);
  const days = attemptRows
    .filter((row) => row.completed_at)
    .map((row) => startOfDayUtc(row.completed_at!));
  const streaks = computeStreaks(days);

  const sessionMinutes = sessions.reduce((sum, session) => {
    const endedAt = session.ended_at ?? session.created_at;
    const duration = Math.max(0, endedAt - session.created_at);
    return sum + duration / 60000;
  }, 0);

  return {
    total_attempts: totalAttempts,
    total_minutes: Number(totalMinutes.toFixed(1)),
    sessions: sessions.length,
    average_session_minutes: sessions.length ? Number((sessionMinutes / sessions.length).toFixed(1)) : 0,
    average_attempt_score: totalAttempts ? Number((totalScore / totalAttempts).toFixed(2)) : 0,
    current_streak_days: streaks.current,
    best_streak_days: streaks.best
  };
};

const buildMinigameSummary = (
  sessionRows: MinigameSessionRow[],
  roundCounts: RoundCountRow[],
  playerCounts: PlayerCountRow[]
): ProfileInsights["minigame_summary"] => {
  if (sessionRows.length === 0) {
    return {
      sessions_hosted: 0,
      rounds_logged: 0,
      completed_rounds: 0,
      players_hosted: 0,
      average_rounds_per_session: 0,
      recent_sessions: []
    };
  }

  const roundMap = new Map(roundCounts.map((row) => [row.session_id, row]));
  const playerMap = new Map(playerCounts.map((row) => [row.session_id, row.count]));

  const totalRounds = roundCounts.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const completedRounds = roundCounts.reduce((sum, row) => sum + (row.completed ?? 0), 0);
  const totalPlayers = playerCounts.reduce((sum, row) => sum + (row.count ?? 0), 0);

  const averageRounds = sessionRows.length ? totalRounds / sessionRows.length : 0;

  const recentSessions = [...sessionRows]
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 4)
    .map((session) => {
      const roundInfo = roundMap.get(session.id);
      const rounds = roundInfo?.count ?? 0;
      const players = playerMap.get(session.id) ?? 0;
      const endedAt = session.ended_at ?? session.last_active_at ?? session.created_at;
      const duration = Math.max(0, endedAt - session.created_at);
      return {
        session_id: session.id,
        started_at: session.created_at,
        ended_at: endedAt,
        duration_minutes: Number((duration / 60000).toFixed(1)),
        rounds,
        players
      };
    });

  return {
    sessions_hosted: sessionRows.length,
    rounds_logged: Number(totalRounds),
    completed_rounds: Number(completedRounds),
    players_hosted: Number(totalPlayers),
    average_rounds_per_session: Number(averageRounds.toFixed(1)),
    recent_sessions: recentSessions
  };
};

export const fetchProfileInsights = async (db: ApiDatabase, userId: string): Promise<ProfileInsights> => {
  const attemptRows = await db
    .select({
      started_at: attempts.started_at,
      completed_at: attempts.completed_at,
      overall_score: attempts.overall_score,
      session_id: attempts.session_id,
      skill_domain: tasks.skill_domain,
      tags: tasks.tags,
      difficulty: taskExamples.difficulty
    })
    .from(attempts)
    .innerJoin(tasks, eq(tasks.id, attempts.task_id))
    .innerJoin(taskExamples, eq(taskExamples.id, attempts.example_id))
    .where(and(eq(attempts.user_id, userId), isNotNull(attempts.completed_at)))
    .orderBy(desc(attempts.completed_at))
    .limit(2000);

  const practiceRows = await db
    .select({ id: practiceSessions.id, created_at: practiceSessions.created_at, ended_at: practiceSessions.ended_at })
    .from(practiceSessions)
    .where(eq(practiceSessions.user_id, userId))
    .orderBy(desc(practiceSessions.created_at))
    .limit(1000);

  const minigameSessionsRows = await db
    .select({
      id: minigameSessions.id,
      created_at: minigameSessions.created_at,
      ended_at: minigameSessions.ended_at,
      last_active_at: minigameSessions.last_active_at
    })
    .from(minigameSessions)
    .where(and(eq(minigameSessions.user_id, userId), isNull(minigameSessions.deleted_at)))
    .orderBy(desc(minigameSessions.created_at))
    .limit(200);

  const sessionIds = minigameSessionsRows.map((row) => row.id);

  const roundCounts = sessionIds.length
    ? await db
        .select({
          session_id: minigameRounds.session_id,
          count: sql<number>`count(*)`.as("count"),
          completed: sql<number>`sum(case when ${minigameRounds.status} = 'completed' then 1 else 0 end)`.as(
            "completed"
          )
        })
        .from(minigameRounds)
        .where(inArray(minigameRounds.session_id, sessionIds))
        .groupBy(minigameRounds.session_id)
    : [];

  const playerCounts = sessionIds.length
    ? await db
        .select({
          session_id: minigamePlayers.session_id,
          count: sql<number>`count(*)`.as("count")
        })
        .from(minigamePlayers)
        .where(inArray(minigamePlayers.session_id, sessionIds))
        .groupBy(minigamePlayers.session_id)
    : [];

  return {
    score_trend: buildScoreTrend(attemptRows),
    skill_domain_breakdown: buildAverageBreakdown(attemptRows, (row) => row.skill_domain).slice(0, 6),
    tag_breakdown: buildTagBreakdown(attemptRows),
    difficulty_mix: buildDifficultyMix(attemptRows),
    practice_summary: buildPracticeSummary(attemptRows, practiceRows),
    minigame_summary: buildMinigameSummary(minigameSessionsRows, roundCounts, playerCounts)
  };
};
