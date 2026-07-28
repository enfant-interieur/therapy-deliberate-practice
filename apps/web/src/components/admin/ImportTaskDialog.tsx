import { useCallback, useState } from "react";
import type { DeliberatePracticeTaskV2 } from "@deliberate/shared";
import { deliberatePracticeTaskV2Schema } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Button, Label, Textarea } from "./AdminUi";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type ImportTaskDialogProps = {
  open: boolean;
  isImporting: boolean;
  onClose: () => void;
  onImport: (payload: DeliberatePracticeTaskV2[]) => Promise<void>;
};

export const ImportTaskDialog = ({
  open,
  isImporting,
  onClose,
  onImport,
}: ImportTaskDialogProps) => {
  const { t } = useTranslation();
  const [jsonValue, setJsonValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    setJsonValue("");
    setError(null);
    onClose();
  }, [onClose]);

  const { dialogRef, titleId } = useAccessibleDialog(open, handleClose);

  if (!open) return null;

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(jsonValue);
      const payloads = Array.isArray(parsed) ? parsed : [parsed];
      const validated = payloads.map((payload) =>
        deliberatePracticeTaskV2Schema.parse(payload),
      );
      await onImport(validated);
      handleClose();
    } catch (err) {
      setError((err as Error).message ?? t("admin.task.invalidJson"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-white">
              {t("admin.import.title")}
            </h3>
            <p className="text-sm text-slate-400">
              {t("admin.import.subtitle")}
            </p>
          </div>
          <Button variant="ghost" onClick={handleClose}>
            {t("admin.actions.close")}
          </Button>
        </div>
        <div className="mt-6 space-y-2">
          <Label htmlFor="import-task-json">
            {t("admin.import.jsonLabel")}
          </Label>
          <Textarea
            id="import-task-json"
            data-dialog-autofocus
            className="min-h-[240px] font-mono text-xs"
            value={jsonValue}
            onChange={(event) => setJsonValue(event.target.value)}
          />
        </div>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={isImporting}
          >
            {isImporting ? t("admin.task.importing") : t("admin.task.import")}
          </Button>
        </div>
      </div>
    </div>
  );
};
