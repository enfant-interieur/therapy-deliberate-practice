import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { useMemo, type ReactNode } from "react";
import type { ProfileInsights } from "../../store/api";

type SummaryCopy = {
  averageScoreLabel: string;
  averageScoreHelper: string;
  practiceMinutesLabel: string;
  practiceMinutesHelper: string;
  sessionsLabel: string;
  sessionsHelper: (attempts: number) => string;
  streakLabel: string;
  streakValue: (days: number) => string;
  streakHelper: (bestDays: number) => string;
};

type TimelineCopy = {
  title: string;
  subtitle?: string;
  empty: string;
  tooltip: (attempts: number) => string;
};

type DifficultyCopy = {
  title: string;
  subtitle?: string;
  empty: string;
  label: (level: number) => string;
  tooltip: (attempts: number, average: number) => string;
};

type BreakdownCopy = {
  title: string;
  subtitle?: string;
  empty: string;
  tooltip: (attempts: number, average: number) => string;
};

type PracticeCopy = {
  title: string;
  totalAttempts: string;
  averageSession: string;
  currentStreak: string;
  bestStreak: string;
};

type MinigameCopy = {
  title: string;
  sessionsHosted: string;
  roundsCompleted: string;
  players: string;
  avgRounds: string;
  recentTitle: string;
  recentMeta: (rounds: number, players: number, minutes: number) => string;
};

export type ProfileInsightsCopy = {
  summary: SummaryCopy;
  timeline: TimelineCopy;
  difficulty: DifficultyCopy;
  skill: BreakdownCopy;
  tags: BreakdownCopy;
  practice: PracticeCopy;
  minigame: MinigameCopy;
  minigameEmpty: string;
};

type ProfileInsightsSectionProps = {
  heading: string;
  description?: string;
  emptyLabel: string;
  insights?: ProfileInsights;
  loading?: boolean;
  copy: ProfileInsightsCopy;
};

const numberFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
type BreakdownDatum = { label: string; score: number; attempts: number };

const chartTheme = {
  textColor: "#f9fafb",
  fontSize: 12,
  axis: {
    domain: { line: { stroke: "rgba(248,250,252,0.35)", strokeWidth: 1 } },
    ticks: {
      text: { fill: "#f9fafb", fontSize: 11 },
      line: { stroke: "rgba(248,250,252,0.35)", strokeWidth: 1 }
    }
  },
  grid: { line: { stroke: "rgba(148,163,184,0.35)", strokeWidth: 1 } },
  tooltip: {
    container: { background: "rgba(15,23,42,0.94)", color: "#f9fafb", borderRadius: 12, border: "1px solid rgba(248,250,252,0.25)" }
  },
  legends: {
    text: { fill: "#f9fafb", fontSize: 11 }
  }
};

const formatAxisLabel = (label: string, maxChars: number, maxLines: number) => {
  if (!label) return [""];
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const tentative = current ? `${current} ${word}` : word;
    if (tentative.length <= maxChars) {
      current = tentative;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) {
    return lines;
  }
  const truncated = lines.slice(0, maxLines);
  truncated[maxLines - 1] = `${truncated[maxLines - 1]}…`;
  return truncated;
};

const createAxisTickRenderer =
  (maxChars = 20, maxLines = 2) =>
  (tick: { value: string; x: number; y: number }) => {
    const lines = formatAxisLabel(tick.value, maxChars, maxLines);
    return (
      <g transform={`translate(${tick.x},${tick.y})`}>
        {lines.map((line, index) => (
          <text
            key={`${tick.value}-${index}`}
            textAnchor="end"
            dominantBaseline="central"
            fill="#f8fafc"
            fontSize={11}
            fontFamily="inherit"
            y={(index - (lines.length - 1) / 2) * 12}
          >
            {line}
          </text>
        ))}
        <title>{tick.value}</title>
      </g>
    );
  };

const ChartCard = ({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) => (
  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/70 to-slate-900/60 p-5 shadow-[0_35px_120px_-60px_rgba(15,23,42,1)]">
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-50">{title}</p>
        {subtitle && <p className="text-xs text-slate-300">{subtitle}</p>}
      </div>
      <span className="hidden rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-200 sm:inline-flex">
        Data
      </span>
    </div>
    <div className="mt-4 w-full">{children}</div>
  </div>
);

const SummaryCard = ({ label, value, helper }: { label: string; value: string; helper?: string }) => (
  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950/70 via-slate-900/50 to-slate-900/40 p-5 shadow-[0_20px_40px_-45px_rgba(15,23,42,1)]">
    <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-slate-300">{label}</p>
    <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
    {helper && <p className="mt-1 text-xs text-slate-300">{helper}</p>}
  </div>
);

const LoadingState = () => (
  <div className="space-y-4">
    {[...Array(3).keys()].map((idx) => (
      <div key={idx} className="h-24 animate-pulse rounded-2xl bg-slate-800/60" />
    ))}
  </div>
);

export const ProfileInsightsSection = ({ heading, description, emptyLabel, insights, loading, copy }: ProfileInsightsSectionProps) => {
  const timelineSeries = useMemo(() => {
    if (!insights?.score_trend?.length) return null;
    return [
      {
        id: "average_score",
        data: insights.score_trend.map((point) => ({
          x: new Date(point.period_start),
          y: Number(point.average_score.toFixed(2)),
          attempts: point.attempts
        }))
      }
    ];
  }, [insights?.score_trend]);

  const skillBreakdown = useMemo<BreakdownDatum[]>(() => {
    if (!insights?.skill_domain_breakdown?.length) return [];
    return insights.skill_domain_breakdown.map((entry) => ({
      label: entry.label,
      score: Number(entry.average_score.toFixed(2)),
      attempts: entry.attempts
    }));
  }, [insights?.skill_domain_breakdown]);

  const tagBreakdown = useMemo<BreakdownDatum[]>(() => {
    if (!insights?.tag_breakdown?.length) return [];
    return insights.tag_breakdown.slice(0, 8).map((entry) => ({
      label: entry.label,
      score: Number(entry.average_score.toFixed(2)),
      attempts: entry.attempts
    }));
  }, [insights?.tag_breakdown]);

  const difficultyColors = ["#34d399", "#22d3ee", "#38bdf8", "#a5b4fc", "#f472b6"];

  const difficultyData = useMemo(() => {
    if (!insights?.difficulty_mix?.length) return [];
    return insights.difficulty_mix.map((entry, index) => ({
      id: copy.difficulty.label(entry.difficulty),
      label: copy.difficulty.label(entry.difficulty),
      value: entry.attempts,
      level: entry.difficulty,
      average: Number(entry.average_score.toFixed(2)),
      color: difficultyColors[index % difficultyColors.length]
    }));
  }, [copy.difficulty, insights?.difficulty_mix]);

  const hasInsights = Boolean(insights && insights.practice_summary.total_attempts > 0);
  const totalMinutes = insights ? numberFormatter.format(insights.practice_summary.total_minutes) : "0";
  const totalAttemptsValue = insights ? insights.practice_summary.total_attempts : 0;
  const totalAttempts = integerFormatter.format(totalAttemptsValue);
  const sessionCountValue = insights ? insights.practice_summary.sessions : 0;
  const sessionCount = integerFormatter.format(sessionCountValue);
  const streakValue = insights ? copy.summary.streakValue(insights.practice_summary.current_streak_days) : copy.summary.streakValue(0);
  const streakHelper = insights ? copy.summary.streakHelper(insights.practice_summary.best_streak_days) : undefined;
  const sessionsHelper = copy.summary.sessionsHelper(totalAttemptsValue);
  const skillAxisTick = useMemo(() => createAxisTickRenderer(24, 3), []);
  const tagAxisTick = useMemo(() => createAxisTickRenderer(18, 2), []);

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/50 p-6 backdrop-blur">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-teal-200">{heading}</p>
          {description && <p className="mt-1 text-sm text-slate-100">{description}</p>}
        </div>
      </div>
      <div className="mt-6">
        {loading && <LoadingState />}
        {!loading && !hasInsights && <p className="text-sm text-slate-200">{emptyLabel}</p>}
        {!loading && hasInsights && insights && (
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                label={copy.summary.averageScoreLabel}
                value={`${insights.practice_summary.average_attempt_score.toFixed(2)} / 4`}
                helper={copy.summary.averageScoreHelper}
              />
              <SummaryCard
                label={copy.summary.practiceMinutesLabel}
                value={totalMinutes}
                helper={copy.summary.practiceMinutesHelper}
              />
              <SummaryCard label={copy.summary.sessionsLabel} value={sessionCount} helper={sessionsHelper} />
              <SummaryCard label={copy.summary.streakLabel} value={streakValue} helper={streakHelper} />
            </div>
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <ChartCard title={copy.timeline.title} subtitle={copy.timeline.subtitle}>
                  <div className="h-[260px]">
                    {timelineSeries ? (
                      <ResponsiveLine
                        data={timelineSeries}
                        margin={{ top: 20, right: 20, bottom: 40, left: 48 }}
                        xScale={{ type: "time", format: "native", precision: "day" }}
                        xFormat="time:%b %d"
                        yScale={{ type: "linear", min: 0, max: 4, stacked: false }}
                        enablePoints
                        pointSize={8}
                        pointBorderWidth={2}
                        pointColor="#0f172a"
                        pointBorderColor="#34d399"
                        colors={["#22d3ee"]}
                        lineWidth={3}
                        areaOpacity={0.25}
                        enableArea
                        curve="monotoneX"
                        axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 5 }}
                        axisBottom={{
                          tickSize: 0,
                          tickPadding: 12,
                          format: (value) => dateFormatter.format(value as Date)
                        }}
                        useMesh
                        theme={chartTheme}
                        tooltip={({ point }) => {
                          const datum = point.data.data as { attempts?: number } | undefined;
                          const attempts = Number((datum?.attempts ?? (point.data as { attempts?: number }).attempts ?? 0));
                          return (
                            <div className="rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-xl">
                              <p className="font-semibold">{point.data.yFormatted} / 4</p>
                              <p className="text-[11px] text-slate-300">
                                {dateFormatter.format(point.data.x as Date)} · {copy.timeline.tooltip(attempts)}
                              </p>
                            </div>
                          );
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-300">{copy.timeline.empty}</div>
                    )}
                  </div>
                </ChartCard>
              </div>
              <div className="lg:col-span-2">
                <ChartCard title={copy.difficulty.title} subtitle={copy.difficulty.subtitle}>
                  {difficultyData.length > 0 ? (
                    <div className="flex flex-col gap-4">
                      <div className="h-[240px]">
                        <ResponsivePie
                          data={difficultyData}
                          innerRadius={0.6}
                          padAngle={1}
                          cornerRadius={6}
                          enableArcLabels={false}
                          enableArcLinkLabels
                          arcLinkLabelsSkipAngle={8}
                          arcLinkLabelsDiagonalLength={18}
                          arcLinkLabelsStraightLength={12}
                          arcLinkLabelsColor={{ from: "color", modifiers: [["brighter", 1.2]] }}
                          arcLinkLabelsThickness={2}
                          arcLinkLabelsTextColor="#f9fafb"
                          colors={{ datum: "data.color" }}
                          margin={{ top: 32, right: 80, bottom: 32, left: 80 }}
                          theme={chartTheme}
                          borderWidth={1}
                          borderColor="rgba(15,23,42,0.5)"
                          tooltip={({ datum }) => {
                            const level = Number((datum.data as { level?: number }).level ?? 0);
                            return (
                              <div className="rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-xl">
                                <p className="font-semibold">{copy.difficulty.label(level)}</p>
                                <p className="text-[11px] text-slate-300">
                                  {copy.difficulty.tooltip(
                                    Number(datum.value ?? 0),
                                    Number((datum.data as { average?: number }).average ?? 0)
                                  )}
                                </p>
                              </div>
                            );
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-300">{copy.difficulty.empty}</div>
                  )}
                </ChartCard>
              </div>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title={copy.skill.title} subtitle={copy.skill.subtitle}>
                <div className="h-[260px]">
                  {skillBreakdown.length > 0 ? (
                    <ResponsiveBar
                      data={skillBreakdown}
                      keys={["score"]}
                      indexBy="label"
                      layout="horizontal"
                      margin={{ top: 10, right: 20, bottom: 40, left: 220 }}
                      padding={0.5}
                      colors={({ index }) => (index % 2 === 0 ? "#2dd4bf" : "#22d3ee")}
                      enableGridX
                      enableLabel={false}
                      axisBottom={{ tickSize: 0, tickPadding: 10, tickValues: 5 }}
                      axisLeft={{ tickSize: 0, tickPadding: 12, renderTick: skillAxisTick }}
                      theme={chartTheme}
                      tooltip={({ data }) => (
                        <div className="rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-xl">
                          <p className="font-semibold">{data.label}</p>
                          <p className="text-[11px] text-slate-300">
                            {copy.skill.tooltip(
                              Number((data as BreakdownDatum).attempts ?? 0),
                              Number((data as BreakdownDatum).score ?? 0)
                            )}
                          </p>
                        </div>
                      )}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-300">{copy.skill.empty}</div>
                  )}
                </div>
              </ChartCard>
              <ChartCard title={copy.tags.title} subtitle={copy.tags.subtitle}>
                <div className="h-[260px]">
                  {tagBreakdown.length > 0 ? (
                    <ResponsiveBar
                      data={tagBreakdown}
                      keys={["score"]}
                      indexBy="label"
                      layout="horizontal"
                      margin={{ top: 10, right: 20, bottom: 40, left: 200 }}
                      padding={0.5}
                      colors={({ index }) => (index % 2 === 0 ? "#c084fc" : "#a855f7")}
                      enableGridX
                      enableLabel={false}
                      axisBottom={{ tickSize: 0, tickPadding: 10, tickValues: 5 }}
                      axisLeft={{ tickSize: 0, tickPadding: 12, renderTick: tagAxisTick }}
                      theme={chartTheme}
                      tooltip={({ data }) => (
                        <div className="rounded-xl border border-white/10 bg-slate-900/90 px-3 py-2 text-xs text-white shadow-xl">
                          <p className="font-semibold">{data.label}</p>
                          <p className="text-[11px] text-slate-300">
                            {copy.tags.tooltip(
                              Number((data as BreakdownDatum).attempts ?? 0),
                              Number((data as BreakdownDatum).score ?? 0)
                            )}
                          </p>
                        </div>
                      )}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-300">{copy.tags.empty}</div>
                  )}
                </div>
              </ChartCard>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/60 to-slate-900/60 p-5">
                <p className="text-sm font-semibold text-slate-50">{copy.practice.title}</p>
                <dl className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <dt>{copy.practice.totalAttempts}</dt>
                    <dd>{totalAttempts}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>{copy.practice.averageSession}</dt>
                    <dd>{numberFormatter.format(insights.practice_summary.average_session_minutes)} min</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>{copy.practice.currentStreak}</dt>
                    <dd>{copy.summary.streakValue(insights.practice_summary.current_streak_days)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>{copy.practice.bestStreak}</dt>
                    <dd>{copy.summary.streakValue(insights.practice_summary.best_streak_days)}</dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/60 to-slate-900/60 p-5">
                <p className="text-sm font-semibold text-slate-50">{copy.minigame.title}</p>
                <dl className="mt-4 space-y-3 text-sm text-slate-200">
                  <div className="flex items-center justify-between">
                    <dt>{copy.minigame.sessionsHosted}</dt>
                    <dd>{integerFormatter.format(insights.minigame_summary.sessions_hosted)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>{copy.minigame.roundsCompleted}</dt>
                    <dd>{integerFormatter.format(insights.minigame_summary.completed_rounds)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>{copy.minigame.players}</dt>
                    <dd>{integerFormatter.format(insights.minigame_summary.players_hosted)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>{copy.minigame.avgRounds}</dt>
                    <dd>{numberFormatter.format(insights.minigame_summary.average_rounds_per_session)}</dd>
                  </div>
                </dl>
                {insights.minigame_summary.recent_sessions.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-300">{copy.minigame.recentTitle}</p>
                    {insights.minigame_summary.recent_sessions.map((session) => (
                      <div
                        key={session.session_id}
                        className="rounded-xl border border-white/5 bg-slate-900/50 px-3 py-2 text-xs text-slate-300"
                      >
                        <p className="text-white">{dateFormatter.format(new Date(session.started_at))}</p>
                        <p className="text-[11px] text-slate-400">
                          {copy.minigame.recentMeta(session.rounds, session.players, session.duration_minutes)}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-slate-300">{copy.minigameEmpty}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
