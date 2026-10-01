import { PracticeJourney } from "../components/PracticeJourney";
import { StudioArtwork } from "../components/StudioArtwork";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ActiveFilterChips } from "../components/library/ActiveFilterChips";
import { LibraryAdvancedFilters } from "../components/library/LibraryAdvancedFilters";
import { LibrarySearchBar } from "../components/library/LibrarySearchBar";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import {
  buildLibrarySearchParams,
  defaultLibrarySearchState,
  parseLibrarySearchParams,
} from "./library/searchState";
import {
  useGetTaskLanguagesQuery,
  useGetTaskSkillDomainsQuery,
  useGetTaskTagsQuery,
  useGetTasksQuery,
} from "../store/api";

export const LibraryPage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const parsedState = useMemo(
    () => parseLibrarySearchParams(searchParams),
    [searchParams],
  );
  const [searchState, setSearchState] = useState(parsedState);
  const [draftState, setDraftState] = useState(parsedState);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const debouncedQuery = useDebouncedValue(searchState.q, 300);

  const { data: languagesData } = useGetTaskLanguagesQuery();
  const { data: tagsData } = useGetTaskTagsQuery();
  const { data: skillDomainsData } = useGetTaskSkillDomainsQuery();

  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useGetTasksQuery({
    published: 1,
    q: debouncedQuery || undefined,
    language: searchState.language ?? undefined,
    skill_domain: searchState.skill_domain ?? undefined,
    tags: searchState.tags,
    difficulty_min: searchState.difficulty_min ?? undefined,
    difficulty_max: searchState.difficulty_max ?? undefined,
    sort: searchState.sort,
  });

  useEffect(() => {
    setSearchState(parsedState);
    setDraftState(parsedState);
  }, [parsedState]);

  useEffect(() => {
    const nextParams = buildLibrarySearchParams(searchState);
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, searchState, setSearchParams]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (event.key === "/" && !isInput) {
        event.preventDefault();
        inputRef.current?.focus();
      }

      if (event.key === "Escape") {
        if (isAdvancedOpen) {
          setIsAdvancedOpen(false);
          return;
        }
        if (searchState.q) {
          setSearchState((prev) => ({ ...prev, q: "" }));
          setDraftState((prev) => ({ ...prev, q: "" }));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAdvancedOpen, searchState.q]);

  useEffect(() => {
    if (isAdvancedOpen) {
      setDraftState(searchState);
    }
  }, [isAdvancedOpen, searchState]);

  const languages = languagesData?.languages ?? [];
  const tags = tagsData?.tags ?? [];
  const skillDomains = skillDomainsData?.skill_domains ?? [];
  const libraryReturnTo = `${location.pathname}${location.search}`;

  const handleApplyAdvanced = () => {
    setSearchState(draftState);
  };

  const handleResetAdvanced = () => {
    setDraftState({
      ...defaultLibrarySearchState,
      q: searchState.q,
      language: searchState.language,
    });
  };

  const handleRemoveFilter = (next: Partial<typeof searchState>) => {
    const updated = { ...searchState, ...next };
    setSearchState(updated);
    setDraftState(updated);
  };

  const handleClearAll = () => {
    setSearchState(defaultLibrarySearchState);
    setDraftState(defaultLibrarySearchState);
  };

  return (
    <div className="space-y-6">
      <section className="studio-hero studio-hero--split">
        <div className="studio-hero-intro">
          <div className="studio-hero-copy">
            <p className="studio-eyebrow">{t("studio.library.kicker")}</p>
            <h1 className="studio-heading studio-hero-title mt-4">
              {t("studio.library.title")}
            </h1>
            <p className="mt-5 max-w-xl text-base text-slate-300">
              {t("studio.library.body")}
            </p>
          </div>
          <StudioArtwork
            scene="shelter"
            priority
            className="studio-library-art"
          />
        </div>
        <div className="studio-hero-journey">
          <PracticeJourney />
        </div>
      </section>
      <section className="studio-card p-5 sm:p-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold">{t("library.title")}</h2>
            <p className="text-sm text-slate-300">{t("library.subtitle")}</p>
          </div>
          <div className="studio-library-search min-w-0 w-full lg:max-w-xl">
            <LibrarySearchBar
              ref={inputRef}
              query={searchState.q}
              language={searchState.language}
              languages={languages}
              isAdvancedOpen={isAdvancedOpen}
              onQueryChange={(value) => {
                setSearchState((prev) => ({ ...prev, q: value }));
                setDraftState((prev) => ({ ...prev, q: value }));
              }}
              onLanguageChange={(value) => {
                setSearchState((prev) => ({ ...prev, language: value }));
                setDraftState((prev) => ({ ...prev, language: value }));
              }}
              onClearQuery={() => {
                setSearchState((prev) => ({ ...prev, q: "" }));
                setDraftState((prev) => ({ ...prev, q: "" }));
              }}
              onToggleAdvanced={() => setIsAdvancedOpen((prev) => !prev)}
              onSubmit={() => {
                if (isAdvancedOpen) {
                  handleApplyAdvanced();
                }
              }}
            />
          </div>
        </div>
        <div className="mt-6 space-y-4">
          <ActiveFilterChips
            total={data.length}
            filters={searchState}
            onRemoveFilter={handleRemoveFilter}
            onClearAll={handleClearAll}
          />
          <LibraryAdvancedFilters
            draft={draftState}
            tags={tags}
            skillDomains={skillDomains}
            isOpen={isAdvancedOpen}
            onChange={setDraftState}
            onApply={handleApplyAdvanced}
            onReset={handleResetAdvanced}
          />
        </div>
      </section>
      <section className="grid gap-5 md:grid-cols-2">
        {isLoading &&
          Array.from({ length: 4 }).map((_, index) => (
            <div
              key={`skeleton-${index}`}
              role="status"
              aria-label={t("library.loading")}
              className="h-64 animate-pulse rounded-3xl border border-white/10 bg-slate-900/40 p-6"
            >
              <div className="h-4 w-24 rounded-full bg-slate-800/80" />
              <div className="mt-4 h-6 w-3/4 rounded-full bg-slate-800/80" />
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full rounded-full bg-slate-800/80" />
                <div className="h-3 w-5/6 rounded-full bg-slate-800/80" />
              </div>
              <div className="mt-6 flex gap-2">
                <div className="h-7 w-24 rounded-full bg-slate-800/80" />
                <div className="h-7 w-24 rounded-full bg-slate-800/80" />
              </div>
            </div>
          ))}
        {!isLoading &&
          !isError &&
          data.map((task) => (
            <article
              key={task.id}
              className="studio-card studio-task min-w-0 p-5 sm:p-7"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-xs uppercase tracking-[0.3em] text-teal-300">
                    {task.skill_domain}
                  </p>
                  <h3 className="break-words text-xl font-semibold">
                    {task.title}
                  </h3>
                </div>
                <span className="shrink-0 rounded-full bg-teal-500/10 px-3 py-1 text-xs text-teal-200">
                  {t("library.difficulty", {
                    difficulty: task.base_difficulty,
                  })}
                </span>
              </div>
              <p className="mt-4 break-words text-sm text-slate-300">
                {task.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="max-w-full break-words rounded-full border border-white/10 px-3 py-1 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="studio-task-actions flex flex-wrap gap-3">
                <Link
                  to={`/tasks/${task.id}`}
                  state={{ libraryReturnTo }}
                  className="studio-secondary"
                >
                  {t("library.viewDetails")}
                </Link>
                <Link
                  to={`/practice/${task.id}`}
                  state={{ libraryReturnTo }}
                  className="studio-primary"
                >
                  {t("library.startPractice")}
                </Link>
              </div>
            </article>
          ))}
        {!isLoading && isError && (
          <div
            role="alert"
            className="col-span-full rounded-3xl border border-rose-400/30 bg-rose-950/20 p-8 text-center"
          >
            <p className="font-semibold text-rose-100">
              {t("library.errorState.title")}
            </p>
            <p className="mt-2 text-sm text-rose-200/80">
              {t("library.errorState.subtitle")}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-4 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950"
            >
              {t("library.errorState.retry")}
            </button>
          </div>
        )}
        {!isLoading && !isError && data.length === 0 && (
          <div className="col-span-full rounded-3xl border border-white/10 bg-slate-900/40 p-8 text-center">
            <p className="text-sm text-slate-300">
              {t("library.emptyState.title")}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {t("library.emptyState.subtitle")}
            </p>
            <button
              type="button"
              onClick={handleClearAll}
              className="mt-4 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950"
            >
              {t("library.emptyState.clear")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
