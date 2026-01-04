import type { MinigamePlayer, MinigameRound, MinigameRoundResult } from "../../store/api";
import { GameAnalysisPanel } from "./GameAnalysisPanel";

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
  onClose
}: EvaluationDrawerProps) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6">
      <div
        className="mx-auto w-full max-w-4xl rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl backdrop-blur"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Review evaluations</h3>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-white/70 hover:border-white/30"
          >
            Close
          </button>
        </div>
        <div className="mt-4 max-h-[70dvh] overflow-y-auto pr-2" style={{ WebkitOverflowScrolling: "touch" }}>
          <GameAnalysisPanel rounds={rounds} results={results} players={players} />
        </div>
      </div>
    </div>
  );
};
