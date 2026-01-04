import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetLeaderboardQuery, useGetTasksQuery } from "../store/api";
import { LeaderboardFiltersPanel } from "./leaderboard/LeaderboardFiltersPanel";
import { LeaderboardTable } from "./leaderboard/LeaderboardTable";
import { useLeaderboardFilters } from "./leaderboard/useLeaderboardFilters";
import { formatDateTime } from "../utils/scoreFormatters";

export const LeaderboardPage = () => {
  const { t, i18n } = useTranslation();
  const { filters, toggleTag, clearTags, clearAll, setSkillDomain, setLanguage, setLimit, defaultLimit } =
    useLeaderboardFilters();

  const { data: tasks = [] } = useGetTasksQuery({ published: 1 });

  const { availableTags, availableSkillDomains, availableLanguages } = useMemo(() => {
    const tagSet = new Set<string>();
    const skillDomains = new Set<string>();
    const languages = new Set<string>();
    tasks.forEach((task) => {
      task.tags.forEach((tag) => tagSet.add(tag));
      if (task.skill_domain) {
        skillDomains.add(task.skill_domain);
      }
      if (task.language) {
        languages.add(task.language);
      }
    });
    return {
      availableTags: Array.from(tagSet).sort((a, b) => a.localeCompare(b)),
      availableSkillDomains: Array.from(skillDomains).sort((a, b) => a.localeCompare(b)),
      availableLanguages: Array.from(languages).sort((a, b) => a.localeCompare(b))
    };
  }, [tasks]);

  const leaderboardQuery = useMemo(
    () => ({
      tags: filters.tags,
      skill_domain: filters.skillDomain,
      language: filters.language,
      limit: filters.limit
    }),
    [filters]
  );

  const { data: leaderboardData, isLoading } = useGetLeaderboardQuery(leaderboardQuery);
  const generatedAt = leaderboardData?.generated_at ?? null;

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/90 to-slate-900/70 p-8 shadow-[0_30px_120px_-60px_rgba(15,23,42,0.9)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.15),_transparent_60%)]" />
        <div className="relative z-10 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.3em] text-teal-200">
              {t("leaderboard.status")}
            </span>
            {generatedAt && (
              <span className="text-xs text-slate-400">
                {t("leaderboard.updated", {
                  time: formatDateTime(generatedAt, i18n.resolvedLanguage ?? "en")
                })}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-semibold text-white">{t("leaderboard.title")}</h1>
          <p className="max-w-2xl text-sm text-slate-300">{t("leaderboard.subtitle")}</p>
        </div>
      </section>

      <LeaderboardFiltersPanel
        availableTags={availableTags}
        availableSkillDomains={availableSkillDomains}
        availableLanguages={availableLanguages}
        selectedTags={filters.tags}
        selectedSkillDomain={filters.skillDomain}
        selectedLanguage={filters.language}
        limit={filters.limit}
        defaultLimit={defaultLimit}
        onToggleTag={toggleTag}
        onClearTags={clearTags}
        onSkillDomainChange={setSkillDomain}
        onLanguageChange={setLanguage}
        onLimitChange={setLimit}
        onClearAll={clearAll}
      />

      <LeaderboardTable
        entries={leaderboardData?.entries ?? []}
        isLoading={isLoading}
        locale={i18n.resolvedLanguage ?? "en"}
      />
    </div>
  );
};
