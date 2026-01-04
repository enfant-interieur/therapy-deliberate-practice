import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type LeaderboardFiltersPanelProps = {
  availableTags: string[];
  availableSkillDomains: string[];
  availableLanguages: string[];
  selectedTags: string[];
  selectedSkillDomain: string | null;
  selectedLanguage: string | null;
  limit: number;
  defaultLimit: number;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  onSkillDomainChange: (value: string | null) => void;
  onLanguageChange: (value: string | null) => void;
  onLimitChange: (value: number) => void;
  onClearAll: () => void;
};

export const LeaderboardFiltersPanel = ({
  availableTags,
  availableSkillDomains,
  availableLanguages,
  selectedTags,
  selectedSkillDomain,
  selectedLanguage,
  limit,
  defaultLimit,
  onToggleTag,
  onClearTags,
  onSkillDomainChange,
  onLanguageChange,
  onLimitChange,
  onClearAll
}: LeaderboardFiltersPanelProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [tagMenuOpen, setTagMenuOpen] = useState(false);

  const filteredTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase();
    const visibleTags = availableTags.filter((tag) => !selectedTags.includes(tag));
    if (!query) return visibleTags;
    return visibleTags.filter((tag) => tag.toLowerCase().includes(query));
  }, [availableTags, selectedTags, tagQuery]);

  const selectedTagsLabel = selectedTags.length
    ? selectedTags.join(", ")
    : t("leaderboard.filters.all");

  const ChevronIcon = ({ open }: { open: boolean }) => (
    <svg
      viewBox="0 0 20 20"
      className={`h-5 w-5 transition ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 shadow-[0_20px_60px_-35px_rgba(15,23,42,0.9)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-400">{t("leaderboard.filters.title")}</p>
          <h2 className="mt-2 text-lg font-semibold text-white">{t("leaderboard.filters.subtitle")}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {t("leaderboard.filters.tags")}: {selectedTagsLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClearAll}
            className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            {t("leaderboard.filters.clear")}
          </button>
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-label={t("leaderboard.filters.title")}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-300 transition hover:border-white/20 hover:text-white"
          >
            <ChevronIcon open={isOpen} />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.9fr_0.9fr_0.7fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-200">{t("leaderboard.filters.tags")}</label>
              {selectedTags.length > 0 && (
                <button
                  type="button"
                  onClick={onClearTags}
                  className="text-xs font-medium text-slate-400 transition hover:text-white"
                >
                  {t("leaderboard.filters.clearTags")}
                </button>
              )}
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 focus-within:ring-2 focus-within:ring-teal-400/70">
              <div className="flex flex-wrap gap-2">
                {selectedTags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 rounded-full border border-teal-300/40 bg-teal-400/20 px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-teal-100"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => onToggleTag(tag)}
                      aria-label={t("leaderboard.filters.clearTags")}
                      className="flex h-4 w-4 items-center justify-center rounded-full text-teal-100 transition hover:bg-teal-400/40"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  onFocus={() => setTagMenuOpen(true)}
                  onBlur={() => setTagMenuOpen(false)}
                  placeholder={t("leaderboard.filters.searchTags")}
                  className="min-w-[160px] flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            </div>
            {tagMenuOpen && (
              <div className="max-h-48 overflow-auto rounded-2xl border border-white/10 bg-slate-950/90 p-2 shadow-lg">
                {filteredTags.length === 0 ? (
                  <span className="block px-2 py-1 text-xs text-slate-500">
                    {t("leaderboard.filters.noTags")}
                  </span>
                ) : (
                  filteredTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onToggleTag(tag);
                        setTagQuery("");
                      }}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      {tag}
                      <span className="text-[10px] text-teal-300">+</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-200" htmlFor="skill-domain-select">
              {t("leaderboard.filters.skillDomain")}
            </label>
            <select
              id="skill-domain-select"
              value={selectedSkillDomain ?? ""}
              onChange={(event) => onSkillDomainChange(event.target.value || null)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
            >
              <option value="">{t("leaderboard.filters.all")}</option>
              {availableSkillDomains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-200" htmlFor="language-select">
              {t("leaderboard.filters.language")}
            </label>
            <select
              id="language-select"
              value={selectedLanguage ?? ""}
              onChange={(event) => onLanguageChange(event.target.value || null)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
            >
              <option value="">{t("leaderboard.filters.all")}</option>
              {availableLanguages.map((language) => (
                <option key={language} value={language}>
                  {language.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-semibold text-slate-200" htmlFor="limit-select">
              {t("leaderboard.filters.limit")}
            </label>
            <select
              id="limit-select"
              value={limit}
              onChange={(event) => onLimitChange(Number(event.target.value))}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
            >
              {[10, 25, 50, 100, 200].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            {limit !== defaultLimit && (
              <p className="text-xs text-slate-500">{t("leaderboard.filters.limitHint")}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
