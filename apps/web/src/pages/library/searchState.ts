export type LibrarySortOption =
  | "newest"
  | "oldest"
  | "difficulty_asc"
  | "difficulty_desc"
  | "title_asc"
  | "title_desc";

export type LibrarySearchState = {
  q: string;
  language: string | null;
  skill_domain: string | null;
  tags: string[];
  difficulty_min: number | null;
  difficulty_max: number | null;
  sort: LibrarySortOption;
};

const sortOptions: LibrarySortOption[] = [
  "newest",
  "oldest",
  "difficulty_asc",
  "difficulty_desc",
  "title_asc",
  "title_desc"
];

export const defaultLibrarySearchState: LibrarySearchState = {
  q: "",
  language: null,
  skill_domain: null,
  tags: [],
  difficulty_min: null,
  difficulty_max: null,
  sort: "newest"
};

const normalizeParam = (value: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
};

const normalizeTags = (tags: string[]) =>
  Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );

const normalizeDifficulty = (value: string | null) => {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.round(parsed);
  if (normalized < 1 || normalized > 5) return null;
  return normalized;
};

export const parseLibrarySearchParams = (searchParams: URLSearchParams): LibrarySearchState => {
  const tags = normalizeTags([
    ...searchParams.getAll("tag"),
    ...(searchParams.get("tags")?.split(",") ?? [])
  ]);
  const sortValue = normalizeParam(searchParams.get("sort"));
  const sort =
    sortValue && sortOptions.includes(sortValue as LibrarySortOption)
      ? (sortValue as LibrarySortOption)
      : "newest";

  return {
    q: normalizeParam(searchParams.get("q")) ?? "",
    language: normalizeParam(searchParams.get("language")),
    skill_domain: normalizeParam(searchParams.get("skill_domain")),
    tags,
    difficulty_min: normalizeDifficulty(searchParams.get("difficulty_min")),
    difficulty_max: normalizeDifficulty(searchParams.get("difficulty_max")),
    sort
  };
};

export const buildLibrarySearchParams = (state: LibrarySearchState) => {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.language) params.set("language", state.language);
  if (state.skill_domain) params.set("skill_domain", state.skill_domain);
  if (state.tags.length > 0) {
    const tags = [...state.tags].sort((a, b) => a.localeCompare(b));
    params.set("tags", tags.join(","));
  }
  if (state.difficulty_min) params.set("difficulty_min", String(state.difficulty_min));
  if (state.difficulty_max) params.set("difficulty_max", String(state.difficulty_max));
  if (state.sort !== "newest") params.set("sort", state.sort);
  return params;
};

export const clampDifficultyRange = (min: number | null, max: number | null) => {
  if (min && max && min > max) {
    return { min: max, max: min };
  }
  return { min, max };
};
