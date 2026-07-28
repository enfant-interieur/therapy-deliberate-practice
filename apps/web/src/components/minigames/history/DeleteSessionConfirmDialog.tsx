import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../../hooks/useAccessibleDialog";

type DeleteSessionConfirmDialogProps = {
  open: boolean;
  sessionLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export const DeleteSessionConfirmDialog = ({
  open,
  sessionLabel,
  onConfirm,
  onCancel,
}: DeleteSessionConfirmDialogProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(open, onCancel);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-rose-200/70">
              {t("minigameUi.confirmDelete")}
            </p>
            <h3 id={titleId} className="mt-2 text-xl font-semibold text-white">
              {t("minigameUi.removeSession")}
            </h3>
          </div>
          <button
            data-dialog-autofocus
            onClick={onCancel}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70"
          >
            {t("minigameUi.close")}
          </button>
        </div>
        <p className="mt-4 text-sm text-slate-300">
          {t("minigameUi.removeSessionDescription", {
            session: sessionLabel ?? t("minigameDetail.title"),
          })}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70"
          >
            {t("minigameUi.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-full border border-rose-300/50 bg-rose-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-100"
          >
            {t("minigameUi.deleteSession")}
          </button>
        </div>
      </div>
    </div>
  );
};
