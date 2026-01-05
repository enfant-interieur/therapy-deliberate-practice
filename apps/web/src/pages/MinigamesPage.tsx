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
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  addRoundResult,
  resetMinigame,
  setCurrentPlayerId,
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
const NO_UNIQUE_PATIENT_STATEMENTS_LEFT = "NO_UNIQUE_PATIENT_STATEMENTS_LEFT";

export const MinigamePlayPage = () => {
  const dispatch = useAppDispatch();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const minigames = useAppSelector((state) => state.minigames);
  const settings = useAppSelector((state) => state.settings);
  const currentPlayerId = minigames.currentPlayerId;
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
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [winnerSummary, setWinnerSummary] = useState<WinnerSummary | null>(null);
  const [switchTargetPlayerId, setSwitchTargetPlayerId] = useState<string | null>(null);
  const [promptExhaustedMessage, setPromptExhaustedMessage] = useState<string | null>(null);
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const handledPreselectRef = useRef(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const discardedRoundIdsRef = useRef<Set<string>>(new Set());

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
    patientAudioRef.current = patientAudio;
  }, [patientAudio]);

  useEffect(() => {
    clearPromptExhaustion();
  }, [clearPromptExhaustion, minigames.session?.id]);

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


  const currentRound = useMemo(
      () =>
          minigames.rounds.find((round) => round.id === minigames.currentRoundId) ??
          minigames.rounds.find((round) => round.status !== "completed"),
      [minigames.currentRoundId, minigames.rounds]
  );

  useEffect(() => {
    if (mode !== "ffa") return;
    if (!minigames.rounds.length) return;
    if (minigames.currentRoundId && currentRound) return;
    const nextRound = minigames.rounds
      .filter((round) => round.status !== "completed")
      .sort((a, b) => a.position - b.position)
      .find((round) => !discardedRoundIdsRef.current.has(round.id));
    if (nextRound && nextRound.id !== minigames.currentRoundId) {
      dispatch(setCurrentRoundId(nextRound.id));
    }
  }, [currentRound, dispatch, minigames.currentRoundId, minigames.rounds, mode]);

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
    return minigames.results.reduce<Map<string, Set<string>>>((acc, result) => {
      const set = acc.get(result.player_id) ?? new Set<string>();
      set.add(result.round_id);
      acc.set(result.player_id, set);
      return acc;
    }, new Map());
  }, [minigames.results]);

  const playedExampleIdsByPlayer = useMemo(() => {
    return minigames.results.reduce<Map<string, Set<string>>>((acc, result) => {
      const round = minigames.rounds.find((entry) => entry.id === result.round_id);
      if (!round) return acc;
      const set = acc.get(result.player_id) ?? new Set<string>();
      set.add(roundExampleKey(round));
      acc.set(result.player_id, set);
      return acc;
    }, new Map());
  }, [minigames.results, minigames.rounds]);

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
    playerId: currentRound?.player_a_id,
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
        dispatch(
          addRoundResult({
            roundId: currentRound.id,
            playerId: resultPlayerId,
            attemptId: payload.attemptId,
            overallScore: score ?? 0,
            overallPass: payload.evaluation?.overall?.pass ?? true,
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
            overallPass: payload.evaluation?.overall?.pass ?? true,
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
    if (!currentRound || !activePlayerId) return;
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
        dispatch(setCurrentRoundId(nextRound.id));
      }
      return;
    }
    const exampleKey = roundExampleKey(currentRound);
    if (playedExamples?.has(exampleKey) || completedRounds?.has(currentRound.id)) {
      const nextRound = getNextRoundForPlayer({
        rounds: minigames.rounds,
        playerId: activePlayerId,
        playedExampleIds: playedExamples,
        completedRoundIds: completedRounds,
        discardedRoundIds: discardedRoundIdsRef.current
      });
      if (nextRound && nextRound.id !== currentRound.id) {
        dispatch(setCurrentRoundId(nextRound.id));
      }
    }
  }, [
    activePlayerId,
    completedRoundIdsByPlayer,
    currentRound,
    dispatch,
    minigames.rounds,
    mode,
    playedExampleIdsByPlayer
  ]);

  useEffect(() => {
    if (!activePlayerId) return;
    if (minigames.currentPlayerId === activePlayerId) return;
    dispatch(setCurrentPlayerId(activePlayerId));
  }, [activePlayerId, dispatch, minigames.currentPlayerId]);

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
        count: mode === "ffa" ? 3 : undefined
      }).unwrap();
    } catch (error) {
      if (handlePromptExhaustionError(error)) return;
      throw error;
    }

    await fetchMinigameState(session.session_id);
    dispatch(setCurrentRoundId(undefined));
    setSetupOpen(false);
    navigate(`/minigames/play/${session.session_id}`, { replace: true });
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
    if (promptExhaustedMessage) return;
    const upcoming = [...minigames.rounds]
      .filter((round) => round.status !== "completed")
      .sort((a, b) => a.position - b.position);
    const next = upcoming.find((round) => {
      if (discardedRoundIdsRef.current.has(round.id)) return false;
      const completedRounds = completedRoundIdsByPlayer.get(round.player_a_id);
      if (completedRounds?.has(round.id)) return false;
      const playedExamples = playedExampleIdsByPlayer.get(round.player_a_id);
      if (playedExamples?.has(roundExampleKey(round))) return false;
      return true;
    });
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
    clearPromptExhaustion();
    setMode(null);
    setSelectOpen(true);
    setSetupOpen(false);
    dispatch(setCurrentPlayerId(undefined));
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
    dispatch(setMinigameState(refreshed));
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
        await generateRounds({ sessionId: minigames.session.id, count: refreshed.players.length }).unwrap();
      } catch (error) {
        if (handlePromptExhaustionError(error)) {
          setNewPlayerOpen(false);
          return;
        }
        throw error;
      }
      const updated = await fetchMinigameState(minigames.session.id).unwrap();
      dispatch(setMinigameState(updated));
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
    dispatch(setCurrentRoundId(nextForNewPlayer?.id));
    setNewPlayerOpen(false);
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

  const nextTurnDisabled = Boolean(promptExhaustedMessage);

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

  const handleRequestSwitchPlayer = (playerId: string) => {
    if (!canSwitchPlayer) return;
    if (playerId === activePlayerId) return;
    setSwitchTargetPlayerId(playerId);
    setSwitchDialogOpen(true);
  };

  const handleConfirmSwitchPlayer = async () => {
    if (!minigames.session || !switchTargetPlayerId) return;
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
      dispatch(setMinigameState(refreshed));
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
    dispatch(setCurrentRoundId(nextRound?.id));
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
          onToggleTranscript={() => dispatch(toggleTranscriptHidden())}
          onNextTurn={
            roundResultScore != null && controller.state === "complete" ? nextTurn : undefined
          }
          nextTurnDisabled={nextTurnDisabled}
          onOpenEvaluation={() => dispatch(setEvaluationDrawerOpen(true))}
          onEndGame={endGame}
          onNewGame={() => {
            dispatch(resetMinigame());
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
          onToggleTranscript={() => dispatch(toggleTranscriptHidden())}
          onNextTurn={
            roundResultScore != null && controller.state === "complete" ? nextTurn : undefined
          }
          nextTurnDisabled={nextTurnDisabled}
          onOpenEvaluation={() => dispatch(setEvaluationDrawerOpen(true))}
          onEndGame={endGame}
          onNewGame={() => {
            dispatch(resetMinigame());
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
