import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
  MinigameTeam
} from "../../store/api";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { GameAnalysisPanel } from "./GameAnalysisPanel";
import type { WinnerSummary } from "./utils/computeWinner";

type EndGameResultsOverlayProps = {
  open: boolean;
  mode: "ffa" | "tdm";
  players: MinigamePlayer[];
  teams: MinigameTeam[];
  rounds: MinigameRound[];
  results: MinigameRoundResult[];
  winner: WinnerSummary | null;
  onClose: () => void;
};

const focusableSelector =
  "a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])";

export const EndGameResultsOverlay = ({
  open,
  mode,
  players,
  teams,
  rounds,
  results,
  winner,
  onClose
}: EndGameResultsOverlayProps) => {
  const [phase, setPhase] = useState<"intro" | "docked" | "reveal">("intro");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase("intro");
    const dockTimer = window.setTimeout(() => setPhase("docked"), 700);
    const revealTimer = window.setTimeout(() => setPhase("reveal"), 1250);
    return () => {
      window.clearTimeout(dockTimer);
      window.clearTimeout(revealTimer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusable = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)) : [];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    if (closeButtonRef.current) {
      closeButtonRef.current.focus();
    } else if (first) {
      first.focus();
    } else {
      dialog?.focus();
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  const winnerLabel = winner?.label ?? "Final results";
  const winnerSubLabel = winner?.subLabel;
  const winnerAccent = useMemo(() => {
    if (winner?.kind === "team" && winner.winnerIds.length) {
      const team = teams.find((entry) => entry.id === winner.winnerIds[0]);
      const teamGradientMap: Record<string, string> = {
        teal: "from-teal-300/80 via-teal-100/90 to-white/70",
        violet: "from-violet-300/80 via-purple-100/90 to-white/70",
        amber: "from-amber-300/80 via-amber-100/90 to-white/70",
        rose: "from-rose-300/80 via-rose-100/90 to-white/70",
        sky: "from-sky-300/80 via-sky-100/90 to-white/70",
        lime: "from-lime-300/80 via-lime-100/90 to-white/70"
      };
      if (team?.color && teamGradientMap[team.color]) {
        return teamGradientMap[team.color];
      }
    }
    return "from-teal-300/70 via-white/90 to-slate-200/70";
  }, [teams, winner]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/70 p-4 md:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="endgame-title"
        aria-describedby="endgame-subtitle"
        tabIndex={-1}
        className="relative mx-auto min-h-[100dvh] w-full max-w-5xl pb-10"
      >
        <div className="sticky top-0 z-20 flex items-start justify-end pt-4 md:pt-6">
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-white/70 transition hover:border-white/30 hover:text-white"
          >
            Close
          </button>
        </div>

        <div
          className={`pointer-events-none absolute left-1/2 z-10 w-[90%] -translate-x-1/2 text-center transition-all duration-700 ease-out motion-reduce:transition-none ${
            phase === "intro"
              ? "top-1/2 -translate-y-1/2 scale-100 opacity-100"
              : "top-6 md:top-10 -translate-y-0 scale-95 opacity-100"
          }`}
        >
          <h2
            id="endgame-title"
            className={`text-3xl font-semibold text-white drop-shadow-[0_10px_30px_rgba(15,23,42,0.8)] md:text-5xl ${
              phase === "intro" ? "tracking-[0.1em]" : "tracking-[0.08em]"
            }`}
          >
            <span
              className={`bg-gradient-to-r ${winnerAccent} bg-clip-text text-transparent`}
            >
              {winnerLabel}
            </span>
          </h2>
          <p
            id="endgame-subtitle"
            className="mt-2 text-xs uppercase tracking-[0.35em] text-white/70"
          >
            {winnerSubLabel ?? "Final scoreboard locked"}
          </p>
        </div>

        <div className="relative mt-32 flex flex-col items-center gap-6 md:mt-40">
          <div
            className={`w-full transition-all duration-700 ease-out motion-reduce:transition-none ${
              phase === "reveal" ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
            }`}
          >
            <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-6 shadow-[0_0_45px_rgba(15,23,42,0.65)] backdrop-blur">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.35em] text-teal-200/70">
                    Final results
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">
                    Match breakdown
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/60">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                    {mode === "tdm" ? "Team Deathmatch" : "Free For All"}
                  </span>
                </div>
              </div>

              <div
                className="mt-6 max-h-[calc(100dvh-260px)] overflow-y-auto pr-2"
                style={{ WebkitOverflowScrolling: "touch" }}
                data-testid="endgame-results-scroll"
              >
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="space-y-6">
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-white">Game analysis</h4>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60">
                          Rounds
                        </span>
                      </div>
                      <div className="mt-4">
                        <GameAnalysisPanel rounds={rounds} results={results} players={players} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-white">Final leaderboard</h4>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/60">
                          Final
                        </span>
                      </div>
                      <div className="mt-4">
                        <LeaderboardPanel
                          mode={mode}
                          players={players}
                          teams={teams}
                          results={results}
                          variant="embedded"
                          badgeLabel="Final"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-xs text-slate-300">
                      <p className="uppercase tracking-[0.25em] text-slate-400">Next steps</p>
                      <p className="mt-2 text-sm text-white">
                        Wrap the session, review highlights, and head back to the dashboard when
                        you are ready.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.2em] text-slate-200 transition hover:border-white/40"
                >
                  Exit results
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
