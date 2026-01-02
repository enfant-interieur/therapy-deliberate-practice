import { useMemo } from "react";
import type { Task } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, Input, Select } from "./AdminUi";

export type TaskFilters = {
  search: string;
  published: "all" | "published" | "draft";
  skillDomain: string;
  sort: "updated" | "alpha";
  tag: string;
};

type TaskListPanelProps = {
  tasks: Task[];
  selectedTaskId: string | null;
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  onSelectTask: (id: string) => void;
  onClose?: () => void;
  isLoading?: boolean;
};

export const TaskListPanel = ({
  tasks,
  selectedTaskId,
  filters,
  onFiltersChange,
  onSelectTask,
  onClose,
  isLoading
}: TaskListPanelProps) => {
  const { t } = useTranslation();
  const difficultyLabel = (difficulty: number) => {
    if (difficulty <= 2) return t("admin.list.difficulty.easy");
    if (difficulty <= 4) return t("admin.list.difficulty.medium");
    return t("admin.list.difficulty.hard");
  };
  const domains = useMemo(() => {
    const values = new Set<string>();
    tasks.forEach((task) => values.add(task.skill_domain));
    return Array.from(values);
  }, [tasks]);

  const tagOptions = useMemo(() => {
    const values = new Set<string>();
    tasks.forEach((task) => task.tags.forEach((tag) => values.add(tag)));
    return Array.from(values);
  }, [tasks]);

  const updateFilters = (patch: Partial<TaskFilters>) => {
    onFiltersChange({ ...filters, ...patch });
  };

  return (
    <Card className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
            {t("admin.list.kicker")}
          </p>
          <h3 className="text-lg font-semibold text-white">{t("admin.list.title")}</h3>
        </div>
        {onClose && (
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("admin.list.close")}
          </Button>
        )}
      </div>
      <Input
        value={filters.search}
        aria-label={t("admin.searchPlaceholder")}
        placeholder={t("admin.searchPlaceholder")}
        onChange={(event) => updateFilters({ search: event.target.value })}
      />
      <div className="grid gap-3">
        <Select value={filters.published} onChange={(event) => updateFilters({ published: event.target.value as TaskFilters["published"] })}>
          <option value="all">{t("admin.list.filters.publishedAll")}</option>
          <option value="published">{t("admin.list.filters.published")}</option>
          <option value="draft">{t("admin.list.filters.draft")}</option>
        </Select>
        <Select
          value={filters.skillDomain}
          onChange={(event) => updateFilters({ skillDomain: event.target.value })}
        >
          <option value="">{t("admin.list.filters.domainAll")}</option>
          {domains.map((domain) => (
            <option key={domain} value={domain}>
              {domain}
            </option>
          ))}
        </Select>
        <Select value={filters.tag} onChange={(event) => updateFilters({ tag: event.target.value })}>
          <option value="">{t("admin.list.filters.tagAll")}</option>
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </Select>
        <Select value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value as TaskFilters["sort"] })}>
          <option value="updated">{t("admin.list.filters.sortUpdated")}</option>
          <option value="alpha">{t("admin.list.filters.sortAlpha")}</option>
        </Select>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>
          {t("admin.list.count", { count: tasks.length })}
        </span>
        {isLoading && <span>{t("admin.list.loading")}</span>}
      </div>
      <div className="flex-1 space-y-3 overflow-auto pr-1">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
              task.id === selectedTaskId
                ? "border-teal-400/60 bg-teal-500/10"
                : "border-white/10 bg-slate-950/40 hover:border-white/20"
            }`}
            onClick={() => onSelectTask(task.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-white">{task.title}</p>
                <p className="text-xs text-slate-400">{task.skill_domain}</p>
              </div>
              <Badge className="text-[10px]">{difficultyLabel(task.base_difficulty)}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge className={task.is_published ? "border-teal-400/40 text-teal-100" : "border-amber-400/40 text-amber-100"}>
                {task.is_published ? t("admin.list.published") : t("admin.list.draft")}
              </Badge>
              {task.tags.slice(0, 2).map((tag) => (
                <Badge key={`${task.id}-${tag}`} className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {task.tags.length > 2 && (
                <Badge className="text-[10px]">+{task.tags.length - 2}</Badge>
              )}
            </div>
          </button>
        ))}
        {!tasks.length && !isLoading && (
          <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
            {t("admin.list.empty")}
          </div>
        )}
      </div>
    </Card>
  );
};
