import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type EndGameLoadingOverlayProps = {
  open: boolean;
  onReturnToHub: () => void;
};

export const EndGameLoadingOverlay = ({
  open,
  onReturnToHub,
}: EndGameLoadingOverlayProps) => {
  const { t } = useTranslation();
  const { dialogRef } = useAccessibleDialog(open);
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-game-loading-title"
      aria-describedby="end-game-loading-description"
      tabIndex={-1}
    >
      <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950/90 p-8 text-center shadow-[0_40px_120px_rgba(15,23,42,0.65)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div className="absolute left-1/2 top-0 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/10 blur-3xl" />

        <div
          className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-white/10 bg-white/5"
          role="status"
          aria-live="polite"
          aria-label={t("minigameUi.endingLabel")}
        >
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-teal-300/40" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-teal-300 border-r-teal-200" />
            <div className="absolute inset-2 animate-pulse rounded-full border border-teal-200/50" />
          </div>
        </div>

        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.4em] text-teal-200/80">
          {t("minigameUi.endingKicker")}
        </p>
        <h2
          id="end-game-loading-title"
          className="mt-3 text-2xl font-semibold text-white"
        >
          {t("minigameUi.endingTitle")}
        </h2>
        <p
          id="end-game-loading-description"
          className="mt-3 text-sm text-slate-300"
        >
          {t("minigameUi.endingDescription")}
        </p>

        <button
          type="button"
          data-dialog-autofocus
          onClick={onReturnToHub}
          className="mt-8 inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-6 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white"
        >
          {t("minigameUi.backToHub")}
        </button>
      </div>
    </div>
  );
};
