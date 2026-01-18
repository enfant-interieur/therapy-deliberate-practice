import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
import { EndGameLoadingOverlay } from "../components/minigames/EndGameLoadingOverlay";
import { useFfaTurnController } from "../components/minigames/hooks/useFfaTurnController";
import { useTdmMatchController } from "../components/minigames/hooks/useTdmMatchController";
import { useFullscreen } from "../components/minigames/hooks/useFullscreen";
import { SwitchPlayerConfirmDialog } from "../components/minigames/SwitchPlayerConfirmDialog";
import {
  deriveActivePlayerId,
  getNextRoundForPlayer,
  getUpNextPlayerId,
  roundExampleKey
} from "../components/minigames/utils/turnUtils";
import { usePatientAudioBank } from "../patientAudio/usePatientAudioBank";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  useAddMinigamePlayersMutation,
  useAddMinigameTeamsMutation,
  useCreateMinigameSessionMutation,
  usePatchMinigameResumeMutation,
  useEndMinigameSessionMutation,
  useGenerateMinigameRoundsMutation,
  useGetTaskQuery,
  useLazyGetMinigameStateQuery,
  useRedrawMinigameRoundMutation
} from "../store/api";
import { useAppSelector } from "../store/hooks";
import { useLocalRuntimeClient } from "../hooks/useLocalRuntimeClient";
import { useMinigameState, selectFfaRoundCandidates, selectRoundsPerPlayerTarget } from "../store/minigamesSlice";
import type { PlayerDraft, TeamDraft } from "../components/minigames/PlayersTeamsStep";
import type { TaskSelectionState } from "../components/minigames/TaskSelectionStep";
import type { EvaluationResult } from "@deliberate/shared";
import { computeWinner, type WinnerSummary } from "../components/minigames/utils/computeWinner";

const modeCopy = {
  ffa: "Free For All",
  tdm: "Team Deathmatch"
};

const WARMUP_AHEAD = 2;
const NO_UNIQUE_PATIENT_STATEMENTS_LEFT = "NO_UNIQUE_PATIENT_STATEMENTS_LEFT";

const isDev = import.meta.env.DEV;

export const MinigamePlayPage = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const { snapshot: minigames, derived: minigameDerived, manager } = useMinigameState();
  const settings = useAppSelector((state) => state.settings);
  const roundsPerPlayerTarget = useAppSelector(selectRoundsPerPlayerTarget);
  const ffaRoundCandidates = useAppSelector(selectFfaRoundCandidates);
  const localRuntimeClient = useLocalRuntimeClient();
  const currentPlayerId = minigames.currentPlayerId;
  const currentRound = minigames.currentRound;
  const [selectOpen, setSelectOpen] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const [mode, setMode] = useState<"ffa" | "tdm" | null>(null);
  const [roundResultScore, setRoundResultScore] = useState<number | null>(null);
  const [roundResultPenalty, setRoundResultPenalty] = useState<number | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | undefined>(undefined);
  const [lastAttemptId, setLastAttemptId] = useState<string | undefined>(undefined);
  const [newPlayerOpen, setNewPlayerOpen] = useState(false);
  const [evaluationModalOpen, setEvaluationModalOpen] = useState(false);
  const [evaluationModalData, setEvaluationModalData] = useState<EvaluationResult | null>(null);
  const [evaluationContext, setEvaluationContext] = useState<{
    roundId?: string;
    playerId?: string | null;
    isFinalTurn: boolean;
    nextActionLabel: string;
  } | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [endGamePending, setEndGamePending] = useState(false);
  const endGamePendingRef = useRef(false);
  const [winnerSummary, setWinnerSummary] = useState<WinnerSummary | null>(null);
  const [switchTargetPlayerId, setSwitchTargetPlayerId] = useState<string | null>(null);
  const [promptExhaustedMessage, setPromptExhaustedMessage] = useState<string | null>(null);
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [ffaNextRoundBlocked, setFfaNextRoundBlocked] = useState(false);
  const [pendingWinnerState, setPendingWinnerState] = useState<{ summary: WinnerSummary | null } | null>(null);
  const handledPreselectRef = useRef(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const discardedRoundIdsRef = useRef<Set<string>>(new Set());
  const autoEndTriggeredRef = useRef<string | null>(null);
  const [pendingAutoEndSessionId, setPendingAutoEndSessionId] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const debugLog = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      if (!isDev) return;
      console.info(`[minigames] ${event}`, payload);
    },
    []
  );

  const [createSession] = useCreateMinigameSessionMutation();
  const [addTeams] = useAddMinigameTeamsMutation();
  const [addPlayers] = useAddMinigamePlayersMutation();
  const [generateRounds] = useGenerateMinigameRoundsMutation();
  const [endSession] = useEndMinigameSessionMutation();
  const [patchResume] = usePatchMinigameResumeMutation();
  const [fetchMinigameState, minigameState] = useLazyGetMinigameStateQuery();
  const [redrawRound] = useRedrawMinigameRoundMutation();
  const fullscreen = useFullscreen();
  const patientAudio = usePatientAudioBank({ loggerScope: "minigames" });
  const params = useParams();
  const sessionIdParam = params.sessionId;
  const patientAudioRef = useRef(patientAudio);
  const handleAudioRef = useCallback((node: HTMLAudioElement | null) => {
    audioRef.current = node;
    setAudioElement(node);
  }, []);

  const clearPromptExhaustion = useCallback(() => {
    setPromptExhaustedMessage(null);
  }, []);

  const handlePromptExhaustionError = useCallback((error: unknown) => {
    const payload = (error as { data?: { code?: string; error?: string } })?.data;
    if (payload?.code !== NO_UNIQUE_PATIENT_STATEMENTS_LEFT) return false;
    setPromptExhaustedMessage(
      payload.error ??
        "You\u2019ve used all available unique patient prompts for this session. Start a new game or broaden task selection."
    );
    return true;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    endGamePendingRef.current = endGamePending;
  }, [endGamePending]);

  const closeEvaluationModal = useCallback(() => {
    setEvaluationModalOpen(false);
    setEvaluationModalData(null);
    setEvaluationContext(null);
    setFfaNextRoundBlocked(false);
  }, []);

  useEffect(() => {
    patientAudioRef.current = patientAudio;
  }, [patientAudio]);

  useEffect(() => {
    clearPromptExhaustion();
  }, [clearPromptExhaustion, minigames.session?.id]);

  useEffect(() => {
    if (mode !== "ffa") {
      setFfaNextRoundBlocked(false);
    }
  }, [mode]);

  useEffect(() => {
    setFfaNextRoundBlocked(false);
  }, [minigames.session?.id]);

  useEffect(() => {
    setPendingAutoEndSessionId(null);
    setPendingWinnerState(null);
  }, [minigames.session?.id]);

  useEffect(() => {
    if (!minigames.session?.id || mode !== "ffa") {
      autoEndTriggeredRef.current = null;
      return;
    }
    if (autoEndTriggeredRef.current && autoEndTriggeredRef.current !== minigames.session.id) {
      autoEndTriggeredRef.current = null;
    }
  }, [minigames.session?.id, mode]);

  useEffect(() => {
    manager.setAppShellVisibility(true);
    return () => {
      manager.setAppShellVisibility(false);
    };
  }, [manager]);

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
      manager.hydrate(minigameState.data);
    }
  }, [manager, minigameState.data]);

  useEffect(() => {
    if (!sessionIdParam) return;
    setSelectOpen(false);
    setSetupOpen(false);
    void fetchMinigameState(sessionIdParam);
  }, [fetchMinigameState, sessionIdParam]);

  useEffect(() => {
    if (minigames.session?.game_type) {
      setMode(minigames.session.game_type);
    }
  }, [minigames.session]);

  useEffect(() => {
    if (handledPreselectRef.current) return;
    if (sessionIdParam) return;
    const state = location.state as { preselectedMode?: "ffa" | "tdm" } | null;
    if (!state?.preselectedMode) return;
    handledPreselectRef.current = true;
    setMode(state.preselectedMode);
    setSelectOpen(false);
    setSetupOpen(true);
  }, [location.state]);
  const roundFlowLocked = evaluationModalOpen || newPlayerOpen;
  const roundAdvanceLocked = roundFlowLocked || (mode === "ffa" && ffaNextRoundBlocked);

  useEffect(() => {
    if (!minigames.session?.id) return;
    if (minigames.session.ended_at) return;
    const handle = window.setTimeout(() => {
      void patchResume({
        sessionId: minigames.session?.id ?? "",
        current_round_id: minigames.currentRoundId ?? null,
        current_player_id: minigames.currentPlayerId ?? null
      });
    }, 900);
    return () => window.clearTimeout(handle);
  }, [
    minigames.currentPlayerId,
    minigames.currentRoundId,
    minigames.session?.ended_at,
    minigames.session?.id,
    patchResume
  ]);

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

  const completedRoundIdsByPlayer = useMemo(() => {
    return new Map(Object.entries(minigameDerived.completedRoundIdsByPlayer));
  }, [minigameDerived.completedRoundIdsByPlayer]);

  const playedExampleIdsByPlayer = useMemo(() => {
    return new Map(Object.entries(minigameDerived.playedExampleKeysByPlayer));
  }, [minigameDerived.playedExampleKeysByPlayer]);

  const endGame = useCallback(async () => {
    if (!minigames.session || endGamePending) return;
    setPendingAutoEndSessionId(null);
    closeEvaluationModal();
    setNewPlayerOpen(false);
    try {
      setEndGamePending(true);
      try {
        await endSession({ sessionId: minigames.session.id });
      } catch {
        // keep local state if end-session call fails
      }
      manager.setEvaluationDrawer(false);
      let nextState = {
        session: minigames.session,
        teams: minigames.teams,
        players: minigames.players,
        rounds: minigames.rounds,
        results: minigames.results
      };
      try {
        const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
        manager.hydrate(refreshed);
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
      if (!isMountedRef.current) return;
      if (roundFlowLocked) {
        setPendingWinnerState({ summary });
      } else {
        setWinnerSummary(summary);
        setEndGameOpen(true);
      }
    } finally {
      if (isMountedRef.current) {
        setEndGamePending(false);
      }
    }
  }, [
    closeEvaluationModal,
    endSession,
    endGamePending,
    fetchMinigameState,
    manager,
    minigames.players,
    minigames.results,
    minigames.rounds,
    minigames.session,
    minigames.teams,
    roundFlowLocked
  ]);

  const scheduleAutoEnd = useCallback(
    (reason: string) => {
      const sessionId = minigames.session?.id;
      if (!sessionId) return;
      if (autoEndTriggeredRef.current === sessionId) return;
      autoEndTriggeredRef.current = sessionId;
      debugLog("auto_end.schedule", {
        sessionId,
        reason,
        locked: evaluationModalOpen || roundFlowLocked
      });
      if (evaluationModalOpen || roundFlowLocked) {
        setPendingAutoEndSessionId(sessionId);
      } else {
        void endGame();
      }
    },
    [debugLog, endGame, evaluationModalOpen, minigames.session?.id, roundFlowLocked]
  );

  useEffect(() => {
    if (!minigames.session?.id) return;
    const actions = manager.verifyIntegrity({ lockRoundAdvance: roundAdvanceLocked });
    if (actions.length) {
      debugLog("integrity.actions", {
        sessionId: minigames.session.id,
        lockRoundAdvance: roundAdvanceLocked,
        actions
      });
    }
    if (actions.some((action) => action.type === "complete_session")) {
      scheduleAutoEnd("all_rounds_complete");
    }
  }, [
    debugLog,
    manager,
    minigames.results,
    minigames.rounds,
    minigames.session?.id,
    roundAdvanceLocked,
    scheduleAutoEnd
  ]);

  const handleReturnToHub = useCallback(() => {
    manager.reset();
    navigate("/minigames");
  }, [manager, navigate]);

  useEffect(() => {
    if (mode !== "ffa") return;
    if (!minigames.session?.id) return;
    if (!roundsPerPlayerTarget) return;
    if (!minigames.players.length) return;
    if (autoEndTriggeredRef.current === minigames.session.id) return;
    const allPlayersAtCap = minigames.players.every((player) => {
      const completed = completedRoundIdsByPlayer.get(player.id)?.size ?? 0;
      return completed >= roundsPerPlayerTarget;
    });
    if (allPlayersAtCap) {
      scheduleAutoEnd("ffa_round_cap");
    } else if (pendingAutoEndSessionId === minigames.session?.id) {
      setPendingAutoEndSessionId(null);
    }
  }, [
    completedRoundIdsByPlayer,
    endGame,
    evaluationModalOpen,
    minigames.players,
    minigames.session?.id,
    mode,
    pendingAutoEndSessionId,
    roundsPerPlayerTarget,
    scheduleAutoEnd
  ]);

  useEffect(() => {
    warmupRoundsRef.current = warmupRounds;
  }, [warmupRounds]);

  useEffect(() => {
    if (!pendingAutoEndSessionId) return;
    if (evaluationModalOpen) return;
    if (pendingAutoEndSessionId !== minigames.session?.id) {
      setPendingAutoEndSessionId(null);
      return;
    }
    setPendingAutoEndSessionId(null);
    void endGame();
  }, [endGame, evaluationModalOpen, minigames.session?.id, pendingAutoEndSessionId]);

  useEffect(() => {
    if (roundFlowLocked) return;
    if (!pendingWinnerState) return;
    setWinnerSummary(pendingWinnerState.summary);
    setEndGameOpen(true);
    setPendingWinnerState(null);
  }, [pendingWinnerState, roundFlowLocked]);

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
    enabled: mode === "ffa" && !roundFlowLocked,
    sessionId: minigames.session?.id ?? "",
    round: currentRound,
    playerId: currentRound?.player_a_id,
    aiMode: settings.aiMode,
    task: currentTask,
    localRuntimeClient,
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
      const resultPlayerId = currentRound?.player_a_id ?? null;
      if (!payload.attemptId || !currentRound || !resultPlayerId || !minigames.session) {
        return;
      }
      if (currentPlayerId && currentPlayerId !== resultPlayerId) {
        console.warn("[minigames] result_player_mismatch", {
          roundId: currentRound.id,
          expectedPlayerId: resultPlayerId,
          currentPlayerId
        });
        return;
      }
      if (payload.attemptId && currentRound && resultPlayerId && minigames.session) {
        manager.registerResult({
          roundId: currentRound.id,
          playerId: resultPlayerId,
          attemptId: payload.attemptId,
          overallScore: score ?? 0,
          overallPass: payload.evaluation?.overall?.pass ?? true,
          transcript: payload.transcript,
          evaluation: payload.evaluation as EvaluationResult | undefined,
          clientPenalty: payload.timingPenalty
        });
      }
      if (payload.evaluation && !endGamePendingRef.current) {
        setEvaluationContext({
          roundId: currentRound?.id,
          playerId: resultPlayerId,
          isFinalTurn: true,
          nextActionLabel: "Next round"
        });
        debugLog("evaluation.open", {
          mode: "ffa",
          playerId: resultPlayerId,
          roundId: currentRound?.id,
          attemptId: payload.attemptId
        });
        setEvaluationModalData(payload.evaluation as EvaluationResult);
        setEvaluationModalOpen(true);
        setFfaNextRoundBlocked(true);
      }
    }
  });

  const tdmController = useTdmMatchController({
    enabled: mode === "tdm" && !roundFlowLocked,
    sessionId: minigames.session?.id ?? "",
    round: currentRound,
    aiMode: settings.aiMode,
    task: currentTask,
    localRuntimeClient,
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
        manager.registerResult({
          roundId: currentRound.id,
          playerId: payload.playerId,
          attemptId: payload.attemptId,
          overallScore: score ?? 0,
          overallPass: payload.evaluation?.overall?.pass ?? true,
          transcript: payload.transcript,
          evaluation: payload.evaluation as EvaluationResult | undefined,
          clientPenalty: payload.timingPenalty
        });
      }
      debugLog("evaluation.received", {
        mode: "tdm",
        playerId: payload.playerId,
        roundId: currentRound?.id,
        attemptId: payload.attemptId,
        state: controller.state
      });
      if (payload.evaluation && !endGamePendingRef.current) {
        const isFinalTurn =
          !currentRound?.player_b_id || payload.playerId === currentRound?.player_b_id;
        setEvaluationContext({
          roundId: currentRound?.id,
          playerId: payload.playerId,
          isFinalTurn,
          nextActionLabel: mode === "tdm" && !isFinalTurn ? "Next turn" : "Next round"
        });
        debugLog("evaluation.open", {
          mode: "tdm",
          playerId: payload.playerId,
          roundId: currentRound?.id,
          attemptId: payload.attemptId
        });
        setEvaluationModalData(payload.evaluation as EvaluationResult);
        setEvaluationModalOpen(true);
      }
    }
  });

  const controller = mode === "tdm" ? tdmController : ffaController;
  const activePlayerId = useMemo(
    () =>
      deriveActivePlayerId({
        mode,
        currentRound,
        tdmActivePlayerId: tdmController.activePlayerId
      }),
    [currentRound, mode, tdmController.activePlayerId]
  );

  useEffect(() => {
    setLastTranscript(undefined);
    setLastAttemptId(undefined);
  }, [activePlayerId, currentRound?.id]);

  useEffect(() => {
    if (mode !== "ffa") return;
    if (ffaNextRoundBlocked) return;
    if (roundFlowLocked) return;
    if (!currentRound || !activePlayerId) return;
    if (currentRound.status === "completed") return;
    const playedExamples = playedExampleIdsByPlayer.get(activePlayerId);
    const completedRounds = completedRoundIdsByPlayer.get(activePlayerId);
    if (discardedRoundIdsRef.current.has(currentRound.id)) {
      const nextRound = getNextRoundForPlayer({
        rounds: minigames.rounds,
        playerId: activePlayerId,
        playedExampleIds: playedExamples,
        completedRoundIds: completedRounds,
        discardedRoundIds: discardedRoundIdsRef.current
      });
      if (nextRound && nextRound.id !== currentRound.id) {
        manager.setCurrentRound(nextRound.id);
      }
      return;
    }
    const exampleKey = roundExampleKey(currentRound);
    if (playedExamples?.has(exampleKey)) {
      const nextRound = getNextRoundForPlayer({
        rounds: minigames.rounds,
        playerId: activePlayerId,
        playedExampleIds: playedExamples,
        completedRoundIds: completedRounds,
        discardedRoundIds: discardedRoundIdsRef.current
      });
      if (nextRound && nextRound.id !== currentRound.id) {
        manager.setCurrentRound(nextRound.id);
      }
    }
  }, [
    activePlayerId,
    completedRoundIdsByPlayer,
    currentRound,
    ffaNextRoundBlocked,
    manager,
    minigames.rounds,
    mode,
    playedExampleIdsByPlayer,
    roundFlowLocked
  ]);

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
    clearPromptExhaustion();
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

    try {
      await generateRounds({
        sessionId: session.session_id,
        count: mode === "ffa" ? payload.players.length * payload.roundsPerPlayer : undefined
      }).unwrap();
    } catch (error) {
      if (handlePromptExhaustionError(error)) return;
      throw error;
    }

    await fetchMinigameState(session.session_id);
    manager.setCurrentRound(undefined);
    setSetupOpen(false);
    navigate(`/minigames/play/${session.session_id}`, { replace: true });
  };


  const nextTurn = useCallback((options?: { force?: boolean }) => {
    if (promptExhaustedMessage) return;
    if (mode === "ffa" && ffaNextRoundBlocked) return;
    if (!options?.force && roundFlowLocked) return;
    let nextRoundId: string | undefined;
    if (mode === "ffa") {
      nextRoundId = ffaRoundCandidates.find((roundId) => !discardedRoundIdsRef.current.has(roundId));
    }
    if (!nextRoundId) {
      const upcoming = [...minigames.rounds]
        .filter((round) => round.status !== "completed")
        .sort((a, b) => a.position - b.position);
      const fallback = upcoming.find((round) => {
        if (discardedRoundIdsRef.current.has(round.id)) return false;
        const completedRounds = completedRoundIdsByPlayer.get(round.player_a_id);
        if (completedRounds?.has(round.id)) return false;
        const playedExamples = playedExampleIdsByPlayer.get(round.player_a_id);
        if (playedExamples?.has(roundExampleKey(round))) return false;
        return true;
      });
      nextRoundId = fallback?.id;
    }
    debugLog("next_turn", {
      mode,
      currentRoundId: currentRound?.id ?? null,
      nextRoundId: nextRoundId ?? null
    });
    manager.setCurrentRound(nextRoundId);
    setRoundResultScore(null);
    setRoundResultPenalty(null);
  }, [
    completedRoundIdsByPlayer,
    currentRound?.id,
    debugLog,
    ffaNextRoundBlocked,
    ffaRoundCandidates,
    manager,
    minigames.rounds,
    mode,
    playedExampleIdsByPlayer,
    promptExhaustedMessage,
    roundFlowLocked
  ]);

  const requestNextTurn = useCallback(() => {
    nextTurn();
  }, [nextTurn]);

  const resetLocalState = () => {
    controller.stopPatient();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    clearPromptExhaustion();
    setMode(null);
    setSelectOpen(true);
    setSetupOpen(false);
    manager.setCurrentPlayer(undefined);
    setRoundResultScore(null);
    setRoundResultPenalty(null);
    setLastTranscript(undefined);
    setLastAttemptId(undefined);
    setPendingAutoEndSessionId(null);
    setPendingWinnerState(null);
    closeEvaluationModal();
    setNewPlayerOpen(false);
    setEndGameOpen(false);
    setWinnerSummary(null);
  };

  const handleEvaluationAdvance = useCallback(() => {
    const context = evaluationContext;
    const currentRoundId = currentRound?.id;
    const shouldResumeTdm =
      mode === "tdm" &&
      context != null &&
      !context.isFinalTurn &&
      context.roundId != null &&
      currentRoundId != null &&
      context.roundId === currentRoundId;
    closeEvaluationModal();
    if (shouldResumeTdm) {
      tdmController.startRoundOrMatch();
      return;
    }
    nextTurn({ force: true });
  }, [closeEvaluationModal, currentRound?.id, evaluationContext, mode, nextTurn, tdmController]);

  const handleEvaluationClose = useCallback(() => {
    if (mode === "tdm") {
      handleEvaluationAdvance();
      return;
    }
    closeEvaluationModal();
  }, [closeEvaluationModal, handleEvaluationAdvance, mode]);

  const handleFinalReviewClose = () => {
    manager.setEvaluationDrawer(false);
    manager.reset();
    controller.stopPatient();
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    resetLocalState();
    navigate("/", { replace: true });
  };

  const handleCreatePlayer = async (payload: { name: string; avatar: string }) => {
    if (!minigames.session) return;
    controller.abortTurn("new-player");
    if (currentRound?.id) {
      discardedRoundIdsRef.current.add(currentRound.id);
    }
    setLastTranscript(undefined);
    setLastAttemptId(undefined);
    setRoundResultScore(null);
    setRoundResultPenalty(null);
    const response = await addPlayers({
      sessionId: minigames.session.id,
      players: [{ name: payload.name, avatar: payload.avatar }]
    }).unwrap();
    const newPlayer = response.players[0];
    const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
    manager.hydrate(refreshed);
    const completedRoundIdsByPlayer = refreshed.results.reduce<Map<string, Set<string>>>((acc, result) => {
      const set = acc.get(result.player_id) ?? new Set<string>();
      set.add(result.round_id);
      acc.set(result.player_id, set);
      return acc;
    }, new Map());
    const playedExampleIdsByPlayer = refreshed.results.reduce<Map<string, Set<string>>>((acc, result) => {
      const round = refreshed.rounds.find((entry) => entry.id === result.round_id);
      if (!round) return acc;
      const set = acc.get(result.player_id) ?? new Set<string>();
      set.add(roundExampleKey(round));
      acc.set(result.player_id, set);
      return acc;
    }, new Map());
    let nextForNewPlayer = getNextRoundForPlayer({
      rounds: refreshed.rounds,
      playerId: newPlayer.id,
      playedExampleIds: playedExampleIdsByPlayer.get(newPlayer.id),
      completedRoundIds: completedRoundIdsByPlayer.get(newPlayer.id),
      discardedRoundIds: discardedRoundIdsRef.current
    });
    if (!nextForNewPlayer) {
      try {
        await generateRounds({
          sessionId: minigames.session.id,
          count: roundsPerPlayerTarget ?? refreshed.players.length
        }).unwrap();
      } catch (error) {
        if (handlePromptExhaustionError(error)) {
          setNewPlayerOpen(false);
          return;
        }
        throw error;
      }
      const updated = await fetchMinigameState(minigames.session.id).unwrap();
      manager.hydrate(updated);
      const updatedCompletedRoundIds = updated.results.reduce<Map<string, Set<string>>>((acc, result) => {
        const set = acc.get(result.player_id) ?? new Set<string>();
        set.add(result.round_id);
        acc.set(result.player_id, set);
        return acc;
      }, new Map());
      const updatedExampleIds = updated.results.reduce<Map<string, Set<string>>>((acc, result) => {
        const round = updated.rounds.find((entry) => entry.id === result.round_id);
        if (!round) return acc;
        const set = acc.get(result.player_id) ?? new Set<string>();
        set.add(roundExampleKey(round));
        acc.set(result.player_id, set);
        return acc;
      }, new Map());
      nextForNewPlayer = getNextRoundForPlayer({
        rounds: updated.rounds,
        playerId: newPlayer.id,
        playedExampleIds: updatedExampleIds.get(newPlayer.id),
        completedRoundIds: updatedCompletedRoundIds.get(newPlayer.id),
        discardedRoundIds: discardedRoundIdsRef.current
      });
    }
    manager.setCurrentRound(nextForNewPlayer?.id);
    setNewPlayerOpen(false);
    closeEvaluationModal();
  };

  const handleRedraw = async () => {
    if (!minigames.session) return;
    controller.abortTurn("redraw");
    try {
      await redrawRound({ sessionId: minigames.session.id }).unwrap();
      clearPromptExhaustion();
    } catch (error) {
      if (handlePromptExhaustionError(error)) return;
      throw error;
    }
    const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
    manager.hydrate(refreshed);
    manager.setCurrentRound(refreshed.rounds.find((round) => round.status !== "completed")?.id);
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

  const nextTurnDisabled = Boolean(promptExhaustedMessage);

  const canRequestNextTurn =
    !roundFlowLocked && roundResultScore != null && controller.state === "complete";

  const canRedraw =
    mode === "tdm" &&
    controller.state !== "recording" &&
    controller.state !== "transcribing" &&
    controller.state !== "evaluating" &&
    controller.state !== "patient_playing" &&
    !promptExhaustedMessage;

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

  const upNextPlayerId = useMemo(() => {
    if (mode !== "ffa") return null;
    return getUpNextPlayerId(minigames.rounds);
  }, [minigames.rounds, mode]);

  const canSwitchPlayer =
    mode === "ffa" &&
    controller.state !== "recording" &&
    controller.state !== "transcribing" &&
    controller.state !== "evaluating" &&
    controller.state !== "patient_playing";

  const lockedPlayerId = activePlayerId ?? currentPlayerId ?? null;

  const handleRequestSwitchPlayer = (playerId: string) => {
    if (!canSwitchPlayer) return;
    if (playerId === lockedPlayerId) return;
    setSwitchTargetPlayerId(playerId);
    setSwitchDialogOpen(true);
  };

  const handleConfirmSwitchPlayer = async () => {
    if (!minigames.session || !switchTargetPlayerId) return;
    if (switchTargetPlayerId === lockedPlayerId) return;
    controller.abortTurn("switch-player");
    if (currentRound?.id) {
      discardedRoundIdsRef.current.add(currentRound.id);
    }
    setLastTranscript(undefined);
    setLastAttemptId(undefined);
    setRoundResultScore(null);
    setRoundResultPenalty(null);
    let nextRound = getNextRoundForPlayer({
      rounds: minigames.rounds,
      playerId: switchTargetPlayerId,
      playedExampleIds: playedExampleIdsByPlayer.get(switchTargetPlayerId),
      completedRoundIds: completedRoundIdsByPlayer.get(switchTargetPlayerId),
      discardedRoundIds: discardedRoundIdsRef.current
    });
    if (!nextRound) {
      try {
        await generateRounds({ sessionId: minigames.session.id, count: minigames.players.length }).unwrap();
      } catch (error) {
        if (handlePromptExhaustionError(error)) {
          setSwitchDialogOpen(false);
          setSwitchTargetPlayerId(null);
          return;
        }
        throw error;
      }
      const refreshed = await fetchMinigameState(minigames.session.id).unwrap();
      manager.hydrate(refreshed);
      const refreshedCompletedRounds = refreshed.results.reduce<Map<string, Set<string>>>((acc, result) => {
        const set = acc.get(result.player_id) ?? new Set<string>();
        set.add(result.round_id);
        acc.set(result.player_id, set);
        return acc;
      }, new Map());
      const refreshedExampleIds = refreshed.results.reduce<Map<string, Set<string>>>((acc, result) => {
        const round = refreshed.rounds.find((entry) => entry.id === result.round_id);
        if (!round) return acc;
        const set = acc.get(result.player_id) ?? new Set<string>();
        set.add(roundExampleKey(round));
        acc.set(result.player_id, set);
        return acc;
      }, new Map());
      nextRound = getNextRoundForPlayer({
        rounds: refreshed.rounds,
        playerId: switchTargetPlayerId,
        playedExampleIds: refreshedExampleIds.get(switchTargetPlayerId),
        completedRoundIds: refreshedCompletedRounds.get(switchTargetPlayerId),
        discardedRoundIds: discardedRoundIdsRef.current
      });
    }
    manager.setCurrentRound(nextRound?.id);
    setSwitchDialogOpen(false);
    setSwitchTargetPlayerId(null);
  };

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
          rounds={minigames.rounds}
          results={minigames.results}
          currentRound={currentRound}
          currentTask={currentTask}
          activePlayerId={activePlayerId}
          upNextPlayerId={upNextPlayerId}
          canSwitchPlayer={canSwitchPlayer}
          onRequestSwitchPlayer={handleRequestSwitchPlayer}
          controller={controller}
          micLabel={micLabel}
          roundResultScore={roundResultScore}
          roundResultPenalty={roundResultPenalty}
          transcriptEligible={transcriptEligible}
          transcriptHidden={minigames.ui.transcriptHidden}
          transcriptText={lastTranscript}
          transcriptProcessingStage={controller.processingStage}
          onToggleTranscript={() => manager.toggleTranscript()}
          onNextTurn={canRequestNextTurn ? requestNextTurn : undefined}
          nextTurnDisabled={nextTurnDisabled}
          onOpenEvaluation={() => manager.setEvaluationDrawer(true)}
          onEndGame={endGame}
          onNewGame={() => {
            manager.reset();
            resetLocalState();
          }}
          onNewPlayer={() => setNewPlayerOpen(true)}
          onRedraw={handleRedraw}
          canRedraw={canRedraw}
          promptExhaustedMessage={promptExhaustedMessage}
          fullscreen={fullscreen}
        />
      ) : (
        <DesktopMinigameLayout
          mode={mode}
          modeCopy={modeCopy}
          session={minigames.session}
          teams={minigames.teams}
          players={minigames.players}
          rounds={minigames.rounds}
          results={minigames.results}
          currentRound={currentRound}
          currentTask={currentTask}
          activePlayerId={activePlayerId}
          upNextPlayerId={upNextPlayerId}
          canSwitchPlayer={canSwitchPlayer}
          onRequestSwitchPlayer={handleRequestSwitchPlayer}
          controller={controller}
          micLabel={micLabel}
          roundResultScore={roundResultScore}
          roundResultPenalty={roundResultPenalty}
          transcriptEligible={transcriptEligible}
          transcriptHidden={minigames.ui.transcriptHidden}
          transcriptText={lastTranscript}
          transcriptProcessingStage={controller.processingStage}
          onToggleTranscript={() => manager.toggleTranscript()}
          onNextTurn={canRequestNextTurn ? requestNextTurn : undefined}
          nextTurnDisabled={nextTurnDisabled}
          onOpenEvaluation={() => manager.setEvaluationDrawer(true)}
          onEndGame={endGame}
          onNewGame={() => {
            manager.reset();
            resetLocalState();
          }}
          onNewPlayer={() => setNewPlayerOpen(true)}
          onRedraw={handleRedraw}
          canRedraw={canRedraw}
          promptExhaustedMessage={promptExhaustedMessage}
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
      <EndGameLoadingOverlay open={endGamePending} onReturnToHub={handleReturnToHub} />
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
        onClose={handleEvaluationClose}
        onNextRound={handleEvaluationAdvance}
        nextActionLabel={evaluationContext?.nextActionLabel}
        onAddPlayer={mode === "ffa" ? () => setNewPlayerOpen(true) : undefined}
      />
      <NewPlayerDialog
        open={newPlayerOpen}
        onClose={() => setNewPlayerOpen(false)}
        onCreate={handleCreatePlayer}
      />
      <SwitchPlayerConfirmDialog
        open={switchDialogOpen}
        playerName={minigames.players.find((player) => player.id === switchTargetPlayerId)?.name}
        onCancel={() => {
          setSwitchDialogOpen(false);
          setSwitchTargetPlayerId(null);
        }}
        onConfirm={handleConfirmSwitchPlayer}
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
