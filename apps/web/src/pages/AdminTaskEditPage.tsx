import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import type { Task, TaskCriterion, TaskExample } from "@deliberate/shared";
import { taskSchema } from "@deliberate/shared";
import { Button, Card, SectionHeader } from "../components/admin/AdminUi";
import { ConfirmDialog } from "../components/admin/ConfirmDialog";
import { RightInspectorPanel } from "../components/admin/RightInspectorPanel";
import { TaskEditorPanel, type EditableTask } from "../components/admin/TaskEditorPanel";
import { ToastProvider, useToast } from "../components/admin/ToastProvider";
import {
  useDeleteTaskMutation,
  useDuplicateTaskMutation,
  useGetAdminTaskQuery,
  useUpdateTaskMutation
} from "../store/api";

type ValidationErrors = {
  task?: Record<string, string>;
  criteria: Record<number, { id?: string; label?: string; description?: string }>;
  examples: Record<number, { id?: string; difficulty?: string; patient_text?: string }>;
};

const toEditableTask = (task: Task & { criteria?: TaskCriterion[]; examples?: TaskExample[] }): EditableTask => ({
  ...task,
  general_objective: task.general_objective ?? "",
  criteria: task.criteria ?? [],
  examples: task.examples ?? []
});

const serializeTask = (task: EditableTask | null) => (task ? JSON.stringify(task) : "");

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

const AdminTaskEditPageContent = () => {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [draftTask, setDraftTask] = useState<EditableTask | null>(null);
  const [baseTask, setBaseTask] = useState<EditableTask | null>(null);
  const [jsonValue, setJsonValue] = useState("");
  const [jsonEditable, setJsonEditable] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"preview" | "json" | "meta">("preview");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const { data: task, isFetching } = useGetAdminTaskQuery(id ?? "", { skip: !id });
  const [updateTask, updateState] = useUpdateTaskMutation();
  const [deleteTask] = useDeleteTaskMutation();
  const [duplicateTask] = useDuplicateTaskMutation();

  useEffect(() => {
    if (!task) return;
    const editable = toEditableTask(task);
    setDraftTask(editable);
    setBaseTask(editable);
    setJsonValue(JSON.stringify(editable, null, 2));
    setJsonError(null);
    setJsonEditable(false);
  }, [task]);

  useEffect(() => {
    if (!draftTask || jsonEditable) return;
    setJsonValue(JSON.stringify(draftTask, null, 2));
  }, [draftTask, jsonEditable]);

  const validationErrors = useMemo(() => validateTask(draftTask, t), [draftTask, t]);
  const hasValidationErrors =
    Boolean(validationErrors.task && Object.keys(validationErrors.task).length) ||
    Object.keys(validationErrors.criteria).length > 0 ||
    Object.keys(validationErrors.examples).length > 0;

  const isDirty = useMemo(() => serializeTask(baseTask) !== serializeTask(draftTask), [baseTask, draftTask]);

  const handleSave = async () => {
    if (!draftTask) return;
    if (hasValidationErrors) {
      pushToast({ title: t("admin.toast.error"), message: t("admin.save.validationError"), tone: "error" });
      return;
    }
    try {
      await updateTask({ id: draftTask.id, task: draftTask }).unwrap();
      setBaseTask(draftTask);
      pushToast({ title: t("admin.toast.saved"), tone: "success" });
    } catch (error) {
      pushToast({ title: t("admin.toast.error"), message: (error as Error).message, tone: "error" });
    }
  };

  const handleDelete = async () => {
    if (!draftTask) return;
    try {
      await deleteTask({ id: draftTask.id }).unwrap();
      pushToast({ title: t("admin.toast.deleted"), tone: "success" });
      navigate("/admin/library");
    } catch (error) {
      pushToast({ title: t("admin.toast.error"), message: (error as Error).message, tone: "error" });
    }
  };

  const handleDuplicate = async () => {
    if (!draftTask) return;
    try {
      const result = await duplicateTask({ id: draftTask.id }).unwrap();
      pushToast({ title: t("admin.toast.duplicated"), tone: "success" });
      navigate(`/admin/tasks/${result.id}`);
    } catch (error) {
      pushToast({ title: t("admin.toast.error"), message: (error as Error).message, tone: "error" });
    }
  };

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonValue);
      const validated = taskSchema.parse(parsed);
      const editable = toEditableTask(validated);
      setDraftTask(editable);
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

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SectionHeader
            kicker={t("admin.edit.kicker")}
            title={t("admin.edit.pageTitle")}
            subtitle={t("admin.edit.pageSubtitle")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setInspectorOpen(true)} disabled={!draftTask}>
              {t("admin.inspector.kicker")}
            </Button>
            <Button variant="secondary" onClick={() => navigate("/admin/library")}>
              {t("admin.actions.backToLibrary")}
            </Button>
            <Button variant="secondary" onClick={() => setDraftTask(baseTask)} disabled={!isDirty}>
              {t("admin.actions.discard")}
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={updateState.isLoading || hasValidationErrors || !isDirty}
            >
              {updateState.isLoading ? t("admin.edit.saving") : t("admin.edit.save")}
            </Button>
          </div>
        </div>

        {!draftTask && !isFetching && (
          <Card className="p-6 text-center text-sm text-slate-400">
            {t("admin.edit.notFound")}
          </Card>
        )}

        {draftTask && (
          <div className="space-y-6">
            <TaskEditorPanel
              task={draftTask}
              onChange={setDraftTask}
              onDuplicate={handleDuplicate}
              onDelete={() => setConfirmDelete(true)}
              errors={validationErrors}
            />
          </div>
        )}
      </div>

      {inspectorOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/70 backdrop-blur">
          <div className="flex h-full w-full max-w-md flex-col bg-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <p className="text-sm font-semibold text-white">{t("admin.inspector.kicker")}</p>
              <Button variant="ghost" onClick={() => setInspectorOpen(false)}>
                {t("admin.actions.close")}
              </Button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <RightInspectorPanel
                task={draftTask}
                activeTab={activeTab}
                onTabChange={setActiveTab}
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
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={t("admin.confirm.deleteTitle")}
        description={t("admin.confirm.deleteDescription", { title: draftTask?.title ?? "" })}
        confirmLabel={t("admin.actions.delete")}
        cancelLabel={t("admin.actions.cancel")}
        onConfirm={() => {
          setConfirmDelete(false);
          handleDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
        tone="danger"
      />
    </div>
  );
};

export const AdminTaskEditPage = () => (
  <ToastProvider>
    <AdminTaskEditPageContent />
  </ToastProvider>
);
