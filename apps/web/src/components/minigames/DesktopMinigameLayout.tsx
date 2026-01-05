import { BigMicButton } from "./BigMicButton";
import { DockPanel } from "./DockPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { NowUpHeader } from "./NowUpHeader";
import { PatientAudioControls } from "./PatientAudioControls";
import { PlayersPanel } from "./PlayersPanel";
import { RoundTaskCard } from "./RoundTaskCard";
import { TranscriptOverlay } from "./TranscriptOverlay";
import type { MinigameLayoutProps } from "./layouts";

export const DesktopMinigameLayout = ({
  mode,
  modeCopy,
  session,
  teams,
  players,
  rounds,
  results,
  currentRound,
  currentTask,
  activePlayerId,
  upNextPlayerId,
  canSwitchPlayer,
  onRequestSwitchPlayer,
  controller,
  micLabel,
  roundResultScore,
  roundResultPenalty,
  transcriptEligible,
  transcriptHidden,
  transcriptText,
  transcriptProcessingStage,
  onToggleTranscript,
  onNextTurn,
  nextTurnDisabled,
  onOpenEvaluation,
  onEndGame,
  onNewGame,
  onNewPlayer,
  onRedraw,
  canRedraw,
  promptExhaustedMessage,
  fullscreen
}: MinigameLayoutProps) => {
  return (
    <div className="relative z-10 flex h-full flex-col gap-6 px-6 pb-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/70 px-6 py-4 shadow-[0_0_25px_rgba(15,23,42,0.4)] backdrop-blur">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Minigames</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">
            {mode ? modeCopy[mode] : "Launch a minigame"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
      {promptExhaustedMessage && (
        <div className="rounded-3xl border border-amber-300/40 bg-amber-500/10 px-6 py-3 text-xs text-amber-100">
          <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200/80">
            All prompts used
          </p>
          <p className="mt-1 text-sm text-amber-100/90">{promptExhaustedMessage}</p>
        </div>
      )}

      <div className="grid flex-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 lg:justify-self-start">
          <DockPanel
            side="left"
            title="Players"
            icon={
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M16 11a4 4 0 1 0-8 0" />
                <path d="M3 21a9 9 0 0 1 18 0" />
              </svg>
            }
            defaultCollapsed
            collapsedWidth={56}
            expandedWidth={360}
          >
            <PlayersPanel
              mode={mode}
              rounds={rounds}
              currentRound={currentRound}
              players={players}
              teams={teams}
              results={results}
              activePlayerId={activePlayerId}
              upNextPlayerId={upNextPlayerId}
              canSwitchPlayer={canSwitchPlayer}
              onRequestSwitchPlayer={onRequestSwitchPlayer}
              onNextTurn={onNextTurn}
              nextTurnDisabled={nextTurnDisabled}
            />
          </DockPanel>

          <DockPanel
            side="left"
            title="Task"
            icon={
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 6h16M4 12h10M4 18h16" />
              </svg>
            }
            defaultCollapsed
            collapsedWidth={56}
            expandedWidth={360}
          >
            {session ? (
              <RoundTaskCard
                title={currentTask?.title}
                criteria={currentTask?.criteria ?? []}
                visibilityMode={session.visibility_mode}
              />
            ) : (
              <div className="text-sm text-slate-300">Select a game to preview tasks.</div>
            )}
          </DockPanel>
        </div>

        <div className="flex min-w-[280px] flex-col items-center justify-center gap-6">
          <NowUpHeader
            mode={mode}
            currentRound={currentRound}
            players={players}
            teams={teams}
            activePlayerId={activePlayerId}
            responseCountdown={controller.responseCountdown}
            audioStatus={controller.audioStatus}
            audioError={controller.audioError}
          />
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
            accent={controller.micAccent}
            attention={controller.micAttention}
            onRecord={controller.startRecording}
            onStop={controller.stopAndSubmit}
          />
          {controller.submitError && <p className="text-xs text-rose-200">{controller.submitError}</p>}
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

        <div className="flex flex-col items-end gap-4 lg:justify-self-end">
          <DockPanel
            side="right"
            title="Leaderboard"
            icon={
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M5 12h4v7H5zM10 8h4v11h-4zM15 5h4v14h-4z" />
              </svg>
            }
            collapsedWidth={56}
            expandedWidth={360}
          >
            <LeaderboardPanel
              mode={mode ?? "ffa"}
              players={players}
              teams={teams}
              results={results}
              variant="embedded"
            />
          </DockPanel>

          {transcriptEligible && (
            <DockPanel
              side="right"
              title="Transcript"
              icon={
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
              }
              collapsedWidth={56}
              expandedWidth={360}
              collapsed={transcriptHidden}
              onCollapsedChange={(next) => {
                if (next !== transcriptHidden) {
                  onToggleTranscript();
                }
              }}
            >
              <TranscriptOverlay
                text={transcriptText}
                processingStage={transcriptProcessingStage}
                onToggle={onToggleTranscript}
                variant="embedded"
              />
            </DockPanel>
          )}
        </div>
      </div>
    </div>
  );
};
