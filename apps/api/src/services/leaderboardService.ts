import { and, desc, eq, inArray, like, or, sql, isNotNull } from "drizzle-orm";
import type { ApiDatabase } from "../db/types";
import { attempts, tasks, users } from "../db/schema";

export type LeaderboardQuery = {
  tags: string[];
  skillDomain: string | null;
  language: string | null;
  limit: number;
};

export type LeaderboardEntry = {
  user_id: string;
  display_name: string;
  score: number;
  played: number;
  last_active_at: number | null;
};

const buildTaskFilters = (query: LeaderboardQuery) => {
  const filters = [eq(tasks.is_published, true)];
  if (query.skillDomain) {
    filters.push(eq(tasks.skill_domain, query.skillDomain));
  }
  if (query.language) {
    filters.push(eq(tasks.language, query.language));
  }
  if (query.tags.length > 0) {
    const tagFilters = query.tags.map((tag) => like(tasks.tags, `%"${tag}"%`));
    filters.push(or(...tagFilters));
  }
  return filters;
};

export const buildDisplayName = (email: string | null) => {
  if (!email) {
    return "Anonymous";
  }
  const [prefix, domain] = email.split("@");
  if (!domain) {
    return prefix || "Anonymous";
  }
  if (prefix.length >= 3) {
    return prefix;
  }
  return `${prefix.padEnd(3, "*")}@${domain}`;
};

export const fetchLeaderboardEntries = async (
  db: ApiDatabase,
  query: LeaderboardQuery
): Promise<LeaderboardEntry[]> => {
  const taskFilters = buildTaskFilters(query);
  const taskRows = taskFilters.length
    ? await db.select({ id: tasks.id }).from(tasks).where(and(...taskFilters))
    : await db.select({ id: tasks.id }).from(tasks);
  const taskIds = taskRows.map((row) => row.id);

  if (taskIds.length === 0) {
    return [];
  }

  const attemptFilters = [
    inArray(attempts.task_id, taskIds),
    isNotNull(attempts.completed_at),
    isNotNull(attempts.overall_score)
  ];

  const latestAttemptSubquery = db
    .select({
      user_id: attempts.user_id,
      task_id: attempts.task_id,
      completed_at: sql<number>`max(${attempts.completed_at})`.as("completed_at")
    })
    .from(attempts)
    .where(and(...attemptFilters))
    .groupBy(attempts.user_id, attempts.task_id)
    .as("latest_attempt");

  const latestAttemptCompletedAt = sql<number>`"latest_attempt"."completed_at"`;

  const latestAttempts = db
    .select({
      user_id: attempts.user_id,
      task_id: attempts.task_id,
      completed_at: latestAttemptCompletedAt.as("completed_at"),
      overall_score: sql<number>`max(${attempts.overall_score})`.as("overall_score")
    })
    .from(attempts)
    .innerJoin(
      latestAttemptSubquery,
      and(
        eq(attempts.user_id, latestAttemptSubquery.user_id),
        eq(attempts.task_id, latestAttemptSubquery.task_id),
        eq(attempts.completed_at, latestAttemptCompletedAt)
      )
    )
    .groupBy(attempts.user_id, attempts.task_id, latestAttemptCompletedAt)
    .as("latest_attempts");

  const averageScore = sql<number>`avg(${latestAttempts.overall_score})`;
  const playedCount = sql<number>`count(distinct ${latestAttempts.task_id})`;
  const lastActive = sql<number>`max(${latestAttempts.completed_at})`;

  const rows = await db
    .select({
      user_id: latestAttempts.user_id,
      email: users.email,
      score: averageScore.as("score"),
      played: playedCount.as("played"),
      last_active_at: lastActive.as("last_active_at")
    })
    .from(latestAttempts)
    .innerJoin(users, eq(users.id, latestAttempts.user_id))
    .groupBy(latestAttempts.user_id, users.email)
    .orderBy(desc(averageScore), desc(playedCount), desc(lastActive))
    .limit(query.limit);

  return rows.map((row) => ({
    user_id: row.user_id,
    display_name: buildDisplayName(row.email),
    score: Number(row.score ?? 0),
    played: Number(row.played ?? 0),
    last_active_at: row.last_active_at ?? null
  }));
};
