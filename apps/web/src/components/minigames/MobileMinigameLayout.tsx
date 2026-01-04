import { BigMicButton } from "./BigMicButton";
import { LeaderboardPanel } from "./LeaderboardPanel";
import type { MinigameLayoutProps } from "./layouts";

const playLabel = (isPlaying: boolean, hasEnded: boolean) => {
  if (isPlaying) return "Stop audio";
  return hasEnded ? "Replay patient audio" : "Play patient audio";
};

export const MobileMinigameLayout = ({
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
  currentScore,
  onNextTurn,
  onOpenEvaluation,
  onEndGame,
  onNewGame,
  onNewPlayer,
  onRedraw,
  canRedraw,
  fullscreen
}: MinigameLayoutProps) => {
  const team = teams.find((entry) => entry.id === currentPlayer?.team_id);
  const isPlaying = controller.audioStatus === "playing";
  const playButtonLabel = playLabel(isPlaying, Boolean(controller.patientEndedAt));

  return (
    <div className="relative z-10 flex h-full flex-col gap-4 px-4 pb-6 pt-20">
      <div className="rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-4 text-center shadow-[0_0_25px_rgba(15,23,42,0.45)] backdrop-blur">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Minigames</p>
        <h1 className="mt-2 text-lg font-semibold text-white">
          {mode ? modeCopy[mode] : "Launch a minigame"}
        </h1>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {session && (
            <button
              onClick={onEndGame}
              className="rounded-full border border-rose-300/60 bg-rose-500/20 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-rose-100"
            >
              End game
            </button>
          )}
          <button
            onClick={onNewGame}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/70"
          >
            New game
          </button>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {mode === "ffa" && session && (
            <button
              onClick={onNewPlayer}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70"
            >
              New player
            </button>
          )}
          {mode === "tdm" && session && (
            <button
              onClick={onRedraw}
              disabled={!canRedraw}
              className="rounded-full border border-violet-300/60 bg-violet-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-100 disabled:opacity-50"
            >
              Redraw
            </button>
          )}
          <button
            onClick={fullscreen.toggle}
            disabled={!fullscreen.isSupported}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 disabled:opacity-50"
          >
            {fullscreen.isFullscreen ? "Exit" : "Fullscreen"}
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-900/60 px-4 py-4 shadow-[0_0_20px_rgba(15,23,42,0.4)] backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Player</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {currentPlayer?.name ?? "Choose player"}
            </p>
            <p className="text-xs text-slate-300">{team ? `${team.name} · ${team.color}` : "Solo"}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Score</p>
            <p className="mt-1 text-2xl font-semibold text-teal-200">
              {typeof currentScore === "number" ? currentScore.toFixed(1) : "--"}
            </p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
              Round {currentRound ? currentRound.position + 1 : "--"}
            </p>
          </div>
        </div>
        {mode === "ffa" && players.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Active</span>
            <select
              value={currentPlayerId}
              onChange={(event) => onPlayerChange?.(event.target.value)}
              className="flex-1 rounded-full border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-white"
            >
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {onNextTurn && (
          <button
            onClick={onNextTurn}
            className="mt-3 w-full rounded-full border border-teal-300/60 bg-teal-500/20 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-teal-100"
          >
            Next turn
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-xs text-slate-200 shadow-[0_0_24px_rgba(15,23,42,0.4)] backdrop-blur">
          {controller.audioError ?? "Patient audio is ready when you are."}
        </div>
        <button
          onClick={() => (isPlaying ? controller.stopPatient() : controller.playPatient())}
          disabled={controller.audioStatus === "generating" || controller.audioStatus === "downloading"}
          className={`flex items-center gap-3 rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
            isPlaying
              ? "border-rose-300/60 bg-rose-500/20 text-rose-100 shadow-[0_0_25px_rgba(244,63,94,0.35)]"
              : "border-teal-300/60 bg-teal-500/20 text-teal-100 shadow-[0_0_25px_rgba(45,212,191,0.35)]"
          } ${controller.audioStatus === "generating" || controller.audioStatus === "downloading" ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5 hover:border-white/40"}`}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {isPlaying ? (
                <>
                  <path d="M6 5h4v14H6z" />
                  <path d="M14 5h4v14h-4z" />
                </>
              ) : (
                <path d="m8 5 11 7-11 7V5Z" />
              )}
            </svg>
          </span>
          {playButtonLabel}
        </button>
        <BigMicButton
          mode={controller.micMode}
          subLabel={micLabel}
          progress={controller.state === "recording" ? controller.maxDurationProgress : 0}
          onRecord={controller.startRecording}
          onStop={controller.stopAndSubmit}
        />
        {controller.submitError && <p className="text-xs text-rose-200">{controller.submitError}</p>}
        {roundResultScore != null && controller.state === "complete" && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Round complete</p>
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
              className="mt-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-[10px] uppercase tracking-[0.3em] text-white/70"
            >
              View details
            </button>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <details className="group rounded-3xl border border-white/10 bg-slate-900/60 px-4 py-3 shadow-[0_0_20px_rgba(15,23,42,0.35)] backdrop-blur">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-slate-200">
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 6h16M4 12h10M4 18h16" />
                </svg>
              </span>
              Difficulty {currentTask?.base_difficulty ?? "--"}
            </span>
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-slate-200">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Task</p>
              <p className="mt-1 text-base font-semibold text-white">
                {currentTask?.title ?? "Select a task to begin"}
              </p>
            </div>
            <div className="space-y-2">
              {(currentTask?.criteria ?? []).map((criterion) => (
                <div key={criterion.id} className="rounded-2xl border border-white/10 bg-slate-950/50 px-3 py-2">
                  <p className="text-xs font-semibold text-white">{criterion.label}</p>
                  <p className="text-[11px] text-slate-300">{criterion.description}</p>
                </div>
              ))}
            </div>
          </div>
        </details>

        <details className="group rounded-3xl border border-white/10 bg-slate-900/60 px-4 py-3 shadow-[0_0_20px_rgba(15,23,42,0.35)] backdrop-blur">
          <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-[0.3em] text-slate-200">
            <span className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M8 21h8m-4-4v4m6-13V5a1 1 0 0 0-1-1h-1V3a1 1 0 1 0-2 0v1h-4V3a1 1 0 1 0-2 0v1H7a1 1 0 0 0-1 1v3a3 3 0 0 0 3 3h.2a5 5 0 0 0 9.6 0H19a3 3 0 0 0 3-3V8a1 1 0 0 0-1-1h-1Zm-1 0v1a1 1 0 0 1-1 1h-.4a5.02 5.02 0 0 0 .2-1.4V6h1Zm-12 0h1v1.6c0 .48.07.95.2 1.4H9a1 1 0 0 1-1-1V7Z" />
                </svg>
              </span>
              Leaderboard
            </span>
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 transition-transform duration-200 group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="mt-3">
            <LeaderboardPanel mode={mode ?? "ffa"} players={players} teams={teams} results={results} />
          </div>
        </details>
      </div>
    </div>
  );
};
