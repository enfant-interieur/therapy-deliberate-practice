import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DeliberatePracticeTaskV2,
  ParseMode,
  Task,
  TaskCriterion,
  TaskExample
} from "@deliberate/shared";
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
import { Badge, Button, Card, Input, Label, SectionHeader, Select, Textarea } from "./AdminUi";
import { TaskListPanel } from "./TaskListPanel";
import { TaskEditorPanel, type EditableTask } from "./TaskEditorPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastProvider, useToast } from "./ToastProvider";
import { CreateTaskDialog, type CreateTaskPayload } from "./CreateTaskDialog";
import { ImportTaskDialog } from "./ImportTaskDialog";

const toEditableTask = (task: Task & { criteria?: TaskCriterion[]; examples?: TaskExample[] }): EditableTask => ({
  ...task,
  general_objective: task.general_objective ?? "",
  criteria: task.criteria ?? [],
  examples: task.examples ?? []
});

const createDraftFromParsed = (parsed: DeliberatePracticeTaskV2): EditableTask => ({
  id: `draft-${Date.now()}`,
  slug: "draft",
  title: parsed.task.title,
  description: parsed.task.description,
  skill_domain: parsed.task.skill_domain,
  base_difficulty: parsed.task.base_difficulty,
  general_objective: parsed.task.general_objective ?? "",
  tags: parsed.task.tags ?? [],
  language: parsed.task.language ?? "en",
  is_published: false,
  parent_task_id: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  criteria: parsed.criteria ?? [],
  examples: parsed.examples ?? []
});

const toCreatePayload = (task: EditableTask): CreateTaskPayload => ({
  title: task.title,
  skill_domain: task.skill_domain,
  description: task.description,
  base_difficulty: task.base_difficulty,
  general_objective: task.general_objective ?? "",
  tags: task.tags,
  language: task.language,
  is_published: task.is_published,
  criteria: task.criteria,
  examples: task.examples
});

const serializeTask = (task: EditableTask | null) => (task ? JSON.stringify(task) : "");

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

type AdminLibraryHeaderProps = {
  filters: TaskFilters;
  onFiltersChange: (filters: TaskFilters) => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
  tasksLoading: boolean;
  selectedStatus: string;
  selectedLoading: boolean;
  onCreate: () => void;
  onImport: () => void;
  domainOptions: string[];
  tagOptions: string[];
};

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 20 20"
    className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AdminLibraryHeader = ({
  filters,
  onFiltersChange,
  advancedOpen,
  onToggleAdvanced,
  tasksLoading,
  selectedStatus,
  selectedLoading,
  onCreate,
  onImport,
  domainOptions,
  tagOptions
}: AdminLibraryHeaderProps) => {
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <SectionHeader
          kicker={t("admin.header.kicker")}
          title={t("admin.header.title")}
          subtitle={t("admin.header.subtitle")}
        />
        <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Input
              className="w-full sm:w-[320px] lg:w-[440px]"
              aria-label={t("admin.searchPlaceholder")}
              placeholder={t("admin.searchPlaceholder")}
              value={filters.search}
              onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
            />
            <Button
              variant="secondary"
              type="button"
              className="justify-between gap-2"
              onClick={onToggleAdvanced}
            >
              <span>Advanced</span>
              <ChevronIcon open={advancedOpen} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onCreate}>
              {t("admin.actions.newTask")}
            </Button>
            <Button variant="secondary" onClick={onImport}>
              {t("admin.actions.importJson")}
            </Button>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl space-y-4 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <Badge className="border-teal-400/40 text-teal-100">
            {tasksLoading ? t("admin.status.loading") : t("admin.status.ready")}
          </Badge>
          <span>{t("admin.status.selected", { id: selectedStatus })}</span>
          {selectedLoading && <span>{t("admin.status.loadingTask")}</span>}
        </div>
        {advancedOpen && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Select
                value={filters.published}
                onChange={(event) =>
                  onFiltersChange({
                    ...filters,
                    published: event.target.value as TaskFilters["published"]
                  })
                }
              >
                <option value="all">{t("admin.list.filters.publishedAll")}</option>
                <option value="published">{t("admin.list.filters.published")}</option>
                <option value="draft">{t("admin.list.filters.draft")}</option>
              </Select>
              <Select
                value={filters.skillDomain}
                onChange={(event) => onFiltersChange({ ...filters, skillDomain: event.target.value })}
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
                onChange={(event) => onFiltersChange({ ...filters, tag: event.target.value })}
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
                  onFiltersChange({ ...filters, sort: event.target.value as TaskFilters["sort"] })
                }
              >
                <option value="updated">{t("admin.list.filters.sortUpdated")}</option>
                <option value="alpha">{t("admin.list.filters.sortAlpha")}</option>
              </Select>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

type TaskSummaryCardProps = {
  task: EditableTask | null;
  onOpenInspector: () => void;
};

const TaskSummaryCard = ({ task, onOpenInspector }: TaskSummaryCardProps) => {
  const { t } = useTranslation();

  if (!task) {
    return (
      <Card className="p-6 text-sm text-slate-400">
        <p className="font-semibold text-white">{t("admin.edit.selectPrompt")}</p>
        <p className="mt-2">{t("admin.list.empty")}</p>
      </Card>
    );
  }

  return (
    <Card className="space-y-4 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
          {t("admin.inspector.kicker")}
        </p>
        <h3 className="text-lg font-semibold text-white">{task.title}</h3>
        <p className="text-sm text-slate-400">{task.skill_domain}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge>{t("admin.editor.difficulty", { difficulty: task.base_difficulty })}</Badge>
        <Badge className={task.is_published ? "border-teal-400/40 text-teal-100" : "border-amber-400/40 text-amber-100"}>
          {task.is_published ? t("admin.editor.published") : t("admin.editor.draft")}
        </Badge>
        {task.tags.slice(0, 3).map((tag) => (
          <Badge key={tag}>{tag}</Badge>
        ))}
      </div>
      <p className="text-sm text-slate-300 line-clamp-3">{task.description}</p>
      <Button variant="primary" onClick={onOpenInspector}>
        Open inspector
      </Button>
    </Card>
  );
};

type ParseFromTextPanelProps = {
  freeText: string;
  sourceUrl: string;
  parseMode: ParseMode;
  onFreeTextChange: (value: string) => void;
  onSourceUrlChange: (value: string) => void;
  onParseModeChange: (value: ParseMode) => void;
  onParse: () => void;
  isParsing: boolean;
  error: string | null;
  result: DeliberatePracticeTaskV2 | null;
  jsonPreviewOpen: boolean;
  onTogglePreview: () => void;
  onApplyToEditor: () => void;
  onImport: () => void;
  onReset: () => void;
};

const ParseFromTextPanel = ({
  freeText,
  sourceUrl,
  parseMode,
  onFreeTextChange,
  onSourceUrlChange,
  onParseModeChange,
  onParse,
  isParsing,
  error,
  result,
  jsonPreviewOpen,
  onTogglePreview,
  onApplyToEditor,
  onImport,
  onReset
}: ParseFromTextPanelProps) => {
  const { t } = useTranslation();
  const jsonPreview = useMemo(() => (result ? JSON.stringify(result, null, 2) : ""), [result]);
  const isPartialPrompt = parseMode === "partial_prompt";
  const freeTextLabel = isPartialPrompt
    ? "Instruction prompt"
    : t("admin.createFromText.placeholderText");

  return (
    <Card className="space-y-6 p-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">Parse</p>
        <h3 className="text-lg font-semibold text-white">{t("admin.parse.title")}</h3>
        <p className="text-sm text-slate-400">{t("admin.parse.subtitle")}</p>
      </div>
      <div className="space-y-3">
        <Label>{freeTextLabel}</Label>
        <Textarea
          className="min-h-[260px]"
          value={freeText}
          onChange={(event) => onFreeTextChange(event.target.value)}
          placeholder={t("admin.createFromText.placeholderText")}
        />
        {isPartialPrompt && (
          <p className="text-xs text-slate-400">
            Provide instructions for the task you want generated (not source material to parse).
          </p>
        )}
        <p className="text-xs text-slate-400">{t("admin.parse.subtitle")}</p>
      </div>
      <div className="space-y-2">
        <Label>{t("admin.createFromText.placeholderUrl")}</Label>
        <Input
          value={sourceUrl}
          onChange={(event) => onSourceUrlChange(event.target.value)}
          placeholder="https://"
        />
      </div>
      <div className="space-y-2">
        <Label>Parse mode</Label>
        <Select value={parseMode} onChange={(event) => onParseModeChange(event.target.value as ParseMode)}>
          <option value="original">Original Generation</option>
          <option value="exact">Exact parsing</option>
          <option value="partial_prompt">From partial prompt</option>
        </Select>
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={onParse} disabled={isParsing}>
          {isParsing ? t("admin.createFromText.parsing") : t("admin.createFromText.parse")}
        </Button>
        <Button variant="secondary" onClick={onReset}>
          Reset
        </Button>
      </div>
      {result && (
        <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Review draft</p>
              <p className="text-xs text-slate-400">Confirm before importing or editing.</p>
            </div>
            <Button variant="secondary" onClick={onTogglePreview}>
              {jsonPreviewOpen ? "Hide JSON" : "Show JSON"}
            </Button>
          </div>
          {jsonPreviewOpen && (
            <pre className="mt-4 max-h-56 overflow-auto rounded-xl border border-white/10 bg-slate-950/80 p-3 text-xs text-slate-200">
              {jsonPreview}
            </pre>
          )}
          <p className="mt-3 text-xs text-slate-400">
            Language: {result.task.language ?? "en"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={onApplyToEditor}>
              Apply to editor
            </Button>
            <Button variant="secondary" onClick={onImport}>
              {t("admin.task.import")}
            </Button>
            <Button variant="ghost" onClick={onReset}>
              Reset
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

type ManualJsonPanelProps = {
  jsonValue: string;
  jsonEditable: boolean;
  jsonError: string | null;
  open: boolean;
  onToggle: () => void;
  onJsonChange: (value: string) => void;
  onToggleEditable: (editable: boolean) => void;
  onApplyJson: () => void;
  onFormatJson: () => void;
  onValidateJson: () => void;
  disabled: boolean;
};

const ManualJsonPanel = ({
  jsonValue,
  jsonEditable,
  jsonError,
  open,
  onToggle,
  onJsonChange,
  onToggleEditable,
  onApplyJson,
  onFormatJson,
  onValidateJson,
  disabled
}: ManualJsonPanelProps) => {
  const { t } = useTranslation();

  return (
    <Card className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white">{t("admin.inspector.jsonTitle")}</p>
          <p className="text-xs text-slate-400">{t("admin.inspector.jsonSubtitle")}</p>
        </div>
        <Button variant="secondary" onClick={onToggle}>
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={jsonEditable}
              onChange={(event) => onToggleEditable(event.target.checked)}
              disabled={disabled}
            />
            {t("admin.inspector.editable")}
          </label>
          <Textarea
            className="min-h-[220px] font-mono text-xs"
            value={jsonValue}
            onChange={(event) => onJsonChange(event.target.value)}
            readOnly={!jsonEditable || disabled}
          />
          {jsonError && <p className="text-xs text-rose-300">{jsonError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={onFormatJson} disabled={disabled}>
              {t("admin.inspector.format")}
            </Button>
            <Button type="button" variant="secondary" onClick={onValidateJson} disabled={disabled}>
              {t("admin.inspector.validate")}
            </Button>
            <Button type="button" variant="primary" onClick={onApplyJson} disabled={disabled}>
              {t("admin.inspector.apply")}
            </Button>
          </div>
        </div>
      )}
      {disabled && <p className="text-xs text-slate-500">{t("admin.edit.selectPrompt")}</p>}
    </Card>
  );
};

type TaskInspectorDrawerProps = {
  open: boolean;
  task: EditableTask | null;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: () => void;
  isSaving: boolean;
  hasValidationErrors: boolean;
  errors: ValidationErrors;
  onChange: (task: EditableTask) => void;
};

const TaskInspectorDrawer = ({
  open,
  task,
  onClose,
  onDuplicate,
  onDelete,
  onSave,
  isSaving,
  hasValidationErrors,
  errors,
  onChange
}: TaskInspectorDrawerProps) => {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur">
      <div className="flex h-full w-full max-w-3xl flex-col bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
              {t("admin.inspector.kicker")}
            </p>
            <h2 className="text-lg font-semibold text-white">
              {task ? task.title : t("admin.inspector.empty")}
            </h2>
          </div>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.actions.close")}
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-6">
          {!task && (
            <Card className="p-6 text-center text-sm text-slate-400">
              {t("admin.edit.selectPrompt")}
            </Card>
          )}
          {task && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-400">
                <div className="flex flex-wrap gap-3">
                  <span>{t("admin.inspector.taskId")}: {task.id}</span>
                  <span>{t("admin.inspector.slug")}: {task.slug}</span>
                </div>
              </div>
              <TaskEditorPanel
                task={task}
                onChange={onChange}
                onDuplicate={onDuplicate}
                onDelete={onDelete}
                errors={errors}
              />
            </div>
          )}
        </div>
        <div className="border-t border-white/10 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {hasValidationErrors && (
                <p className="text-xs text-rose-300">{t("admin.save.validationError")}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onClose}>
                {t("admin.actions.close")}
              </Button>
              <Button
                variant="primary"
                onClick={onSave}
                disabled={isSaving || hasValidationErrors || !task}
              >
                {isSaving ? t("admin.edit.saving") : t("admin.edit.save")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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
  const [jsonValue, setJsonValue] = useState("");
  const [jsonEditable, setJsonEditable] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<"existing" | "new">("existing");
  const [parseText, setParseText] = useState("");
  const [parseSourceUrl, setParseSourceUrl] = useState("");
  const [parseMode, setParseMode] = useState<ParseMode>("original");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<DeliberatePracticeTaskV2 | null>(null);
  const [parsePreviewOpen, setParsePreviewOpen] = useState(false);
  const [manualJsonOpen, setManualJsonOpen] = useState(false);

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
      setDraftMode("existing");
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
      if (draftMode === "new") {
        const created = await createTask(toCreatePayload(draftTask)).unwrap();
        setSelectedTaskId(created.id);
        pushToast({ title: t("admin.toast.created"), tone: "success" });
        return true;
      }
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
    if (!draftTask || draftMode === "new") return;
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
    if (draftMode === "new") {
      setSelectedTaskId(null);
      setDraftTask(null);
      setBaseTask(null);
      setConfirmDelete(false);
      setInspectorOpen(false);
      setDraftMode("existing");
      return;
    }
    try {
      await deleteTask({ id: draftTask.id }).unwrap();
      setSelectedTaskId(null);
      setDraftTask(null);
      setBaseTask(null);
      setConfirmDelete(false);
      setInspectorOpen(false);
      pushToast({ title: t("admin.toast.deleted"), tone: "success" });
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  const handleParse = async () => {
    setParseError(null);
    try {
      const result = await parseTask({
        free_text: parseText || undefined,
        source_url: parseSourceUrl || undefined,
        parse_mode: parseMode
      }).unwrap();
      setParseResult(result);
      setParsePreviewOpen(true);
    } catch (error) {
      setParseError((error as Error).message);
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
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

  const handleApplyParsedToEditor = () => {
    if (!parseResult) return;
    const draft = createDraftFromParsed(parseResult);
    setDraftTask(draft);
    setBaseTask(draft);
    setSelectedTaskId(null);
    setDraftMode("new");
    setJsonValue(JSON.stringify(draft, null, 2));
    setJsonEditable(false);
    setJsonError(null);
    setInspectorOpen(true);
  };

  const handleResetParse = () => {
    setParseText("");
    setParseSourceUrl("");
    setParseMode("original");
    setParseError(null);
    setParseResult(null);
    setParsePreviewOpen(false);
  };

  const selectedStatus = draftTask ? draftTask.id : t("admin.status.none");

  return (
    <div className="min-h-screen space-y-6 pb-20">
      <AdminLibraryHeader
        filters={filters}
        onFiltersChange={setFilters}
        advancedOpen={advancedOpen}
        onToggleAdvanced={() => setAdvancedOpen((prev) => !prev)}
        tasksLoading={tasksLoading}
        selectedStatus={selectedStatus}
        selectedLoading={selectedLoading}
        onCreate={() => setShowCreate(true)}
        onImport={() => setShowImport(true)}
        domainOptions={domainOptions}
        tagOptions={tagOptions}
      />

      <div className="mx-auto grid max-w-7xl gap-6 px-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="hidden lg:block">
          <TaskListPanel
            tasks={filteredTasks}
            selectedTaskId={selectedTaskId}
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

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <ParseFromTextPanel
                freeText={parseText}
                sourceUrl={parseSourceUrl}
                parseMode={parseMode}
                onFreeTextChange={setParseText}
                onSourceUrlChange={setParseSourceUrl}
                onParseModeChange={setParseMode}
                onParse={handleParse}
                isParsing={parseState.isLoading}
                error={parseError}
                result={parseResult}
                jsonPreviewOpen={parsePreviewOpen}
                onTogglePreview={() => setParsePreviewOpen((prev) => !prev)}
                onApplyToEditor={handleApplyParsedToEditor}
                onImport={() => parseResult && handleImport(parseResult)}
                onReset={handleResetParse}
              />
              <ManualJsonPanel
                jsonValue={jsonValue}
                jsonEditable={jsonEditable}
                jsonError={jsonError}
                open={manualJsonOpen}
                onToggle={() => setManualJsonOpen((prev) => !prev)}
                onJsonChange={setJsonValue}
                onToggleEditable={setJsonEditable}
                onApplyJson={handleApplyJson}
                onFormatJson={handleFormatJson}
                onValidateJson={handleValidateJson}
                disabled={!draftTask}
              />
            </div>

            <div className="space-y-6">
              <TaskSummaryCard
                task={draftTask}
                onOpenInspector={() => setInspectorOpen(true)}
              />
              <Card className="space-y-4 p-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                    {t("admin.list.kicker")}
                  </p>
                  <h3 className="text-lg font-semibold text-white">{t("admin.list.title")}</h3>
                </div>
                <div className="space-y-2 text-sm text-slate-300">
                  <p>{t("admin.list.count", { count: filteredTasks.length })}</p>
                  <div className="flex flex-wrap gap-2">
                    {filteredTasks.slice(0, 3).map((task) => (
                      <Badge key={task.id}>{task.title}</Badge>
                    ))}
                    {filteredTasks.length > 3 && (
                      <Badge>+{filteredTasks.length - 3}</Badge>
                    )}
                  </div>
                </div>
                <Button variant="secondary" onClick={() => setListOpen(true)}>
                  {t("admin.list.open")}
                </Button>
              </Card>
            </div>
          </div>
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
              onSelectTask={requestSelectTask}
              onClose={() => setListOpen(false)}
              isLoading={tasksLoading}
            />
          </div>
        </div>
      )}

      <TaskInspectorDrawer
        open={inspectorOpen}
        task={draftTask}
        onClose={() => setInspectorOpen(false)}
        onDuplicate={handleDuplicateTask}
        onDelete={() => setConfirmDelete(true)}
        onSave={handleSave}
        isSaving={updateState.isLoading}
        hasValidationErrors={hasValidationErrors}
        errors={validationErrors}
        onChange={setDraftTask}
      />

      <CreateTaskDialog
        open={showCreate}
        canDuplicate={Boolean(draftTask) && draftMode === "existing"}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        onDuplicate={handleDuplicateTask}
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
