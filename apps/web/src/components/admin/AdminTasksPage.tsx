import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeliberatePracticeTaskV2, Task, TaskCriterion, TaskExample } from "@deliberate/shared";
import { taskSchema } from "@deliberate/shared";
import {
  useCreateTaskMutation,
  useDeleteTaskMutation,
  useDuplicateTaskMutation,
  useGetAdminTaskQuery,
  useGetAdminTasksQuery,
  useImportTaskMutation,
  useParseTaskMutation,
  useUpdateTaskMutation
} from "../../store/api";
import { Card, SectionHeader, Button, Input, Badge } from "./AdminUi";
import { TaskListPanel, type TaskFilters } from "./TaskListPanel";
import { TaskEditorPanel, type EditableTask } from "./TaskEditorPanel";
import { RightInspectorPanel } from "./RightInspectorPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastProvider, useToast } from "./ToastProvider";
import { CreateTaskDialog, type CreateTaskPayload } from "./CreateTaskDialog";
import { ParseTaskDialog } from "./ParseTaskDialog";
import { ImportTaskDialog } from "./ImportTaskDialog";

const toEditableTask = (task: Task & { criteria?: TaskCriterion[]; examples?: TaskExample[] }) => ({
  ...task,
  general_objective: task.general_objective ?? "",
  criteria: task.criteria ?? [],
  examples: task.examples ?? []
});

const serializeTask = (task: EditableTask | null) =>
  task ? JSON.stringify(task) : "";

const defaultFilters: TaskFilters = {
  search: "",
  published: "all",
  skillDomain: "",
  sort: "updated",
  tag: ""
};

type ValidationErrors = {
  task?: Record<string, string>;
  criteria: Record<number, { id?: string; label?: string; description?: string }>;
  examples: Record<number, { id?: string; difficulty?: string; patient_text?: string }>;
};

const validateTask = (task: EditableTask | null, t: (key: string, options?: Record<string, unknown>) => string): ValidationErrors => {
  const errors: ValidationErrors = { criteria: {}, examples: {} };
  if (!task) return errors;

  const taskErrors: Record<string, string> = {};
  if (!task.title.trim()) taskErrors.title = t("admin.validation.required");
  if (!task.skill_domain.trim()) taskErrors.skill_domain = t("admin.validation.required");
  if (!task.description.trim()) taskErrors.description = t("admin.validation.required");
  if (!task.base_difficulty) taskErrors.base_difficulty = t("admin.validation.required");
  if (Object.keys(taskErrors).length) errors.task = taskErrors;

  const criteriaIds = new Set<string>();
  task.criteria.forEach((criterion, index) => {
    const rowErrors: ValidationErrors["criteria"][number] = {};
    if (!criterion.id.trim()) rowErrors.id = t("admin.validation.required");
    if (!criterion.label.trim()) rowErrors.label = t("admin.validation.required");
    if (!criterion.description.trim()) rowErrors.description = t("admin.validation.required");
    if (criterion.id.trim()) {
      if (criteriaIds.has(criterion.id)) {
        rowErrors.id = t("admin.validation.duplicate");
      }
      criteriaIds.add(criterion.id);
    }
    if (Object.keys(rowErrors).length) errors.criteria[index] = rowErrors;
  });

  const exampleIds = new Set<string>();
  task.examples.forEach((example, index) => {
    const rowErrors: ValidationErrors["examples"][number] = {};
    if (!example.id.trim()) rowErrors.id = t("admin.validation.required");
    if (example.difficulty < 1 || example.difficulty > 5) {
      rowErrors.difficulty = t("admin.validation.range", { min: 1, max: 5 });
    }
    if (!example.patient_text.trim()) rowErrors.patient_text = t("admin.validation.required");
    if (example.id.trim()) {
      if (exampleIds.has(example.id)) {
        rowErrors.id = t("admin.validation.duplicate");
      }
      exampleIds.add(example.id);
    }
    if (Object.keys(rowErrors).length) errors.examples[index] = rowErrors;
  });

  return errors;
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

const AdminTasksPageContent = () => {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [draftTask, setDraftTask] = useState<EditableTask | null>(null);
  const [baseTask, setBaseTask] = useState<EditableTask | null>(null);
  const [rightTab, setRightTab] = useState<"preview" | "json" | "meta">("preview");
  const [jsonValue, setJsonValue] = useState("");
  const [jsonEditable, setJsonEditable] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showParse, setShowParse] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: tasks = [], isLoading: tasksLoading } = useGetAdminTasksQuery();
  const { data: selectedTask, isFetching: selectedLoading } = useGetAdminTaskQuery(
    selectedTaskId ?? "",
    { skip: !selectedTaskId }
  );
  const [updateTask, updateState] = useUpdateTaskMutation();
  const [createTask] = useCreateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();
  const [duplicateTask] = useDuplicateTaskMutation();
  const [parseTask, parseState] = useParseTaskMutation();
  const [importTask, importState] = useImportTaskMutation();

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(handle);
  }, [filters.search]);

  useEffect(() => {
    if (selectedTask) {
      const editable = toEditableTask(selectedTask);
      setDraftTask(editable);
      setBaseTask(editable);
      setJsonValue(JSON.stringify(editable, null, 2));
      setJsonError(null);
    }
  }, [selectedTask]);

  useEffect(() => {
    if (!draftTask || jsonEditable) return;
    setJsonValue(JSON.stringify(draftTask, null, 2));
  }, [draftTask, jsonEditable]);

  const serializedBase = useMemo(() => serializeTask(baseTask), [baseTask]);
  const serializedDraft = useMemo(() => serializeTask(draftTask), [draftTask]);
  const isDirty = serializedBase !== serializedDraft;

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const validationErrors = useMemo(() => validateTask(draftTask, t), [draftTask, t]);
  const hasValidationErrors =
    Boolean(validationErrors.task && Object.keys(validationErrors.task).length) ||
    Object.keys(validationErrors.criteria).length > 0 ||
    Object.keys(validationErrors.examples).length > 0;

  const filteredTasks = useMemo(
    () => filterTasks(tasks, { ...filters, search: debouncedSearch }),
    [tasks, filters, debouncedSearch]
  );

  const requestSelectTask = (id: string) => {
    if (isDirty) {
      setPendingTaskId(id);
      setConfirmDiscard(true);
    } else {
      setSelectedTaskId(id);
    }
    setListOpen(false);
  };

  const handleDiscardChanges = () => {
    setConfirmDiscard(false);
    if (pendingTaskId) {
      setSelectedTaskId(pendingTaskId);
      setPendingTaskId(null);
    } else if (baseTask) {
      setDraftTask(baseTask);
    }
  };

  const handleSaveAndContinue = async () => {
    if (hasValidationErrors) {
      pushToast({
        title: t("admin.toast.error"),
        message: t("admin.save.validationError"),
        tone: "error"
      });
      return;
    }
    const saved = await handleSave();
    if (!saved) return;
    setConfirmDiscard(false);
    if (pendingTaskId) {
      setSelectedTaskId(pendingTaskId);
      setPendingTaskId(null);
    }
  };

  const handleSave = async () => {
    if (!draftTask) return false;
    try {
      await updateTask({ id: draftTask.id, task: draftTask }).unwrap();
      setBaseTask(draftTask);
      pushToast({ title: t("admin.toast.saved"), tone: "success" });
      return true;
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
      return false;
    }
  };

  const handleCreate = async (payload: CreateTaskPayload) => {
    try {
      const result = await createTask(payload).unwrap();
      setSelectedTaskId(result.id);
      pushToast({ title: t("admin.toast.created"), tone: "success" });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  const handleDuplicateTask = async () => {
    if (!draftTask) return;
    try {
      const result = await duplicateTask({ id: draftTask.id }).unwrap();
      setSelectedTaskId(result.id);
      pushToast({ title: t("admin.toast.duplicated"), tone: "success" });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  const handleDeleteTask = async () => {
    if (!draftTask) return;
    try {
      await deleteTask({ id: draftTask.id }).unwrap();
      setSelectedTaskId(null);
      setDraftTask(null);
      setBaseTask(null);
      setConfirmDelete(false);
      pushToast({ title: t("admin.toast.deleted"), tone: "success" });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  const handleParse = async (payload: { free_text?: string; source_url?: string }) => {
    try {
      const result = await parseTask(payload).unwrap();
      return result;
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
      return null;
    }
  };

  const handleImport = async (payload: DeliberatePracticeTaskV2) => {
    try {
      await importTask({ task_v2: payload }).unwrap();
      pushToast({ title: t("admin.toast.imported"), tone: "success" });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      const validated = taskSchema.parse(parsed);
      setDraftTask(toEditableTask(validated));
      setJsonError(null);
      pushToast({ title: t("admin.toast.jsonApplied"), tone: "success" });
    } catch (error) {
      setJsonError((error as Error).message);
    }
  };

  const handleValidateJson = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      taskSchema.parse(parsed);
      setJsonError(null);
      pushToast({ title: t("admin.toast.jsonValid"), tone: "success" });
    } catch (error) {
      setJsonError((error as Error).message);
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      setJsonValue(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (error) {
      setJsonError((error as Error).message);
    }
  };

  const selectedStatus = draftTask ? draftTask.id : t("admin.status.none");

  return (
    <div className="min-h-screen space-y-6">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <SectionHeader
            kicker={t("admin.header.kicker")}
            title={t("admin.header.title")}
            subtitle={t("admin.header.subtitle")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-56"
              aria-label={t("admin.searchPlaceholder")}
              placeholder={t("admin.searchPlaceholder")}
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
            <Button variant="secondary" onClick={() => setShowCreate(true)}>
              {t("admin.actions.newTask")}
            </Button>
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              {t("admin.actions.importJson")}
            </Button>
            <Button variant="primary" onClick={() => setShowParse(true)}>
              {t("admin.actions.parseText")}
            </Button>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 pb-4 text-xs text-slate-400">
          <Badge className="border-teal-400/40 text-teal-100">
            {tasksLoading ? t("admin.status.loading") : t("admin.status.ready")}
          </Badge>
          <span>{t("admin.status.selected", { id: selectedStatus })}</span>
          {selectedLoading && <span>{t("admin.status.loadingTask")}</span>}
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-20 md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <div className="hidden lg:block">
          <TaskListPanel
            tasks={filteredTasks}
            selectedTaskId={selectedTaskId}
            filters={filters}
            onFiltersChange={setFilters}
            onSelectTask={requestSelectTask}
            isLoading={tasksLoading}
          />
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between lg:hidden">
            <Button variant="secondary" onClick={() => setListOpen(true)}>
              {t("admin.list.open")}
            </Button>
            {draftTask && (
              <Badge className="border-teal-400/40 text-teal-100">{draftTask.title}</Badge>
            )}
          </div>
          {draftTask ? (
            <TaskEditorPanel
              task={draftTask}
              onChange={setDraftTask}
              onDuplicate={handleDuplicateTask}
              onDelete={() => setConfirmDelete(true)}
              errors={validationErrors}
            />
          ) : (
            <Card className="p-10 text-center text-sm text-slate-400">
              {t("admin.edit.selectPrompt")}
            </Card>
          )}
        </div>

        <div className="hidden md:block">
          <RightInspectorPanel
            task={draftTask}
            activeTab={rightTab}
            onTabChange={setRightTab}
            jsonValue={jsonValue}
            jsonEditable={jsonEditable}
            jsonError={jsonError}
            onJsonChange={setJsonValue}
            onToggleEditable={setJsonEditable}
            onApplyJson={handleApplyJson}
            onFormatJson={handleFormatJson}
            onValidateJson={handleValidateJson}
          />
        </div>
      </div>

      {isDirty && draftTask && (
        <div className="fixed bottom-6 left-1/2 z-40 w-[min(720px,90vw)] -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/90 px-6 py-3 shadow-[0_0_24px_rgba(15,23,42,0.5)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{t("admin.save.unsaved")}</p>
              {hasValidationErrors && (
                <p className="text-xs text-rose-300">{t("admin.save.validationError")}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setDraftTask(baseTask)}>
                {t("admin.actions.discard")}
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={updateState.isLoading || hasValidationErrors}
              >
                {updateState.isLoading ? t("admin.edit.saving") : t("admin.edit.save")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {listOpen && (
        <div className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur lg:hidden">
          <div className="absolute left-0 top-0 h-full w-[320px] bg-slate-950/95 p-4">
            <TaskListPanel
              tasks={filteredTasks}
              selectedTaskId={selectedTaskId}
              filters={filters}
              onFiltersChange={setFilters}
              onSelectTask={requestSelectTask}
              onClose={() => setListOpen(false)}
              isLoading={tasksLoading}
            />
          </div>
        </div>
      )}

      <CreateTaskDialog
        open={showCreate}
        canDuplicate={Boolean(draftTask)}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        onDuplicate={handleDuplicateTask}
      />

      <ParseTaskDialog
        open={showParse}
        onClose={() => setShowParse(false)}
        onParse={handleParse}
        onImport={handleImport}
        isParsing={parseState.isLoading}
        isImporting={importState.isLoading}
      />

      <ImportTaskDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
        isImporting={importState.isLoading}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title={t("admin.confirm.unsavedTitle")}
        description={t("admin.confirm.unsavedDescription")}
        confirmLabel={t("admin.actions.save")}
        secondaryLabel={t("admin.actions.discard")}
        cancelLabel={t("admin.actions.cancel")}
        onConfirm={handleSaveAndContinue}
        onCancel={() => setConfirmDiscard(false)}
        onSecondary={handleDiscardChanges}
        tone="danger"
      />

      <ConfirmDialog
        open={confirmDelete}
        title={t("admin.confirm.deleteTitle")}
        description={t("admin.confirm.deleteDescription", { title: draftTask?.title ?? "" })}
        confirmLabel={t("admin.actions.delete")}
        cancelLabel={t("admin.actions.cancel")}
        onConfirm={handleDeleteTask}
        onCancel={() => setConfirmDelete(false)}
        tone="danger"
      />
    </div>
  );
};

export const AdminTasksPage = () => (
  <ToastProvider>
    <AdminTasksPageContent />
  </ToastProvider>
);
