import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { GameSelectModal } from "../components/minigames/GameSelectModal";
import { MinigameSetupModal } from "../components/minigames/MinigameSetupModal";
import { AudioReactiveBackground } from "../components/minigames/AudioReactiveBackground";
import { TranscriptOverlay } from "../components/minigames/TranscriptOverlay";
import { BigMicButton } from "../components/minigames/BigMicButton";
import { LeaderboardPanel } from "../components/minigames/LeaderboardPanel";
import { RoundHUD } from "../components/minigames/RoundHUD";
import { EvaluationDrawer } from "../components/minigames/EvaluationDrawer";
import { PatientAudioControls } from "../components/minigames/PatientAudioControls";
import { NewPlayerDialog } from "../components/minigames/NewPlayerDialog";
import { VersusIntroOverlay } from "../components/minigames/VersusIntroOverlay";
import { useFfaTurnController } from "../components/minigames/hooks/useFfaTurnController";
import { useTdmMatchController } from "../components/minigames/hooks/useTdmMatchController";
import { useFullscreen } from "../components/minigames/hooks/useFullscreen";
import { usePatientAudioBank } from "../patientAudio/usePatientAudioBank";
import {
  useAddMinigamePlayersMutation,
  useAddMinigameTeamsMutation,
  useCreateMinigameSessionMutation,
  useEndMinigameSessionMutation,
  useGenerateMinigameRoundsMutation,
  useLazyGetMinigameStateQuery,
  useRedrawMinigameRoundMutation
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  addRoundResult,
  resetMinigame,
  setCurrentRoundId,
  setEvaluationDrawerOpen,
  setAppShellHidden,
  setMinigameState,
  toggleTranscriptHidden
} from "../store/minigamesSlice";
import type { PlayerDraft, TeamDraft } from "../components/minigames/PlayersTeamsStep";
import type { TaskSelectionState } from "../components/minigames/TaskSelectionStep";
import type { EvaluationResult } from "@deliberate/shared";

const modeCopy = {
  ffa: "Free For All",
  tdm: "Team Deathmatch"
};

const WARMUP_AHEAD = 2;

export const MinigamesPage = () => {
  const dispatch = useAppDispatch();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const location = useLocation();
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const minigames = useAppSelector((state) => state.minigames);
  const [selectOpen, setSelectOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [mode, setMode] = useState<"ffa" | "tdm" | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | undefined>(undefined);
  const [roundResultScore, setRoundResultScore] = useState<number | null>(null);
  const [roundResultPenalty, setRoundResultPenalty] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | undefined>(undefined);
  const [newPlayerOpen, setNewPlayerOpen] = useState(false);
  const handledPreselectRef = useRef(false);

  const [createSession] = useCreateMinigameSessionMutation();
  const [addTeams] = useAddMinigameTeamsMutation();
  const [addPlayers] = useAddMinigamePlayersMutation();
  const [generateRounds] = useGenerateMinigameRoundsMutation();
  const [endSession] = useEndMinigameSessionMutation();
  const [fetchMinigameState, minigameState] = useLazyGetMinigameStateQuery();
  const [redrawRound] = useRedrawMinigameRoundMutation();
  const fullscreen = useFullscreen();
  const patientAudio = usePatientAudioBank({ loggerScope: "minigames" });
  const patientAudioRef = useRef(patientAudio);
  const handleAudioRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);

  useEffect(() => {
    patientAudioRef.current = patientAudio;
  }, [patientAudio]);

  useEffect(() => {
    dispatch(setAppShellHidden(true));
    return () => {
      dispatch(setAppShellHidden(false));
    };
  }, [dispatch]);

  useEffect(() => {
    if (minigameState.data) {
      dispatch(setMinigameState(minigameState.data));
    }
  }, [dispatch, minigameState.data]);

  useEffect(() => {
    if (minigames.session?.game_type) {
      setMode(minigames.session.game_type);
    }
  }, [minigames.session]);

  useEffect(() => {
    if (handledPreselectRef.current) return;
    const state = location.state as { preselectedMode?: "ffa" | "tdm" } | null;
    if (!state?.preselectedMode) return;
    handledPreselectRef.current = true;
    setMode(state.preselectedMode);
    setSelectOpen(false);
    setSetupOpen(true);
  }, [location.state]);

  useEffect(() => {
    if (minigames.players.length && !currentPlayerId && mode === "ffa") {
      setCurrentPlayerId(minigames.players[0].id);
    }
  }, [currentPlayerId, minigames.players, mode]);

  useEffect(() => {
    if (mode !== "ffa" || !currentPlayerId) return;
    const nextForPlayer = minigames.rounds.find(
      (round) => round.status !== "completed" && round.player_a_id === currentPlayerId
    );
    if (nextForPlayer) {
      dispatch(setCurrentRoundId(nextForPlayer.id));
    }
  }, [currentPlayerId, dispatch, minigames.rounds, mode]);

  const currentRound = useMemo(
    () =>
      minigames.rounds.find((round) => round.id === minigames.currentRoundId) ??
      minigames.rounds.find((round) => round.status !== "completed"),
    [minigames.currentRoundId, minigames.rounds]
  );

  const warmupRounds = useMemo(() => {
    if (!currentRound) return [];
    const upcoming = [...minigames.rounds]
      .filter((round) => round.status !== "completed")
      .sort((a, b) => a.position - b.position);
    const currentIndex = Math.max(
      0,
      upcoming.findIndex((round) => round.id === currentRound.id)
    );
    return upcoming.slice(currentIndex, currentIndex + 1 + WARMUP_AHEAD);
  }, [currentRound, minigames.rounds]);
  const warmupRoundsRef = useRef(warmupRounds);

  const warmupKey = useMemo(() => {
    if (warmupRounds.length === 0) return "";
    return warmupRounds
      .map((round) => `${round.task_id}:${round.example_id}`)
      .join("|");
  }, [warmupRounds]);

  useEffect(() => {
    warmupRoundsRef.current = warmupRounds;
  }, [warmupRounds]);

  useEffect(() => {
    if (!warmupKey) return;
    const rounds = warmupRoundsRef.current;
    const grouped: Record<string, string[]> = {};
    rounds.forEach((round) => {
      if (!grouped[round.task_id]) {
        grouped[round.task_id] = [];
      }
      if (!grouped[round.task_id].includes(round.example_id)) {
        grouped[round.task_id].push(round.example_id);
      }
    });
    const controller = new AbortController();
    const runWarmup = async () => {
      try {
        await patientAudioRef.current.warmup(grouped, { signal: controller.signal });
      } catch (error) {
        if (!controller.signal.aborted) {
          return;
        }
      }
    };
    void runWarmup();
    return () => controller.abort();
  }, [warmupKey]);

  useEffect(() => {
    patientAudioRef.current.bank.revokeAll();
  }, [minigames.session?.id]);

  const timingSettings = useMemo(() => {
    const settings = (minigames.session?.settings ?? {}) as {
      response_timer_enabled?: boolean;
      response_timer_seconds?: number;
      max_response_duration_enabled?: boolean;
      max_response_duration_seconds?: number;
    };
    return {
      responseTimerEnabled: Boolean(settings.response_timer_enabled),
      responseTimerSeconds: settings.response_timer_seconds ?? 2,
      maxResponseEnabled: Boolean(settings.max_response_duration_enabled),
      maxResponseSeconds: settings.max_response_duration_seconds ?? 15
    };
  }, [minigames.session?.settings]);

  const ffaController = useFfaTurnController({
    enabled: mode === "ffa",
    sessionId: minigames.session?.id ?? "",
    round: currentRound,
    playerId: currentPlayerId,
    audioElement,
    patientAudio,
    responseTimerEnabled: timingSettings.responseTimerEnabled,
    responseTimerSeconds: timingSettings.responseTimerSeconds,
    maxResponseEnabled: timingSettings.maxResponseEnabled,
    maxResponseSeconds: timingSettings.maxResponseSeconds,
    onResult: (payload) => {
      setLastTranscript(payload.transcript);
      setRoundResultScore(payload.score ?? null);
      setRoundResultPenalty(payload.timingPenalty ?? null);
      if (
        payload.score != null &&
        payload.attemptId &&
        currentRound &&
        currentPlayerId &&
        minigames.session
      ) {
        dispatch(
          addRoundResult({
            roundId: currentRound.id,
            playerId: currentPlayerId,
            attemptId: payload.attemptId,
            overallScore: payload.score,
            overallPass: true,
            transcript: payload.transcript,
            evaluation: payload.evaluation as EvaluationResult | undefined,
            clientPenalty: payload.timingPenalty
          })
        );
      }
    }
  });

  const tdmController = useTdmMatchController({
    enabled: mode === "tdm",
    sessionId: minigames.session?.id ?? "",
    round: currentRound,
    audioElement,
    patientAudio,
    responseTimerEnabled: timingSettings.responseTimerEnabled,
    responseTimerSeconds: timingSettings.responseTimerSeconds,
    maxResponseEnabled: timingSettings.maxResponseEnabled,
    maxResponseSeconds: timingSettings.maxResponseSeconds,
    onResult: (payload) => {
      setLastTranscript(payload.transcript);
      setRoundResultScore(payload.score ?? null);
      setRoundResultPenalty(payload.timingPenalty ?? null);
      if (payload.score != null && payload.attemptId && currentRound && minigames.session) {
        dispatch(
          addRoundResult({
            roundId: currentRound.id,
            playerId: payload.playerId,
            attemptId: payload.attemptId,
            overallScore: payload.score,
            overallPass: true,
            transcript: payload.transcript,
            evaluation: payload.evaluation as EvaluationResult | undefined,
            clientPenalty: payload.timingPenalty
          })
        );
      }
    }
  });

  const controller = mode === "tdm" ? tdmController : ffaController;
  const activePlayerId = mode === "tdm" ? tdmController.activePlayerId : currentPlayerId;
  const currentPlayer = minigames.players.find((player) => player.id === activePlayerId);

  const handleModeSelect = (selected: "ffa" | "tdm") => {
    setMode(selected);
    setSelectOpen(false);
    setSetupOpen(true);
  };

  useEffect(() => {
    setRoundResultScore(null);
    setRoundResultPenalty(null);
  }, [currentRound?.id]);

  const startGame = async (payload: {
    taskSelection: TaskSelectionState;
    visibilityMode: "normal" | "hard" | "extreme";
    players: PlayerDraft[];
    teams: TeamDraft[];
    roundsPerPlayer: number;
    responseTimerEnabled: boolean;
    responseTimerSeconds?: number;
    maxResponseEnabled: boolean;
    maxResponseSeconds?: number;
  }) => {
    if (!mode) return;
    const session = await createSession({
      game_type: mode,
      visibility_mode: payload.visibilityMode,
      task_selection: payload.taskSelection,
      settings: {
        rounds_per_player: payload.roundsPerPlayer,
        response_timer_enabled: payload.responseTimerEnabled,
        response_timer_seconds: payload.responseTimerSeconds,
        max_response_duration_enabled: payload.maxResponseEnabled,
        max_response_duration_seconds: payload.maxResponseSeconds
      }
    }).unwrap();

    let teamRows: TeamDraft[] = [];
    if (mode === "tdm" && payload.teams.length) {
      const response = await addTeams({
        sessionId: session.session_id,
        teams: payload.teams.map((team) => ({ name: team.name, color: team.color }))
      }).unwrap();
      teamRows = response.teams.map((team, index) => ({ ...team, id: team.id }));
    }

    const teamIdMap = new Map<string, string>();
    payload.teams.forEach((team, index) => {
      if (teamRows[index]) {
        teamIdMap.set(team.id, teamRows[index].id);
      }
    });

    if (payload.players.length) {
      await addPlayers({
        sessionId: session.session_id,
        players: payload.players.map((player) => ({
          name: player.name,
          avatar: player.avatar,
          team_id: player.team_id ? teamIdMap.get(player.team_id) : null
        }))
      }).unwrap();
    }

    await generateRounds({
      sessionId: session.session_id,
      count: mode === "ffa" ? 3 : undefined
    });

    await fetchMinigameState(session.session_id);
    dispatch(setCurrentRoundId(undefined));
    setSetupOpen(false);
  };

  const endGame = async () => {
    if (!minigames.session) return;
    await endSession({ sessionId: minigames.session.id });
    dispatch(setEvaluationDrawerOpen(true));
  };

  const nextTurn = () => {
    const next = minigames.rounds.find((round) => round.status !== "completed");
    dispatch(setCurrentRoundId(next?.id));
    setRoundResultScore(null);
    setRoundResultPenalty(null);
  };

  const handleCreatePlayer = async (payload: { name: string; avatar: string }) => {
    if (!minigames.session) return;
    const response = await addPlayers({
      sessionId: minigames.session.id,
      players: [{ name: payload.name, avatar: payload.avatar }]
    }).unwrap();
    const newPlayer = response.players[0];
    setCurrentPlayerId(newPlayer.id);
    const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
    dispatch(setMinigameState(refreshed));
    let nextForNewPlayer = refreshed.rounds.find(
      (round) => round.status !== "completed" && round.player_a_id === newPlayer.id
    );
    if (!nextForNewPlayer) {
      await generateRounds({ sessionId: minigames.session.id, count: refreshed.players.length });
      const updated = await fetchMinigameState(minigames.session.id).unwrap();
      dispatch(setMinigameState(updated));
      nextForNewPlayer = updated.rounds.find(
        (round) => round.status !== "completed" && round.player_a_id === newPlayer.id
      );
    }
    dispatch(setCurrentRoundId(nextForNewPlayer?.id));
    setNewPlayerOpen(false);
  };

  const handleRedraw = async () => {
    if (!minigames.session) return;
    await redrawRound({ sessionId: minigames.session.id }).unwrap();
    const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
    dispatch(setMinigameState(refreshed));
    dispatch(setCurrentRoundId(refreshed.rounds.find((round) => round.status !== "completed")?.id));
    setRoundResultScore(null);
    setRoundResultPenalty(null);
  };

  const micLabel = useMemo(() => {
    if (controller.state === "recording") {
      if (controller.maxDurationRemaining != null) {
        return `${controller.maxDurationRemaining.toFixed(1)}s`;
      }
      return "Stop";
    }
    if (controller.responseCountdownLabel) {
      return controller.responseCountdownLabel;
    }
    return "Record";
  }, [controller.maxDurationRemaining, controller.responseCountdownLabel, controller.state]);

  const canRedraw =
    mode === "tdm" &&
    controller.state !== "recording" &&
    controller.state !== "submitting" &&
    controller.state !== "patient_playing";

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-slate-950 text-white">
      <AudioReactiveBackground
        audioElement={audioElement}
        isPlaying={controller.audioStatus === "playing"}
      />
      <audio ref={handleAudioRef} preload="auto" playsInline />
      <TranscriptOverlay
        text={minigames.ui.transcriptHidden ? undefined : lastTranscript}
        hidden={minigames.ui.transcriptHidden}
        onToggle={() => dispatch(toggleTranscriptHidden())}
      />

      <div className="pointer-events-none fixed inset-0 z-10">
        <div className="pointer-events-auto fixed left-6 top-6 flex flex-col gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 shadow-[0_0_25px_rgba(15,23,42,0.5)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Minigames</p>
            <h1 className="mt-1 text-xl font-semibold text-white">
              {mode ? modeCopy[mode] : "Launch a minigame"}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {minigames.session && (
              <button
                onClick={endGame}
                className="rounded-full border border-rose-300/60 bg-rose-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-100 hover:border-rose-200"
              >
                End game
              </button>
            )}
            <button
              onClick={() => {
                dispatch(resetMinigame());
                setMode(null);
                setSelectOpen(true);
              }}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
            >
              New game
            </button>
          </div>
        </div>

        <div className="pointer-events-auto fixed right-6 top-6 flex items-center gap-3">
          {mode === "ffa" && minigames.session && (
            <button
              onClick={() => setNewPlayerOpen(true)}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
            >
              New player
            </button>
          )}
          {mode === "tdm" && minigames.session && (
            <button
              onClick={handleRedraw}
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
        <RoundHUD
          round={currentRound}
          player={currentPlayer}
          teams={minigames.teams}
          onNextTurn={roundResultScore != null && controller.state === "complete" ? nextTurn : undefined}
        />

        {mode === "ffa" && minigames.players.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-xs text-slate-200">
            <span className="uppercase tracking-[0.2em] text-slate-400">Current player</span>
            <select
              value={currentPlayerId}
              onChange={(event) => setCurrentPlayerId(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-1 text-xs text-white"
            >
              {minigames.players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-1 flex-wrap items-center justify-center gap-6">
          <div className="flex min-w-[280px] flex-1 flex-col items-center justify-center gap-6">
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
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Round complete
                </p>
                <p className="mt-2 text-2xl font-semibold text-teal-200">
                  {roundResultScore.toFixed(2)}
                </p>
                {roundResultPenalty != null && roundResultPenalty > 0 && (
                  <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-rose-200">
                    Timing penalty -{roundResultPenalty.toFixed(2)}
                  </p>
                )}
                <button
                  onClick={() => dispatch(setEvaluationDrawerOpen(true))}
                  className="mt-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs uppercase tracking-wide text-white/70 hover:border-white/30"
                >
                  View details
                </button>
              </div>
            )}
          </div>
          <LeaderboardPanel
            mode={mode ?? "ffa"}
            players={minigames.players}
            teams={minigames.teams}
            results={minigames.results}
          />
        </div>
      </div>

      <GameSelectModal
        open={selectOpen}
        onClose={() => setSelectOpen(false)}
        onSelect={handleModeSelect}
      />
      {mode && (
        <MinigameSetupModal
          open={setupOpen}
          mode={mode}
          onClose={() => setSetupOpen(false)}
          onStart={startGame}
        />
      )}
      <EvaluationDrawer
        open={minigames.ui.evaluationDrawerOpen}
        rounds={minigames.rounds}
        results={minigames.results}
        players={minigames.players}
        onClose={() => dispatch(setEvaluationDrawerOpen(false))}
      />
      <NewPlayerDialog
        open={newPlayerOpen}
        onClose={() => setNewPlayerOpen(false)}
        onCreate={handleCreatePlayer}
      />
      {mode === "tdm" && currentRound && (
        <VersusIntroOverlay
          open={tdmController.introOpen}
          leftName={
            minigames.players.find((player) => player.id === currentRound.player_a_id)?.name ??
            "Player A"
          }
          rightName={
            minigames.players.find((player) => player.id === currentRound.player_b_id)?.name ??
            "Player B"
          }
          leftAccent="rgba(45,212,191,0.65)"
          rightAccent="rgba(244,63,94,0.65)"
          onComplete={tdmController.handleIntroComplete}
        />
      )}
    </div>
  );
};
