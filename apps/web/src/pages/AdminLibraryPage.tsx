import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Task } from "@deliberate/shared";
import { Badge, Button, Card, Input, SectionHeader, Select } from "../components/admin/AdminUi";
import { TaskListPanel } from "../components/admin/TaskListPanel";
import { useGetAdminTasksQuery } from "../store/api";

type TaskFilters = {
  search: string;
  published: "all" | "published" | "draft";
  skillDomain: string;
  sort: "updated" | "alpha";
  tag: string;
};

const defaultFilters: TaskFilters = {
  search: "",
  published: "all",
  skillDomain: "",
  sort: "updated",
  tag: ""
};

const filterTasks = (tasks: Task[], filters: TaskFilters) => {
  return tasks
    .filter((task) => task.title.toLowerCase().includes(filters.search.toLowerCase()))
    .filter((task) => {
      if (filters.published === "published") return task.is_published;
      if (filters.published === "draft") return !task.is_published;
      return true;
    })
    .filter((task) => (filters.skillDomain ? task.skill_domain === filters.skillDomain : true))
    .filter((task) => (filters.tag ? task.tags.includes(filters.tag) : true))
    .sort((a, b) => {
      if (filters.sort === "alpha") return a.title.localeCompare(b.title);
      return (b.updated_at ?? 0) - (a.updated_at ?? 0);
    });
};

export const AdminLibraryPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: tasks = [], isLoading } = useGetAdminTasksQuery();

  useEffect(() => {
    const query = searchParams.get("q") ?? "";
    setFilters((prev) => ({ ...prev, search: query }));
  }, [searchParams]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(handle);
  }, [filters.search]);

  const filteredTasks = useMemo(
    () => filterTasks(tasks, { ...filters, search: debouncedSearch }),
    [tasks, filters, debouncedSearch]
  );

  const domainOptions = useMemo(() => {
    const values = new Set<string>();
    tasks.forEach((task) => values.add(task.skill_domain));
    return Array.from(values).sort();
  }, [tasks]);

  const tagOptions = useMemo(() => {
    const values = new Set<string>();
    tasks.forEach((task) => task.tags.forEach((tag) => values.add(tag)));
    return Array.from(values).sort();
  }, [tasks]);

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = filters.search.trim();
    setSearchParams(query ? { q: query } : {});
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SectionHeader
            kicker={t("admin.library.kicker")}
            title={t("admin.library.title")}
            subtitle={t("admin.library.subtitle")}
          />
          <Button variant="secondary" onClick={() => navigate("/admin")}>
            {t("admin.library.backToPortal")}
          </Button>
        </div>

        <Card className="space-y-4 p-6">
          <form className="flex flex-col gap-3 lg:flex-row lg:items-center" onSubmit={handleSearchSubmit}>
            <Input
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              placeholder={t("admin.searchPlaceholder")}
              aria-label={t("admin.searchPlaceholder")}
              className="lg:w-[420px]"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary">
                {t("admin.library.searchAction")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAdvancedOpen((prev) => !prev)}
              >
                {advancedOpen ? t("admin.library.hideAdvanced") : t("admin.library.showAdvanced")}
              </Button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <Badge className="border-teal-400/40 text-teal-100">
              {isLoading ? t("admin.status.loading") : t("admin.status.ready")}
            </Badge>
            <span>{t("admin.library.results", { count: filteredTasks.length })}</span>
          </div>
          {advancedOpen && (
            <div className="grid gap-3 md:grid-cols-4">
              <Select
                value={filters.published}
                onChange={(event) =>
                  setFilters({ ...filters, published: event.target.value as TaskFilters["published"] })
                }
              >
                <option value="all">{t("admin.list.filters.publishedAll")}</option>
                <option value="published">{t("admin.list.filters.published")}</option>
                <option value="draft">{t("admin.list.filters.draft")}</option>
              </Select>
              <Select
                value={filters.skillDomain}
                onChange={(event) => setFilters({ ...filters, skillDomain: event.target.value })}
              >
                <option value="">{t("admin.list.filters.domainAll")}</option>
                {domainOptions.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </Select>
              <Select
                value={filters.tag}
                onChange={(event) => setFilters({ ...filters, tag: event.target.value })}
              >
                <option value="">{t("admin.list.filters.tagAll")}</option>
                {tagOptions.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </Select>
              <Select
                value={filters.sort}
                onChange={(event) =>
                  setFilters({ ...filters, sort: event.target.value as TaskFilters["sort"] })
                }
              >
                <option value="updated">{t("admin.list.filters.sortUpdated")}</option>
                <option value="alpha">{t("admin.list.filters.sortAlpha")}</option>
              </Select>
            </div>
          )}
        </Card>

        <TaskListPanel
          tasks={filteredTasks}
          selectedTaskId={null}
          onSelectTask={(id) => navigate(`/admin/tasks/${id}`)}
          isLoading={isLoading}
        />
      </div>
    </div>
  );
};
