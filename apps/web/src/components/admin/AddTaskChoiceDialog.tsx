import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import { Button, Card } from "./AdminUi";

type AddTaskChoiceDialogProps = {
  open: boolean;
  onClose: () => void;
  onManual: () => void;
  onParsed: () => void;
};

export const AddTaskChoiceDialog = ({
  open,
  onClose,
  onManual,
  onParsed,
}: AddTaskChoiceDialogProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-white">
              {t("admin.portal.addTaskTitle")}
            </h3>
            <p className="text-sm text-slate-400">
              {t("admin.portal.addTaskSubtitle")}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.actions.close")}
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Card className="flex h-full flex-col justify-between gap-4 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                {t("admin.portal.manualKicker")}
              </p>
              <h4 className="text-lg font-semibold text-white">
                {t("admin.portal.manualTitle")}
              </h4>
              <p className="mt-2 text-sm text-slate-400">
                {t("admin.portal.manualDescription")}
              </p>
            </div>
            <Button data-dialog-autofocus variant="primary" onClick={onManual}>
              {t("admin.portal.manualAction")}
            </Button>
          </Card>
          <Card className="flex h-full flex-col justify-between gap-4 p-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                {t("admin.portal.parsedKicker")}
              </p>
              <h4 className="text-lg font-semibold text-white">
                {t("admin.portal.parsedTitle")}
              </h4>
              <p className="mt-2 text-sm text-slate-400">
                {t("admin.portal.parsedDescription")}
              </p>
            </div>
            <Button variant="secondary" onClick={onParsed}>
              {t("admin.portal.parsedAction")}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
};
