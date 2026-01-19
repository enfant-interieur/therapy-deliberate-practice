import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { DeliberatePracticeTaskV2, Task } from "@deliberate/shared";
import { Badge, Button, Card, Input, Label, SectionHeader, Select } from "../components/admin/AdminUi";
import { ConfirmDialog } from "../components/admin/ConfirmDialog";
import { TaskListPanel } from "../components/admin/TaskListPanel";
import { TaskJsonExportModal } from "../components/admin/TaskJsonExportModal";
import { ToastProvider, useToast } from "../components/admin/ToastProvider";
import { useDeleteTaskMutation, useGetAdminTasksQuery, useUpdateTaskMutation } from "../store/api";

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

const toImportPayload = (task: Task): DeliberatePracticeTaskV2 => ({
  version: "2.1",
  task: {
    title: task.title,
    description: task.description,
    skill_domain: task.skill_domain,
    base_difficulty: task.base_difficulty,
    general_objective: task.general_objective ?? undefined,
    tags: task.tags ?? [],
    language: task.language ?? "en"
  },
  criteria: task.criteria ?? [],
  examples: task.examples ?? [],
  interaction_examples: task.interaction_examples?.length ? task.interaction_examples : undefined
});

const AdminLibraryPageContent = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pushToast } = useToast();
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [bulkTag, setBulkTag] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { data: tasks = [], isLoading } = useGetAdminTasksQuery();
  const [updateTask] = useUpdateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();

  useEffect(() => {
    const query = searchParams.get("q") ?? "";
    setFilters((prev) => ({ ...prev, search: query }));
  }, [searchParams]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(handle);
  }, [filters.search]);

  useEffect(() => {
    setSelectedTaskIds((prev) => prev.filter((id) => tasks.some((task) => task.id === id)));
  }, [tasks]);

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

  const selectedTasks = useMemo(
    () => tasks.filter((task) => selectedTaskIds.includes(task.id)),
    [tasks, selectedTaskIds]
  );

  const selectedExportPayload = useMemo(
    () => JSON.stringify(selectedTasks.map(toImportPayload), null, 2),
    [selectedTasks]
  );

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = filters.search.trim();
    setSearchParams(query ? { q: query } : {});
  };

  const handleToggleSelect = (id: string) => {
    setSelectedTaskIds((prev) => (prev.includes(id) ? prev.filter((taskId) => taskId !== id) : [...prev, id]));
  };

  const handleSelectAll = () => {
    const allIds = filteredTasks.map((task) => task.id);
    setSelectedTaskIds((prev) => {
      const hasAll = allIds.every((id) => prev.includes(id));
      return hasAll ? prev.filter((id) => !allIds.includes(id)) : Array.from(new Set([...prev, ...allIds]));
    });
  };

  const handleClearSelection = () => {
    setSelectedTaskIds([]);
  };

  const handleApplyTag = async () => {
    const trimmedTag = bulkTag.trim();
    if (!trimmedTag || !selectedTasks.length) return;
    setBulkBusy(true);
    try {
      await Promise.all(
        selectedTasks.map((task) => {
          const nextTags = Array.from(new Set([...(task.tags ?? []), trimmedTag]));
          return updateTask({ id: task.id, task: { ...task, tags: nextTags } }).unwrap();
        })
      );
      setBulkTag("");
      pushToast({
        title: t("admin.toast.bulkTagsApplied", { count: selectedTasks.length }),
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkBusy(true);
    try {
      await Promise.all(selectedTasks.map((task) => deleteTask({ id: task.id }).unwrap()));
      setSelectedTaskIds([]);
      pushToast({
        title: t("admin.toast.bulkDeleted", { count: selectedTasks.length }),
        tone: "success"
      });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    } finally {
      setBulkBusy(false);
      setConfirmBulkDelete(false);
    }
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

        <Card className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                {t("admin.library.bulk.kicker")}
              </p>
              <h3 className="text-lg font-semibold text-white">{t("admin.library.bulk.title")}</h3>
              <p className="text-sm text-slate-400">
                {t("admin.library.bulk.subtitle", { count: selectedTaskIds.length })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={handleSelectAll} disabled={!filteredTasks.length}>
                {t("admin.library.bulk.selectAll")}
              </Button>
              <Button variant="ghost" onClick={handleClearSelection} disabled={!selectedTaskIds.length}>
                {t("admin.library.bulk.clear")}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <Label>{t("admin.library.bulk.exportLabel")}</Label>
              <p className="text-sm text-slate-400">{t("admin.library.bulk.exportHint")}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => setExportOpen(true)}
                  disabled={!selectedTaskIds.length}
                >
                  {t("admin.library.bulk.exportAction")}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={!selectedTaskIds.length || bulkBusy}
                >
                  {t("admin.library.bulk.deleteAction")}
                </Button>
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/40 p-4">
              <Label>{t("admin.library.bulk.tagLabel")}</Label>
              <p className="text-sm text-slate-400">{t("admin.library.bulk.tagHint")}</p>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={bulkTag}
                  onChange={(event) => setBulkTag(event.target.value)}
                  placeholder={t("admin.library.bulk.tagPlaceholder")}
                  className="min-w-[220px] flex-1"
                />
                <Button
                  variant="secondary"
                  onClick={handleApplyTag}
                  disabled={!bulkTag.trim() || !selectedTaskIds.length || bulkBusy}
                >
                  {t("admin.library.bulk.tagAction")}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <TaskListPanel
          tasks={filteredTasks}
          selectedTaskId={null}
          onSelectTask={(id) => navigate(`/admin/tasks/${id}`)}
          selectedTaskIds={selectedTaskIds}
          onToggleSelect={handleToggleSelect}
          isLoading={isLoading}
        />
      </div>

      <TaskJsonExportModal
        open={exportOpen}
        json={selectedExportPayload}
        onClose={() => setExportOpen(false)}
        onCopy={() => pushToast({ title: t("admin.toast.jsonCopied"), tone: "success" })}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        title={t("admin.library.bulk.deleteTitle")}
        description={t("admin.library.bulk.deleteDescription", { count: selectedTaskIds.length })}
        confirmLabel={t("admin.library.bulk.deleteConfirm")}
        cancelLabel={t("admin.library.bulk.deleteCancel")}
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
        tone="danger"
      />
    </div>
  );
};

export const AdminLibraryPage = () => (
  <ToastProvider>
    <AdminLibraryPageContent />
  </ToastProvider>
);
