import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampDifficultyRange, type LibrarySearchState, type LibrarySortOption } from "../../pages/library/searchState";

type LibraryAdvancedFiltersProps = {
  draft: LibrarySearchState;
  tags: string[];
  skillDomains: string[];
  isOpen: boolean;
  onChange: (next: LibrarySearchState) => void;
  onApply: () => void;
  onReset: () => void;
};

const difficultyOptions = [1, 2, 3, 4, 5];

const sortOptions: Array<{ value: LibrarySortOption; labelKey: string }> = [
  { value: "newest", labelKey: "library.sort.newest" },
  { value: "oldest", labelKey: "library.sort.oldest" },
  { value: "difficulty_asc", labelKey: "library.sort.difficultyAsc" },
  { value: "difficulty_desc", labelKey: "library.sort.difficultyDesc" },
  { value: "title_asc", labelKey: "library.sort.titleAsc" },
  { value: "title_desc", labelKey: "library.sort.titleDesc" }
];

export const LibraryAdvancedFilters = ({
  draft,
  tags,
  skillDomains,
  isOpen,
  onChange,
  onApply,
  onReset
}: LibraryAdvancedFiltersProps) => {
  const { t } = useTranslation();
  const [tagQuery, setTagQuery] = useState("");

  const filteredTags = useMemo(() => {
    if (!tagQuery.trim()) return tags;
    const lowered = tagQuery.toLowerCase();
    return tags.filter((tag) => tag.toLowerCase().includes(lowered));
  }, [tags, tagQuery]);

  if (!isOpen) {
    return null;
  }

  const toggleTag = (tag: string) => {
    const nextTags = draft.tags.includes(tag)
      ? draft.tags.filter((value) => value !== tag)
      : [...draft.tags, tag];
    onChange({ ...draft, tags: nextTags });
  };

  const updateDifficulty = (field: "difficulty_min" | "difficulty_max", value: string) => {
    const parsed = value ? Number(value) : null;
    const nextValue = Number.isFinite(parsed) ? (parsed as number) : null;
    const next = {
      ...draft,
      [field]: nextValue
    } as LibrarySearchState;
    const clamped = clampDifficultyRange(next.difficulty_min, next.difficulty_max);
    onChange({ ...next, difficulty_min: clamped.min, difficulty_max: clamped.max });
  };

  return (
    <div
      id="library-advanced-panel"
      className="rounded-3xl border border-white/10 bg-slate-900/50 p-6 shadow-lg"
    >
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">{t("library.filters.title")}</h3>
              <p className="text-xs text-slate-400">{t("library.filters.subtitle")}</p>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("library.filters.tags")}
            </label>
            <input
              type="text"
              value={tagQuery}
              onChange={(event) => setTagQuery(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
              placeholder={t("library.filters.searchTags")}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {filteredTags.length === 0 && (
                <span className="text-xs text-slate-500">{t("library.filters.noTags")}</span>
              )}
              {filteredTags.map((tag) => {
                const selected = draft.tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      selected
                        ? "border-teal-400/50 bg-teal-500/20 text-teal-100"
                        : "border-white/10 text-slate-200 hover:border-white/20"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="library-skill-domain" className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("library.filters.skillDomain")}
            </label>
            <select
              id="library-skill-domain"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
              value={draft.skill_domain ?? ""}
              onChange={(event) => onChange({ ...draft, skill_domain: event.target.value || null })}
            >
              <option value="">{t("library.filters.all")}</option>
              {skillDomains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("library.filters.difficulty")}
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <select
                className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
                value={draft.difficulty_min ?? ""}
                onChange={(event) => updateDifficulty("difficulty_min", event.target.value)}
              >
                <option value="">{t("library.filters.min")}</option>
                {difficultyOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
                value={draft.difficulty_max ?? ""}
                onChange={(event) => updateDifficulty("difficulty_max", event.target.value)}
              >
                <option value="">{t("library.filters.max")}</option>
                {difficultyOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="library-sort" className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              {t("library.filters.sort")}
            </label>
            <select
              id="library-sort"
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
              value={draft.sort}
              onChange={(event) => onChange({ ...draft, sort: event.target.value as LibrarySortOption })}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onApply}
          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950"
        >
          {t("library.filters.apply")}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-white/20 px-4 py-2 text-xs text-white"
        >
          {t("library.filters.reset")}
        </button>
      </div>
    </div>
  );
};
