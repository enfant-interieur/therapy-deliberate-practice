import type { EvaluationResult, TaskCriterion } from "@deliberate/shared";
import { useEvaluationScore } from "./hooks/useEvaluationScore";

type EvaluationModalProps = {
  open: boolean;
  evaluation: EvaluationResult | null;
  criteria: TaskCriterion[];
  previousScore?: number | null;
  roundScore?: number | null;
  mode: "ffa" | "tdm";
  onClose: () => void;
  onNextRound: () => void;
  onAddPlayer?: () => void;
};

const scoreTone = (score?: number) => {
  if (typeof score !== "number") {
    return "border-white/10 bg-white/5 text-slate-300";
  }
  if (score >= 4) {
    return "border-emerald-400/60 bg-emerald-400/10 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.45)]";
  }
  if (score >= 3) {
    return "border-teal-300/60 bg-teal-400/10 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.45)]";
  }
  if (score >= 2) {
    return "border-amber-300/60 bg-amber-400/10 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.4)]";
  }
  if (score >= 1) {
    return "border-orange-400/60 bg-orange-400/10 text-orange-200 shadow-[0_0_12px_rgba(251,146,60,0.4)]";
  }
  return "border-rose-400/60 bg-rose-400/10 text-rose-200 shadow-[0_0_12px_rgba(248,113,113,0.4)]";
};

const deltaTone = (tone: "positive" | "negative" | "neutral") => {
  if (tone === "positive") {
    return "border-emerald-400/50 bg-emerald-400/10 text-emerald-200";
  }
  if (tone === "negative") {
    return "border-rose-400/50 bg-rose-400/10 text-rose-200";
  }
  return "border-white/10 bg-white/5 text-slate-300";
};

export const EvaluationModal = ({
  open,
  evaluation,
  criteria,
  previousScore,
  roundScore,
  mode,
  onClose,
  onNextRound,
  onAddPlayer
}: EvaluationModalProps) => {
  if (!open || !evaluation) return null;
  const criterionMap = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const { total, delta, tone } = useEvaluationScore(evaluation.criterion_scores, {
    previousScore,
    roundScore
  });

  return (
    <div
      className="fixed inset-0 z-40 overflow-y-auto bg-black/70 p-6"
      onClick={onClose}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div
          className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/95 via-slate-900/90 to-slate-950/95 p-6 shadow-2xl backdrop-blur"
          onClick={(event) => event.stopPropagation()}
          style={{ WebkitOverflowScrolling: "touch" }}
        >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-teal-200/70">Evaluation</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">Performance recap</h3>
            <p className="mt-2 text-sm text-slate-300">{evaluation.overall.summary_feedback}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span
              className={`rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-[0.25em] ${scoreTone(
                evaluation.overall.score
              )}`}
            >
              Round avg {evaluation.overall.score.toFixed(1)}/4
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-200/80">
              Total {total.toFixed(1)}
            </span>
            {delta != null && (
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] ${deltaTone(
                  tone
                )}`}
              >
                {delta > 0 ? "+" : ""}
                {delta.toFixed(1)} vs last round
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {evaluation.overall.what_to_improve_next.map((tip) => (
            <span
              key={tip}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200"
            >
              {tip}
            </span>
          ))}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {evaluation.criterion_scores.map((score) => {
            const criterion = criterionMap.get(score.criterion_id);
            return (
              <div key={score.criterion_id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">
                    {criterion?.label ?? `Criterion ${score.criterion_id}`}
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.25em] text-slate-200/80">
                    {score.score.toFixed(1)}/4
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-300">{score.rationale_short}</p>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
          {mode === "ffa" && onAddPlayer && (
            <button
              type="button"
              onClick={onAddPlayer}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 hover:border-white/30"
            >
              Add new player
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/40"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onNextRound}
            className="rounded-full border border-teal-300/60 bg-teal-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-teal-100 hover:border-teal-200"
          >
            Next round
          </button>
        </div>
        </div>
      </div>
    </div>
  );
};
