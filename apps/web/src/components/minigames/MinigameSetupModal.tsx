import { useEffect, useMemo, useState } from "react";
import { TaskSelectionStep, type TaskSelectionState } from "./TaskSelectionStep";
import { VisibilityModeStep } from "./VisibilityModeStep";
import { PlayersTeamsStep, type PlayerDraft, type TeamDraft } from "./PlayersTeamsStep";
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
  }) => void;
};

const defaultTaskSelection: TaskSelectionState = {
  strategy: "manual",
  task_ids: [],
  shuffle: true,
  seed: Math.random().toString(36).slice(2)
};

export const MinigameSetupModal = ({ open, mode, onClose, onStart }: MinigameSetupModalProps) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [taskSelection, setTaskSelection] = useState<TaskSelectionState>(defaultTaskSelection);
  const [visibilityMode, setVisibilityMode] = useState<"normal" | "hard" | "extreme">("normal");
  const [players, setPlayers] = useState<PlayerDraft[]>([]);
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [roundsPerPlayer, setRoundsPerPlayer] = useState(2);
  const [responseTimerEnabled, setResponseTimerEnabled] = useState(false);
  const [responseTimerSeconds, setResponseTimerSeconds] = useState<number | undefined>(2);
  const [maxResponseEnabled, setMaxResponseEnabled] = useState(false);
  const [maxResponseSeconds, setMaxResponseSeconds] = useState<number | undefined>(15);

  const steps = useMemo(
    () => [
      { title: "Task selection" },
      { title: "Visibility mode" },
      { title: "Timing" },
      { title: "Players & teams" },
      { title: "Review & start" }
    ],
    []
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
  }, [open]);

  if (!open) return null;

  const responseTimerValid =
    !responseTimerEnabled ||
    (responseTimerSeconds != null && responseTimerSeconds >= 0.1 && responseTimerSeconds <= 60);
  const maxResponseValid =
    !maxResponseEnabled ||
    (maxResponseSeconds != null && maxResponseSeconds >= 0.1 && maxResponseSeconds <= 60);
  const timingValid = responseTimerValid && maxResponseValid;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="mx-auto w-full max-w-5xl max-h-[90dvh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/80 p-8 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Setup</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">
              {mode === "tdm" ? "Team Deathmatch" : "Free For All"}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              Configure tasks, visibility, and players before launching.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {steps.map((step, index) => (
            <div key={step.title} className="flex items-center gap-2 text-xs text-slate-300">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                  index === stepIndex
                    ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                    : "border-white/10 bg-white/5 text-white/60"
                }`}
              >
                {index + 1}
              </span>
              <span className={index === stepIndex ? "text-white" : ""}>{step.title}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          {stepIndex === 0 && (
            <TaskSelectionStep value={taskSelection} onChange={setTaskSelection} />
          )}
          {stepIndex === 1 && (
            <VisibilityModeStep value={visibilityMode} onChange={setVisibilityMode} />
          )}
          {stepIndex === 2 && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Response timer</p>
                    <p className="text-xs text-slate-300">
                      Require a minimum delay after the patient finishes.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={responseTimerEnabled}
                    onChange={(event) => setResponseTimerEnabled(event.target.checked)}
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
                        setResponseTimerSeconds(event.target.value ? Number(event.target.value) : undefined)
                      }
                      className="w-24 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
                    />
                    <span>seconds</span>
                    {!responseTimerValid && (
                      <span className="text-xs text-rose-200">Enter 0.1–60 seconds</span>
                    )}
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Max response duration</p>
                    <p className="text-xs text-slate-300">Cap how long recording can last.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={maxResponseEnabled}
                    onChange={(event) => setMaxResponseEnabled(event.target.checked)}
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
                        setMaxResponseSeconds(event.target.value ? Number(event.target.value) : undefined)
                      }
                      className="w-24 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
                    />
                    <span>seconds</span>
                    {!maxResponseValid && (
                      <span className="text-xs text-rose-200">Enter 0.1–60 seconds</span>
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

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={() => setStepIndex((prev) => Math.max(0, prev - 1))}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/30"
            disabled={stepIndex === 0}
          >
            Back
          </button>
          {stepIndex < steps.length - 1 ? (
            <button
              onClick={() => setStepIndex((prev) => Math.min(steps.length - 1, prev + 1))}
              disabled={stepIndex === 2 && !timingValid}
              className="rounded-full border border-teal-300/60 bg-teal-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 hover:border-teal-200"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() =>
                onStart({
                  taskSelection,
                  visibilityMode,
                  players,
                  teams,
                  roundsPerPlayer,
                  responseTimerEnabled,
                  responseTimerSeconds,
                  maxResponseEnabled,
                  maxResponseSeconds
                })
              }
              disabled={!timingValid}
              className="rounded-full border border-teal-300/60 bg-teal-500/30 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 hover:border-teal-200"
            >
              Start game
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
};
