import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button, Card, Input, SectionHeader } from "../components/admin/AdminUi";
import { AddTaskChoiceDialog } from "../components/admin/AddTaskChoiceDialog";
import { CreateTaskDialog, type CreateTaskPayload } from "../components/admin/CreateTaskDialog";
import { ImportTaskDialog } from "../components/admin/ImportTaskDialog";
import { ToastProvider, useToast } from "../components/admin/ToastProvider";
import { useCreateTaskMutation, useImportTaskMutation } from "../store/api";
import type { DeliberatePracticeTaskV2 } from "@deliberate/shared";

const AdminPortalPageContent = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showChoice, setShowChoice] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const [createTask] = useCreateTaskMutation();
  const [importTask, importState] = useImportTaskMutation();

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    navigate(`/admin/library${query ? `?q=${encodeURIComponent(query)}` : ""}`);
  };

  const handleCreate = async (payload: CreateTaskPayload) => {
    try {
      const result = await createTask(payload).unwrap();
      pushToast({ title: t("admin.toast.created"), tone: "success" });
      navigate(`/admin/tasks/${result.id}`);
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  const handleImport = async (payload: DeliberatePracticeTaskV2) => {
    try {
      const result = await importTask({ task_v2: payload }).unwrap();
      pushToast({ title: t("admin.toast.imported"), tone: "success" });
      navigate(`/admin/tasks/${result.id}`);
    } catch (error) {
      pushToast({
        title: t("admin.toast.error"),
        message: (error as Error).message,
        tone: "error"
      });
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <SectionHeader
          kicker={t("admin.portal.kicker")}
          title={t("admin.portal.title")}
          subtitle={t("admin.portal.subtitle")}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                  {t("admin.portal.searchKicker")}
                </p>
                <h3 className="text-lg font-semibold text-white">{t("admin.portal.searchTitle")}</h3>
                <p className="text-sm text-slate-400">{t("admin.portal.searchSubtitle")}</p>
              </div>
              <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSearchSubmit}>
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={t("admin.searchPlaceholder")}
                  aria-label={t("admin.searchPlaceholder")}
                />
                <Button type="submit" variant="primary" className="sm:w-[140px]">
                  {t("admin.portal.searchAction")}
                </Button>
              </form>
            </div>
          </Card>

          <Card className="p-6">
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                  {t("admin.portal.quickKicker")}
                </p>
                <h3 className="text-lg font-semibold text-white">{t("admin.portal.quickTitle")}</h3>
                <p className="text-sm text-slate-400">{t("admin.portal.quickSubtitle")}</p>
              </div>
              <div className="flex flex-col gap-3">
                <Button variant="primary" onClick={() => setShowChoice(true)}>
                  {t("admin.portal.addTaskAction")}
                </Button>
                <Button variant="secondary" onClick={() => setShowImport(true)}>
                  {t("admin.actions.importJson")}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <AddTaskChoiceDialog
        open={showChoice}
        onClose={() => setShowChoice(false)}
        onManual={() => {
          setShowChoice(false);
          setShowCreate(true);
        }}
        onParsed={() => {
          setShowChoice(false);
          navigate("/admin/tasks/parse");
        }}
      />

      <CreateTaskDialog
        open={showCreate}
        canDuplicate={false}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
        onDuplicate={() => undefined}
      />

      <ImportTaskDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
        isImporting={importState.isLoading}
      />
    </div>
  );
};

export const AdminPortalPage = () => (
  <ToastProvider>
    <AdminPortalPageContent />
  </ToastProvider>
);
