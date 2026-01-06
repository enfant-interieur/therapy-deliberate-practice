import { forwardRef } from "react";
import { useTranslation } from "react-i18next";

type LibrarySearchBarProps = {
  query: string;
  language: string | null;
  languages: string[];
  isAdvancedOpen: boolean;
  onQueryChange: (value: string) => void;
  onLanguageChange: (value: string | null) => void;
  onClearQuery: () => void;
  onToggleAdvanced: () => void;
  onSubmit?: () => void;
};

export const LibrarySearchBar = forwardRef<HTMLInputElement, LibrarySearchBarProps>(
  (
    {
      query,
      language,
      languages,
      isAdvancedOpen,
      onQueryChange,
      onLanguageChange,
      onClearQuery,
      onToggleAdvanced,
      onSubmit
    },
    ref
  ) => {
    const { t } = useTranslation();

    return (
      <form
        className="flex w-full flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.();
        }}
      >
        <div className="flex w-full items-center gap-2 rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white shadow-lg focus-within:ring-2 focus-within:ring-teal-500/30">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <label htmlFor="library-search-input" className="sr-only">
            {t("library.searchLabel")}
          </label>
          <input
            id="library-search-input"
            ref={ref}
            type="search"
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-400"
            placeholder={t("library.searchPlaceholder")}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-describedby="library-search-help"
          />
          {query && (
            <button
              type="button"
              onClick={onClearQuery}
              className="rounded-full p-1 text-slate-300 transition hover:text-white"
              aria-label={t("library.clearSearch")}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          )}
          <div className="h-6 w-px bg-white/10" aria-hidden="true" />
          <label htmlFor="library-language-select" className="sr-only">
            {t("library.languageLabel")}
          </label>
          <select
            id="library-language-select"
            className="rounded-full bg-slate-900/60 px-3 py-1 text-xs text-slate-200 outline-none"
            value={language ?? ""}
            onChange={(event) => onLanguageChange(event.target.value || null)}
            aria-label={t("library.languageLabel")}
          >
            <option value="">{t("library.languageAll")}</option>
            {languages.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onToggleAdvanced}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-slate-200 transition hover:border-white/20"
            aria-expanded={isAdvancedOpen}
            aria-controls="library-advanced-panel"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M4 7h16" />
              <circle cx="9" cy="7" r="2.5" />
              <path d="M4 17h16" />
              <circle cx="15" cy="17" r="2.5" />
            </svg>
            {t("library.advanced")}
          </button>
        </div>
        <p id="library-search-help" className="sr-only">
          {t("library.searchHelp")}
        </p>
      </form>
    );
  }
);

LibrarySearchBar.displayName = "LibrarySearchBar";
