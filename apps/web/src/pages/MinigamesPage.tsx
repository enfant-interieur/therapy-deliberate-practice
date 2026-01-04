import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GameSelectModal } from "../components/minigames/GameSelectModal";
import { MinigameSetupModal } from "../components/minigames/MinigameSetupModal";
import { AudioReactiveBackground } from "../components/minigames/AudioReactiveBackground";
import { EvaluationDrawer } from "../components/minigames/EvaluationDrawer";
import { EvaluationModal } from "../components/minigames/EvaluationModal";
import { NewPlayerDialog } from "../components/minigames/NewPlayerDialog";
import { VersusIntroOverlay } from "../components/minigames/VersusIntroOverlay";
import { DesktopMinigameLayout } from "../components/minigames/DesktopMinigameLayout";
import { MobileMinigameLayout } from "../components/minigames/MobileMinigameLayout";
import { EndGameResultsOverlay } from "../components/minigames/EndGameResultsOverlay";
import { useFfaTurnController } from "../components/minigames/hooks/useFfaTurnController";
import { useTdmMatchController } from "../components/minigames/hooks/useTdmMatchController";
import { useFullscreen } from "../components/minigames/hooks/useFullscreen";
import { usePatientAudioBank } from "../patientAudio/usePatientAudioBank";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  useAddMinigamePlayersMutation,
  useAddMinigameTeamsMutation,
  useCreateMinigameSessionMutation,
  useEndMinigameSessionMutation,
  useGenerateMinigameRoundsMutation,
  useGetTaskQuery,
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
import { computeWinner, type WinnerSummary } from "../components/minigames/utils/computeWinner";

const modeCopy = {
  ffa: "Free For All",
  tdm: "Team Deathmatch"
};

const WARMUP_AHEAD = 2;

export const MinigamesPage = () => {
  const dispatch = useAppDispatch();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const minigames = useAppSelector((state) => state.minigames);
  const settings = useAppSelector((state) => state.settings);
  const [selectOpen, setSelectOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [mode, setMode] = useState<"ffa" | "tdm" | null>(null);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | undefined>(undefined);
  const [roundResultScore, setRoundResultScore] = useState<number | null>(null);
  const [roundResultPenalty, setRoundResultPenalty] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | undefined>(undefined);
  const [lastAttemptId, setLastAttemptId] = useState<string | undefined>(undefined);
  const [newPlayerOpen, setNewPlayerOpen] = useState(false);
  const [evaluationModalOpen, setEvaluationModalOpen] = useState(false);
  const [evaluationModalData, setEvaluationModalData] = useState<EvaluationResult | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [winnerSummary, setWinnerSummary] = useState<WinnerSummary | null>(null);
  const handledPreselectRef = useRef(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

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
    const root = document.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = "80%";
    return () => {
      root.style.fontSize = previousFontSize;
    };
  }, []);

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
      const playerId = minigames.players[0].id;
      setCurrentPlayerId(playerId);
      const nextForPlayer = minigames.rounds.find(
        (round) => round.status !== "completed" && round.player_a_id === playerId
      );
      if (nextForPlayer && nextForPlayer.id !== minigames.currentRoundId) {
        dispatch(setCurrentRoundId(nextForPlayer.id));
      }
    }
  }, [currentPlayerId, dispatch, minigames.currentRoundId, minigames.players, minigames.rounds, mode]);

  const currentRound = useMemo(
    () =>
      minigames.rounds.find((round) => round.id === minigames.currentRoundId) ??
      minigames.rounds.find((round) => round.status !== "completed"),
    [minigames.currentRoundId, minigames.rounds]
  );
  const currentTaskId = currentRound?.task_id;
  const { data: currentTask } = useGetTaskQuery(
    { id: currentTaskId ?? "" },
    { skip: !currentTaskId }
  );
  const { data: evaluationTask } = useGetTaskQuery(
    { id: evaluationModalData?.task_id ?? "" },
    { skip: !evaluationModalData?.task_id }
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

  useEffect(() => {
    setLastTranscript(undefined);
    setLastAttemptId(undefined);
    setRoundResultScore(null);
    setRoundResultPenalty(null);
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
    aiMode: settings.aiMode,
    audioElement,
    patientAudio,
    responseTimerEnabled: timingSettings.responseTimerEnabled,
    responseTimerSeconds: timingSettings.responseTimerSeconds,
    maxResponseEnabled: timingSettings.maxResponseEnabled,
    maxResponseSeconds: timingSettings.maxResponseSeconds,
    onTranscript: (payload) => {
      if (payload.attemptId) {
        setLastAttemptId(payload.attemptId);
      }
      if (payload.transcript) {
        setLastTranscript(payload.transcript);
      }
    },
    onResult: (payload) => {
      if (payload.attemptId) {
        setLastAttemptId(payload.attemptId);
      }
      setLastTranscript(payload.transcript);
      const scoreFromEval =
        typeof (payload.evaluation as EvaluationResult | undefined)?.overall?.score === "number"
          ? (payload.evaluation as EvaluationResult).overall.score
          : null;
      const score = payload.score ?? scoreFromEval;
      setRoundResultScore(score ?? null);
      setRoundResultPenalty(payload.timingPenalty ?? null);
      if (payload.attemptId && currentRound && currentPlayerId && minigames.session) {
        dispatch(
          addRoundResult({
            roundId: currentRound.id,
            playerId: currentPlayerId,
            attemptId: payload.attemptId,
            overallScore: score ?? 0,
            overallPass: true,
            transcript: payload.transcript,
            evaluation: payload.evaluation as EvaluationResult | undefined,
            clientPenalty: payload.timingPenalty
          })
        );
      }
      if (payload.evaluation) {
        setEvaluationModalData(payload.evaluation as EvaluationResult);
        setEvaluationModalOpen(true);
      }
    }
  });

  const tdmController = useTdmMatchController({
    enabled: mode === "tdm",
    sessionId: minigames.session?.id ?? "",
    round: currentRound,
    aiMode: settings.aiMode,
    audioElement,
    patientAudio,
    responseTimerEnabled: timingSettings.responseTimerEnabled,
    responseTimerSeconds: timingSettings.responseTimerSeconds,
    maxResponseEnabled: timingSettings.maxResponseEnabled,
    maxResponseSeconds: timingSettings.maxResponseSeconds,
    onTranscript: (payload) => {
      if (payload.attemptId) {
        setLastAttemptId(payload.attemptId);
      }
      if (payload.transcript) {
        setLastTranscript(payload.transcript);
      }
    },
    onResult: (payload) => {
      if (payload.attemptId) {
        setLastAttemptId(payload.attemptId);
      }
      setLastTranscript(payload.transcript);
      const scoreFromEval =
        typeof (payload.evaluation as EvaluationResult | undefined)?.overall?.score === "number"
          ? (payload.evaluation as EvaluationResult).overall.score
          : null;
      const score = payload.score ?? scoreFromEval;
      setRoundResultScore(score ?? null);
      setRoundResultPenalty(payload.timingPenalty ?? null);
      if (payload.attemptId && currentRound && minigames.session) {
        dispatch(
          addRoundResult({
            roundId: currentRound.id,
            playerId: payload.playerId,
            attemptId: payload.attemptId,
            overallScore: score ?? 0,
            overallPass: true,
            transcript: payload.transcript,
            evaluation: payload.evaluation as EvaluationResult | undefined,
            clientPenalty: payload.timingPenalty
          })
        );
      }
      if (payload.evaluation) {
        setEvaluationModalData(payload.evaluation as EvaluationResult);
        setEvaluationModalOpen(true);
      }
    }
  });

  const controller = mode === "tdm" ? tdmController : ffaController;
  const activePlayerId = mode === "tdm" ? tdmController.activePlayerId : currentPlayerId;
  const currentPlayer = minigames.players.find((player) => player.id === activePlayerId);

  const handlePlayerChange = (playerId: string) => {
    setCurrentPlayerId(playerId);
    if (mode !== "ffa" || evaluationModalOpen) return;
    const nextForPlayer = minigames.rounds.find(
      (round) => round.status !== "completed" && round.player_a_id === playerId
    );
    if (nextForPlayer && nextForPlayer.id !== minigames.currentRoundId) {
      dispatch(setCurrentRoundId(nextForPlayer.id));
    }
  };

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
    dispatch(setEvaluationDrawerOpen(false));
    let nextState = {
      session: minigames.session,
      teams: minigames.teams,
      players: minigames.players,
      rounds: minigames.rounds,
      results: minigames.results
    };
    try {
      const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
      dispatch(setMinigameState(refreshed));
      nextState = refreshed;
    } catch {
      // keep local state if fetch fails
    }
    const summary = computeWinner({
      mode: nextState.session.game_type,
      players: nextState.players,
      teams: nextState.teams,
      results: nextState.results
    });
    setWinnerSummary(summary);
    setEndGameOpen(true);
  };

  const nextTurn = () => {
    const next = minigames.rounds.find((round) => round.status !== "completed");
    dispatch(setCurrentRoundId(next?.id));
    setRoundResultScore(null);
    setRoundResultPenalty(null);
  };

  const resetLocalState = () => {
    controller.stopPatient();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    setMode(null);
    setSelectOpen(true);
    setSetupOpen(false);
    setCurrentPlayerId(undefined);
    setRoundResultScore(null);
    setRoundResultPenalty(null);
    setLastTranscript(undefined);
    setLastAttemptId(undefined);
    setEvaluationModalOpen(false);
    setEvaluationModalData(null);
    setNewPlayerOpen(false);
    setEndGameOpen(false);
    setWinnerSummary(null);
  };

  const handleFinalReviewClose = () => {
    dispatch(setEvaluationDrawerOpen(false));
    dispatch(resetMinigame());
    controller.stopPatient();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    resetLocalState();
    navigate("/", { replace: true });
  };

  const handleNextRound = () => {
    setEvaluationModalOpen(false);
    setEvaluationModalData(null);
    nextTurn();
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
    controller.state !== "transcribing" &&
    controller.state !== "evaluating" &&
    controller.state !== "patient_playing";

  const currentScore = useMemo(() => {
    if (!activePlayerId) return null;
    return minigames.results
      .filter((result) => result.player_id === activePlayerId)
      .reduce((total, result) => total + result.overall_score, 0);
  }, [activePlayerId, minigames.results]);

  const previousScore = useMemo(() => {
    if (!activePlayerId) return null;
    const history = minigames.results
      .filter((result) => result.player_id === activePlayerId)
      .sort((a, b) => a.created_at - b.created_at);
    if (history.length < 2) return null;
    const previousEvaluation = history[history.length - 2].evaluation;
    if (!previousEvaluation?.criterion_scores?.length) return null;
    return previousEvaluation.criterion_scores.reduce((total, score) => total + score.score, 0);
  }, [activePlayerId, minigames.results]);

  const transcriptEligible = Boolean(
    (lastTranscript && lastTranscript.trim().length > 0) ||
      controller.processingStage ||
      lastAttemptId
  );

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-slate-950 text-white">
      <AudioReactiveBackground
        audioElement={audioElement}
        isPlaying={controller.audioStatus === "playing"}
      />
      <audio ref={handleAudioRef} preload="auto" playsInline />

      {isMobile ? (
        <MobileMinigameLayout
          mode={mode}
          modeCopy={modeCopy}
          session={minigames.session}
          teams={minigames.teams}
          players={minigames.players}
          results={minigames.results}
          currentRound={currentRound}
          currentTask={currentTask}
          currentPlayer={currentPlayer}
          currentPlayerId={currentPlayerId}
          onPlayerChange={handlePlayerChange}
          controller={controller}
          micLabel={micLabel}
          roundResultScore={roundResultScore}
          roundResultPenalty={roundResultPenalty}
          currentScore={currentScore}
          transcriptEligible={transcriptEligible}
          transcriptHidden={minigames.ui.transcriptHidden}
          transcriptText={lastTranscript}
          transcriptProcessingStage={controller.processingStage}
          onToggleTranscript={() => dispatch(toggleTranscriptHidden())}
          onNextTurn={
            roundResultScore != null && controller.state === "complete" ? nextTurn : undefined
          }
          onOpenEvaluation={() => dispatch(setEvaluationDrawerOpen(true))}
          onEndGame={endGame}
          onNewGame={() => {
            dispatch(resetMinigame());
            resetLocalState();
          }}
          onNewPlayer={() => setNewPlayerOpen(true)}
          onRedraw={handleRedraw}
          canRedraw={canRedraw}
          fullscreen={fullscreen}
        />
      ) : (
        <DesktopMinigameLayout
          mode={mode}
          modeCopy={modeCopy}
          session={minigames.session}
          teams={minigames.teams}
          players={minigames.players}
          results={minigames.results}
          currentRound={currentRound}
          currentTask={currentTask}
          currentPlayer={currentPlayer}
          currentPlayerId={currentPlayerId}
          onPlayerChange={handlePlayerChange}
          controller={controller}
          micLabel={micLabel}
          roundResultScore={roundResultScore}
          roundResultPenalty={roundResultPenalty}
          transcriptEligible={transcriptEligible}
          transcriptHidden={minigames.ui.transcriptHidden}
          transcriptText={lastTranscript}
          transcriptProcessingStage={controller.processingStage}
          onToggleTranscript={() => dispatch(toggleTranscriptHidden())}
          onNextTurn={
            roundResultScore != null && controller.state === "complete" ? nextTurn : undefined
          }
          onOpenEvaluation={() => dispatch(setEvaluationDrawerOpen(true))}
          onEndGame={endGame}
          onNewGame={() => {
            dispatch(resetMinigame());
            resetLocalState();
          }}
          onNewPlayer={() => setNewPlayerOpen(true)}
          onRedraw={handleRedraw}
          canRedraw={canRedraw}
          fullscreen={fullscreen}
        />
      )}

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
        onClose={handleFinalReviewClose}
      />
      <EndGameResultsOverlay
        open={endGameOpen}
        mode={mode ?? "ffa"}
        players={minigames.players}
        teams={minigames.teams}
        rounds={minigames.rounds}
        results={minigames.results}
        winner={winnerSummary}
        onClose={handleFinalReviewClose}
      />
      <EvaluationModal
        open={evaluationModalOpen}
        evaluation={evaluationModalData}
        criteria={evaluationTask?.criteria ?? []}
        previousScore={previousScore}
        roundScore={roundResultScore}
        mode={mode ?? "ffa"}
        onClose={() => {
          setEvaluationModalOpen(false);
          setEvaluationModalData(null);
        }}
        onNextRound={handleNextRound}
        onAddPlayer={mode === "ffa" ? () => setNewPlayerOpen(true) : undefined}
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
