import { useTranslation } from "react-i18next";
import { type LibrarySearchState, type LibrarySortOption } from "../../pages/library/searchState";

type ActiveFilterChipsProps = {
  total: number;
  filters: LibrarySearchState;
  onRemoveFilter: (next: Partial<LibrarySearchState>) => void;
  onClearAll: () => void;
};

const sortLabels: Record<LibrarySortOption, string> = {
  newest: "library.sort.newest",
  oldest: "library.sort.oldest",
  difficulty_asc: "library.sort.difficultyAsc",
  difficulty_desc: "library.sort.difficultyDesc",
  title_asc: "library.sort.titleAsc",
  title_desc: "library.sort.titleDesc"
};

export const ActiveFilterChips = ({ total, filters, onRemoveFilter, onClearAll }: ActiveFilterChipsProps) => {
  const { t } = useTranslation();
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  if (filters.q) {
    chips.push({
      key: "q",
      label: t("library.filters.searchChip", { query: filters.q }),
      onRemove: () => onRemoveFilter({ q: "" })
    });
  }
  if (filters.language) {
    chips.push({
      key: "language",
      label: t("library.filters.languageChip", { language: filters.language.toUpperCase() }),
      onRemove: () => onRemoveFilter({ language: null })
    });
  }
  if (filters.skill_domain) {
    chips.push({
      key: "skill_domain",
      label: t("library.filters.skillChip", { skill: filters.skill_domain }),
      onRemove: () => onRemoveFilter({ skill_domain: null })
    });
  }
  if (filters.tags.length > 0) {
    filters.tags.forEach((tag) => {
      chips.push({
        key: `tag-${tag}`,
        label: t("library.filters.tagChip", { tag }),
        onRemove: () => onRemoveFilter({ tags: filters.tags.filter((value) => value !== tag) })
      });
    });
  }
  if (filters.difficulty_min || filters.difficulty_max) {
    const min = filters.difficulty_min ?? 1;
    const max = filters.difficulty_max ?? 5;
    chips.push({
      key: "difficulty",
      label: t("library.filters.difficultyChip", { min, max }),
      onRemove: () => onRemoveFilter({ difficulty_min: null, difficulty_max: null })
    });
  }
  if (filters.sort !== "newest") {
    chips.push({
      key: "sort",
      label: t("library.filters.sortChip", { sort: t(sortLabels[filters.sort]) }),
      onRemove: () => onRemoveFilter({ sort: "newest" })
    });
  }

  if (chips.length === 0) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
        <span>{t("library.resultsSummary", { count: total })}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{t("library.resultsSummary", { count: total })}</span>
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={chip.onRemove}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-slate-200 transition hover:border-white/30"
          >
            {chip.label}
            <span className="text-slate-400">×</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs text-slate-400 transition hover:text-slate-200"
        >
          {t("library.filters.clearAll")}
        </button>
      </div>
    </div>
  );
};
