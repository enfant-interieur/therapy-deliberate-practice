import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type LeaderboardFilters = {
  tags: string[];
  skillDomain: string | null;
  language: string | null;
  limit: number;
};

const defaultLimit = 50;

const normalizeTags = (tags: string[]) =>
  Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));

export const useLeaderboardFilters = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<LeaderboardFilters>(() => {
    const tags = normalizeTags([
      ...searchParams.getAll("tag"),
      ...(searchParams.get("tags")?.split(",") ?? [])
    ]);
    const skillDomain = searchParams.get("skill_domain") || null;
    const language = searchParams.get("language") || null;
    const limitValue = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitValue) && limitValue > 0 ? limitValue : defaultLimit;

    return {
      tags,
      skillDomain,
      language,
      limit
    };
  }, [searchParams]);

  const updateSearchParams = useCallback(
    (next: Partial<LeaderboardFilters>) => {
      const updated = new URLSearchParams(searchParams);
      const nextTags = next.tags ?? filters.tags;
      updated.delete("tag");
      updated.delete("tags");
      nextTags.forEach((tag) => updated.append("tag", tag));

      const nextSkillDomain = next.skillDomain ?? filters.skillDomain;
      if (nextSkillDomain) {
        updated.set("skill_domain", nextSkillDomain);
      } else {
        updated.delete("skill_domain");
      }

      const nextLanguage = next.language ?? filters.language;
      if (nextLanguage) {
        updated.set("language", nextLanguage);
      } else {
        updated.delete("language");
      }

      const nextLimit = next.limit ?? filters.limit;
      if (nextLimit !== defaultLimit) {
        updated.set("limit", String(nextLimit));
      } else {
        updated.delete("limit");
      }

      setSearchParams(updated, { replace: true });
    },
    [filters, searchParams, setSearchParams]
  );

  const setSkillDomain = useCallback(
    (value: string | null) => {
      updateSearchParams({ skillDomain: value });
    },
    [updateSearchParams]
  );

  const setLanguage = useCallback(
    (value: string | null) => {
      updateSearchParams({ language: value });
    },
    [updateSearchParams]
  );

  const setLimit = useCallback(
    (value: number) => {
      updateSearchParams({ limit: value });
    },
    [updateSearchParams]
  );

  const toggleTag = useCallback(
    (tag: string) => {
      const nextTags = filters.tags.includes(tag)
        ? filters.tags.filter((value) => value !== tag)
        : [...filters.tags, tag];
      updateSearchParams({ tags: nextTags });
    },
    [filters.tags, updateSearchParams]
  );

  const clearTags = useCallback(() => {
    updateSearchParams({ tags: [] });
  }, [updateSearchParams]);

  const clearAll = useCallback(() => {
    updateSearchParams({ tags: [], skillDomain: null, language: null, limit: defaultLimit });
  }, [updateSearchParams]);

  return {
    filters,
    setSkillDomain,
    setLanguage,
    setLimit,
    toggleTag,
    clearTags,
    clearAll,
    defaultLimit
  };
};
