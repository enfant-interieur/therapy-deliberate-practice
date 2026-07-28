import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
} from "../../store/api";
import { GameAnalysisPanel } from "./GameAnalysisPanel";
import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type EvaluationDrawerProps = {
  open: boolean;
  rounds: MinigameRound[];
  results: MinigameRoundResult[];
  players: MinigamePlayer[];
  onClose: () => void;
};

export const EvaluationDrawer = ({
  open,
  rounds,
  results,
  players,
  onClose,
}: EvaluationDrawerProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex items-center justify-between">
          <h3 id={titleId} className="text-lg font-semibold text-white">
            {t("minigameUi.reviewEvaluations")}
          </h3>
          <button
            data-dialog-autofocus
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-white/70 hover:border-white/30"
          >
            {t("minigameUi.close")}
          </button>
        </div>
        <div
          className="mt-4 overflow-y-auto pr-2"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <GameAnalysisPanel
            rounds={rounds}
            results={results}
            players={players}
          />
        </div>
      </div>
    </div>
  );
};
