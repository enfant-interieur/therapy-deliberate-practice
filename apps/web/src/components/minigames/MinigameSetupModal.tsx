import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import {
  TaskSelectionStep,
  type TaskSelectionState,
} from "./TaskSelectionStep";
import { VisibilityModeStep } from "./VisibilityModeStep";
import {
  PlayersTeamsStep,
  type PlayerDraft,
  type TeamDraft,
} from "./PlayersTeamsStep";
import { ReviewStartStep } from "./ReviewStartStep";

type MinigameSetupModalProps = {
  open: boolean;
  mode: "ffa" | "tdm";
  onClose: () => void;
  onStart: (payload: {
    taskSelection: TaskSelectionState;
    visibilityMode: "normal" | "hard" | "extreme";
    players: PlayerDraft[];
    teams: TeamDraft[];
    roundsPerPlayer: number;
    responseTimerEnabled: boolean;
    responseTimerSeconds?: number;
    maxResponseEnabled: boolean;
    maxResponseSeconds?: number;
  }) => Promise<void>;
};

const defaultTaskSelection: TaskSelectionState = {
  strategy: "manual",
  task_ids: [],
  shuffle: true,
  seed: Math.random().toString(36).slice(2),
};

export const MinigameSetupModal = ({
  open,
  mode,
  onClose,
  onStart,
}: MinigameSetupModalProps) => {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [taskSelection, setTaskSelection] =
    useState<TaskSelectionState>(defaultTaskSelection);
  const [visibilityMode, setVisibilityMode] = useState<
    "normal" | "hard" | "extreme"
  >("normal");
  const [players, setPlayers] = useState<PlayerDraft[]>([]);
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [roundsPerPlayer, setRoundsPerPlayer] = useState(2);
  const [responseTimerEnabled, setResponseTimerEnabled] = useState(false);
  const [responseTimerSeconds, setResponseTimerSeconds] = useState<
    number | undefined
  >(2);
  const [maxResponseEnabled, setMaxResponseEnabled] = useState(false);
  const [maxResponseSeconds, setMaxResponseSeconds] = useState<
    number | undefined
  >(15);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const { dialogRef, titleId } = useAccessibleDialog(open, () => {
    if (!submittingRef.current) {
      onClose();
    }
  });

  const steps = useMemo(
    () => [
      { title: t("minigameUi.taskSelection") },
      { title: t("minigameUi.visibilityMode") },
      { title: t("minigameUi.timing") },
      { title: t("minigameUi.playersAndTeams") },
      { title: t("minigameUi.reviewAndStart") },
    ],
    [t],
  );

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setTaskSelection(defaultTaskSelection);
    setVisibilityMode("normal");
    setPlayers([]);
    setTeams([]);
    setRoundsPerPlayer(2);
    setResponseTimerEnabled(false);
    setResponseTimerSeconds(2);
    setMaxResponseEnabled(false);
    setMaxResponseSeconds(15);
    submittingRef.current = false;
    setIsSubmitting(false);
    setSubmitError(null);
  }, [open]);

  if (!open) return null;

  const responseTimerValid =
    !responseTimerEnabled ||
    (responseTimerSeconds != null &&
      responseTimerSeconds >= 0.1 &&
      responseTimerSeconds <= 60);
  const maxResponseValid =
    !maxResponseEnabled ||
    (maxResponseSeconds != null &&
      maxResponseSeconds >= 0.1 &&
      maxResponseSeconds <= 60);
  const timingValid = responseTimerValid && maxResponseValid;
  const handleStart = async () => {
    if (submittingRef.current || !timingValid) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onStart({
        taskSelection,
        visibilityMode,
        players,
        teams,
        roundsPerPlayer,
        responseTimerEnabled,
        responseTimerSeconds,
        maxResponseEnabled,
        maxResponseSeconds,
      });
    } catch {
      setSubmitError(t("minigameUi.setupFailed"));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex min-h-[100dvh] items-end justify-center md:items-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={isSubmitting}
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl max-h-[90dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-slate-950/80 p-8 shadow-2xl backdrop-blur md:rounded-3xl"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">
                {t("minigameUi.setup")}
              </p>
              <h2
                id={titleId}
                className="mt-2 text-3xl font-semibold text-white"
              >
                {mode === "tdm"
                  ? t("minigameUi.teamDeathmatch")
                  : t("minigameUi.freeForAll")}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {t("minigameUi.setupDescription")}
              </p>
            </div>
            <button
              data-dialog-autofocus
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
            >
              {t("minigameUi.close")}
            </button>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {steps.map((step, index) => (
              <div
                key={step.title}
                className="flex items-center gap-2 text-xs text-slate-300"
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                    index === stepIndex
                      ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                      : "border-white/10 bg-white/5 text-white/60"
                  }`}
                >
                  {index + 1}
                </span>
                <span className={index === stepIndex ? "text-white" : ""}>
                  {step.title}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            {stepIndex === 0 && (
              <TaskSelectionStep
                value={taskSelection}
                onChange={setTaskSelection}
              />
            )}
            {stepIndex === 1 && (
              <VisibilityModeStep
                value={visibilityMode}
                onChange={setVisibilityMode}
              />
            )}
            {stepIndex === 2 && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {t("minigameUi.responseTimer")}
                      </p>
                      <p className="text-xs text-slate-300">
                        {t("minigameUi.responseTimerDescription")}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={t("minigameUi.responseTimer")}
                      checked={responseTimerEnabled}
                      onChange={(event) =>
                        setResponseTimerEnabled(event.target.checked)
                      }
                      className="h-5 w-5 rounded border-white/30 bg-slate-900 text-teal-300"
                    />
                  </div>
                  {responseTimerEnabled && (
                    <div className="mt-4 flex items-center gap-3 text-xs text-slate-300">
                      <input
                        type="number"
                        min={0.1}
                        max={60}
                        step={0.1}
                        value={responseTimerSeconds ?? ""}
                        onChange={(event) =>
                          setResponseTimerSeconds(
                            event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          )
                        }
                        className="w-24 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
                      />
                      <span>{t("minigameUi.seconds")}</span>
                      {!responseTimerValid && (
                        <span className="text-xs text-rose-200">
                          {t("minigameUi.secondsRange")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {t("minigameUi.maxResponseDuration")}
                      </p>
                      <p className="text-xs text-slate-300">
                        {t("minigameUi.maxResponseDescription")}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      aria-label={t("minigameUi.maxResponseDuration")}
                      checked={maxResponseEnabled}
                      onChange={(event) =>
                        setMaxResponseEnabled(event.target.checked)
                      }
                      className="h-5 w-5 rounded border-white/30 bg-slate-900 text-teal-300"
                    />
                  </div>
                  {maxResponseEnabled && (
                    <div className="mt-4 flex items-center gap-3 text-xs text-slate-300">
                      <input
                        type="number"
                        min={0.1}
                        max={60}
                        step={0.1}
                        value={maxResponseSeconds ?? ""}
                        onChange={(event) =>
                          setMaxResponseSeconds(
                            event.target.value
                              ? Number(event.target.value)
                              : undefined,
                          )
                        }
                        className="w-24 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
                      />
                      <span>{t("minigameUi.seconds")}</span>
                      {!maxResponseValid && (
                        <span className="text-xs text-rose-200">
                          {t("minigameUi.secondsRange")}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {stepIndex === 3 && (
              <PlayersTeamsStep
                mode={mode}
                players={players}
                teams={teams}
                onChangePlayers={setPlayers}
                onChangeTeams={setTeams}
                roundsPerPlayer={roundsPerPlayer}
                onRoundsPerPlayerChange={setRoundsPerPlayer}
              />
            )}
            {stepIndex === 4 && (
              <ReviewStartStep
                mode={mode}
                taskSelection={taskSelection}
                visibilityMode={visibilityMode}
                players={players}
                teams={teams}
                roundsPerPlayer={roundsPerPlayer}
              />
            )}
          </div>

          {submitError && (
            <p
              role="alert"
              className="mt-5 rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            >
              {submitError}
            </p>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/30"
              disabled={stepIndex === 0 || isSubmitting}
            >
              {t("minigameUi.back")}
            </button>
            {stepIndex < steps.length - 1 ? (
              <button
                onClick={() =>
                  setStepIndex((prev) => Math.min(steps.length - 1, prev + 1))
                }
                disabled={isSubmitting || (stepIndex === 2 && !timingValid)}
                className="rounded-full border border-teal-300/60 bg-teal-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 hover:border-teal-200"
              >
                {t("minigameUi.next")}
              </button>
            ) : (
              <button
                onClick={() => void handleStart()}
                disabled={isSubmitting || !timingValid}
                className="rounded-full border border-teal-300/60 bg-teal-500/30 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 hover:border-teal-200"
              >
                {t(
                  isSubmitting
                    ? "minigameUi.startingGame"
                    : "minigameUi.startGame",
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
