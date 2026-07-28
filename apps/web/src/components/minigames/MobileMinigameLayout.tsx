import { useTranslation } from "react-i18next";
import { BigMicButton } from "./BigMicButton";
import { DockPanel } from "./DockPanel";
import { LeaderboardPanel } from "./LeaderboardPanel";
import { NowUpHeader } from "./NowUpHeader";
import { PlayersPanel } from "./PlayersPanel";
import { RoundTaskCard } from "./RoundTaskCard";
import { TranscriptOverlay } from "./TranscriptOverlay";
import type { MinigameLayoutProps } from "./layouts";

export const MobileMinigameLayout = ({
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
  fullscreen,
}: MinigameLayoutProps) => {
  const { t } = useTranslation();
  const isPlaying = controller.audioStatus === "playing";
  const playButtonLabel = isPlaying
    ? t("minigameUi.stopAudio")
    : controller.patientEndedAt
      ? t("minigameUi.replayPatientAudio")
      : t("minigameUi.playPatientAudio");

  return (
    <div className="relative z-10 flex h-full flex-col gap-4 overflow-y-auto px-4 pb-6 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-white/10 bg-slate-900/70 px-4 py-4 shadow-[0_0_25px_rgba(15,23,42,0.45)] backdrop-blur">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">
            {t("appShell.nav.minigames")}
          </p>
          <h1 className="mt-2 text-lg font-semibold text-white">
            {mode ? modeCopy[mode] : t("minigameUi.launchMinigame")}
          </h1>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {session && (
            <button
              onClick={onEndGame}
              className="rounded-full border border-rose-300/60 bg-rose-500/20 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-rose-100"
            >
              {t("minigameUi.endGame")}
            </button>
          )}
          <button
            onClick={onNewGame}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/70"
          >
            {t("minigameUi.newGame")}
          </button>
          {mode === "ffa" && session && (
            <button
              onClick={onNewPlayer}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70"
            >
              {t("minigameUi.newPlayer")}
            </button>
          )}
          {mode === "tdm" && session && (
            <button
              onClick={onRedraw}
              disabled={!canRedraw}
              className="rounded-full border border-violet-300/60 bg-violet-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-100 disabled:opacity-50"
            >
              {t("minigameUi.redraw")}
            </button>
          )}
          <button
            onClick={fullscreen.toggle}
            disabled={!fullscreen.isSupported}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 disabled:opacity-50"
          >
            {fullscreen.isFullscreen
              ? t("minigameUi.exitFullscreen")
              : t("minigameUi.fullscreen")}
          </button>
        </div>
      </div>
      {promptExhaustedMessage && (
        <div className="rounded-3xl border border-amber-300/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
          <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200/80">
            {t("minigameUi.allPromptsUsed")}
          </p>
          <p className="mt-1 text-sm text-amber-100/90">
            {promptExhaustedMessage}
          </p>
        </div>
      )}

      <DockPanel
        side="left"
        title={t("minigameUi.players")}
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M16 11a4 4 0 1 0-8 0" />
            <path d="M3 21a9 9 0 0 1 18 0" />
          </svg>
        }
        defaultCollapsed
        behavior="stack"
      >
        <PlayersPanel
          mode={mode}
          rounds={rounds}
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
        title={t("minigameUi.task")}
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M4 6h16M4 12h10M4 18h16" />
          </svg>
        }
        defaultCollapsed
        behavior="stack"
      >
        {session ? (
          <RoundTaskCard
            title={currentTask?.title}
            criteria={currentTask?.criteria ?? []}
            visibilityMode={session.visibility_mode}
          />
        ) : (
          <div className="text-sm text-slate-300">
            {t("minigameUi.selectGameToPreview")}
          </div>
        )}
      </DockPanel>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
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
        <button
          onClick={() =>
            isPlaying ? controller.stopPatient() : controller.playPatient()
          }
          disabled={
            controller.audioStatus === "generating" ||
            controller.audioStatus === "downloading"
          }
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
          progress={
            controller.state === "recording"
              ? controller.maxDurationProgress
              : 0
          }
          accent={controller.micAccent}
          attention={controller.micAttention}
          onRecord={controller.startRecording}
          onStop={controller.stopAndSubmit}
        />
        {controller.submitError && (
          <p className="text-xs text-rose-200">{controller.submitError}</p>
        )}
        {roundResultScore != null && controller.state === "complete" && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
              {t("minigameUi.roundComplete")}
            </p>
            <p className="mt-2 text-2xl font-semibold text-teal-200">
              {roundResultScore.toFixed(2)}
            </p>
            {roundResultPenalty != null && roundResultPenalty > 0 && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-rose-200">
                {t("minigameUi.timingPenalty", {
                  score: roundResultPenalty.toFixed(2),
                })}
              </p>
            )}
            <button
              onClick={onOpenEvaluation}
              className="mt-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-[10px] uppercase tracking-[0.3em] text-white/70"
            >
              {t("minigameUi.viewDetails")}
            </button>
          </div>
        )}
      </div>

      <DockPanel
        side="right"
        title={t("minigameUi.leaderboard")}
        icon={
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          >
            <path d="M5 12h4v7H5zM10 8h4v11h-4zM15 5h4v14h-4z" />
          </svg>
        }
        behavior="stack"
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
          title={t("minigameUi.transcript")}
          icon={
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
          }
          behavior="stack"
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
  );
};
