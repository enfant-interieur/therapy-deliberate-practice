import type { MinigamePlayer, MinigameRound, MinigameRoundResult } from "../../store/api";

type GameAnalysisPanelProps = {
  rounds: MinigameRound[];
  results: MinigameRoundResult[];
  players: MinigamePlayer[];
};

export const GameAnalysisPanel = ({ rounds, results, players }: GameAnalysisPanelProps) => {
  if (!rounds.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
        No completed rounds yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rounds.map((round) => {
        const roundResults = results.filter((result) => result.round_id === round.id);
        return (
          <div
            key={round.id}
            className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-[0_0_20px_rgba(15,23,42,0.35)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <span className="uppercase tracking-[0.2em] text-slate-400">
                Round {round.position + 1}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-white/70">
                {round.status}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {roundResults.map((result) => {
                const player = players.find((entry) => entry.id === result.player_id);
                return (
                  <div
                    key={result.id}
                    className="rounded-xl border border-white/10 bg-slate-950/60 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white">
                      <span className="font-semibold">{player?.name ?? "Player"}</span>
                      <span className="text-teal-200">{result.overall_score.toFixed(2)}</span>
                    </div>
                    {result.transcript && (
                      <p className="mt-2 text-xs text-slate-300">
                        Transcript: {result.transcript}
                      </p>
                    )}
                    {result.evaluation && (
                      <details className="mt-3 rounded-lg border border-white/10 bg-black/40 p-2">
                        <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-slate-200/80">
                          Evaluation details
                        </summary>
                        <pre className="mt-2 max-h-40 overflow-auto text-[10px] text-slate-200">
                          {JSON.stringify(result.evaluation, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
