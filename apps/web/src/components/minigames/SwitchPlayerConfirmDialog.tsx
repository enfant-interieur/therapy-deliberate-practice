import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type SwitchPlayerConfirmDialogProps = {
  open: boolean;
  playerName?: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export const SwitchPlayerConfirmDialog = ({
  open,
  playerName,
  onCancel,
  onConfirm,
}: SwitchPlayerConfirmDialogProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(open, onCancel);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl backdrop-blur"
      >
        <h3 id={titleId} className="text-lg font-semibold text-white">
          {t("minigameUi.switchTitle")}
        </h3>
        <p className="mt-2 text-sm text-slate-300">
          {t("minigameUi.switchDescription", {
            player: playerName ?? t("minigameUi.player"),
          })}
        </p>
        <div className="mt-6 flex items-center justify-between">
          <button
            data-dialog-autofocus
            type="button"
            onClick={onCancel}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
          >
            {t("minigameUi.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full border border-teal-300/60 bg-teal-500/30 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 hover:border-teal-200"
          >
            {t("minigameUi.switch")}
          </button>
        </div>
      </div>
    </div>
  );
};
