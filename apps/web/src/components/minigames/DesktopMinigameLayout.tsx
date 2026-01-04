import { BigMicButton } from "./BigMicButton";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { PatientAudioControls } from "./PatientAudioControls";
import { RoundHUD } from "./RoundHUD";
import { RoundTaskCard } from "./RoundTaskCard";
import type { MinigameLayoutProps } from "./layouts";

export const DesktopMinigameLayout = ({
  mode,
  modeCopy,
  session,
  teams,
  players,
  results,
  currentRound,
  currentTask,
  currentPlayer,
  currentPlayerId,
  onPlayerChange,
  controller,
  micLabel,
  roundResultScore,
  roundResultPenalty,
  onNextTurn,
  onOpenEvaluation,
  onEndGame,
  onNewGame,
  onNewPlayer,
  onRedraw,
  canRedraw,
  fullscreen
}: MinigameLayoutProps) => {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-30">
        <div className="pointer-events-auto fixed left-6 top-6 flex flex-col gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 shadow-[0_0_25px_rgba(15,23,42,0.5)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Minigames</p>
            <h1 className="mt-1 text-xl font-semibold text-white">
              {mode ? modeCopy[mode] : "Launch a minigame"}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {session && (
              <button
                onClick={onEndGame}
                className="rounded-full border border-rose-300/60 bg-rose-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-100 hover:border-rose-200"
              >
                End game
              </button>
            )}
            <button
              onClick={onNewGame}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
            >
              New game
            </button>
          </div>
        </div>

        <div className="pointer-events-auto fixed right-6 top-6 flex items-center gap-3">
          {mode === "ffa" && session && (
            <button
              onClick={onNewPlayer}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
            >
              New player
            </button>
          )}
          {mode === "tdm" && session && (
            <button
              onClick={onRedraw}
              disabled={!canRedraw}
              className="rounded-full border border-violet-300/60 bg-violet-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-violet-100 disabled:opacity-50 hover:border-violet-200"
            >
              Redraw
            </button>
          )}
          <button
            onClick={fullscreen.toggle}
            disabled={!fullscreen.isSupported}
            className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 disabled:cursor-not-allowed disabled:opacity-50 hover:border-white/40"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3" />
              <path d="M16 3h3a2 2 0 0 1 2 2v3" />
              <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
              <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
            </svg>
            <span>{fullscreen.isFullscreen ? "Exit" : "Fullscreen"}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
              Esc
            </span>
          </button>
        </div>
      </div>

      <div className="relative z-10 flex h-full flex-col justify-between gap-6 px-6 pb-8 pt-24">
        <RoundHUD round={currentRound} player={currentPlayer} teams={teams} onNextTurn={onNextTurn} />
        {session && (
          <RoundTaskCard
            title={currentTask?.title}
            criteria={currentTask?.criteria ?? []}
            visibilityMode={session.visibility_mode}
          />
        )}

        {mode === "ffa" && players.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-xs text-slate-200">
            <span className="uppercase tracking-[0.2em] text-slate-400">Current player</span>
            <select
              value={currentPlayerId}
              onChange={(event) => onPlayerChange?.(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-white"
            >
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)_minmax(0,1fr)]">
          <div className="hidden lg:block" />
          <div className="flex min-w-[280px] flex-col items-center justify-center gap-6">
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-5 py-4 text-center text-sm text-slate-200 shadow-[0_0_30px_rgba(15,23,42,0.4)] backdrop-blur">
              {controller.audioError ?? "Patient audio is ready when you are."}
            </div>
            <PatientAudioControls
              status={controller.audioStatus}
              onPlay={controller.playPatient}
              onStop={controller.stopPatient}
              hasEnded={Boolean(controller.patientEndedAt)}
            />
            <BigMicButton
              mode={controller.micMode}
              subLabel={micLabel}
              progress={controller.state === "recording" ? controller.maxDurationProgress : 0}
              onRecord={controller.startRecording}
              onStop={controller.stopAndSubmit}
            />
            {controller.submitError && (
              <p className="text-xs text-rose-200">{controller.submitError}</p>
            )}
            {roundResultScore != null && controller.state === "complete" && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Round complete</p>
                <p className="mt-2 text-2xl font-semibold text-teal-200">
                  {roundResultScore.toFixed(2)}
                </p>
                {roundResultPenalty != null && roundResultPenalty > 0 && (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-rose-200">
                    Timing penalty -{roundResultPenalty.toFixed(2)}
                  </p>
                )}
                <button
                  onClick={onOpenEvaluation}
                  className="mt-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-wide text-white/70 hover:border-white/30"
                >
                  View details
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-center lg:justify-end">
            <LeaderboardPanel mode={mode ?? "ffa"} players={players} teams={teams} results={results} />
          </div>
        </div>
      </div>
    </>
  );
};
