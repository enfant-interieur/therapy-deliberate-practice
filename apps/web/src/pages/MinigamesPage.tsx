import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { GameSelectModal } from "../components/minigames/GameSelectModal";
import { MinigameSetupModal } from "../components/minigames/MinigameSetupModal";
import { AudioReactiveBackground } from "../components/minigames/AudioReactiveBackground";
import { TranscriptOverlay } from "../components/minigames/TranscriptOverlay";
import { BigMicButton } from "../components/minigames/BigMicButton";
import { LeaderboardPanel } from "../components/minigames/LeaderboardPanel";
import { RoundHUD } from "../components/minigames/RoundHUD";
import { EvaluationDrawer } from "../components/minigames/EvaluationDrawer";
import { useMinigameRoundRunner } from "../components/minigames/hooks/useMinigameRoundRunner";
import {
  useAddMinigamePlayersMutation,
  useAddMinigameTeamsMutation,
  useCreateMinigameSessionMutation,
  useEndMinigameSessionMutation,
  useGenerateMinigameRoundsMutation,
  useLazyGetMinigameStateQuery
} from "../store/api";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  addRoundResult,
  resetMinigame,
  setCurrentRoundId,
  setEvaluationDrawerOpen,
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
  const [lastTranscript, setLastTranscript] = useState<string | undefined>(undefined);
  const handledPreselectRef = useRef(false);

  const [createSession] = useCreateMinigameSessionMutation();
  const [addTeams] = useAddMinigameTeamsMutation();
  const [addPlayers] = useAddMinigamePlayersMutation();
  const [generateRounds] = useGenerateMinigameRoundsMutation();
  const [endSession] = useEndMinigameSessionMutation();
  const [fetchMinigameState, minigameState] = useLazyGetMinigameStateQuery();

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
    if (audioRef.current) {
      setAudioElement(audioRef.current);
    }
  }, []);

  useEffect(() => {
    if (minigames.players.length && !currentPlayerId) {
      setCurrentPlayerId(minigames.players[0].id);
    }
  }, [currentPlayerId, minigames.players]);

  const currentRound = useMemo(
    () =>
      minigames.rounds.find((round) => round.id === minigames.currentRoundId) ??
      minigames.rounds.find((round) => round.status !== "completed"),
    [minigames.currentRoundId, minigames.rounds]
  );
  const currentPlayer = minigames.players.find((player) => player.id === currentPlayerId);

  const runner = useMinigameRoundRunner({
    sessionId: minigames.session?.id ?? "",
    round: currentRound,
    playerId: currentPlayerId,
    audioElement,
    onResult: (payload) => {
      setLastTranscript(payload.transcript);
      setRoundResultScore(payload.score ?? null);
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
            evaluation: payload.evaluation as EvaluationResult | undefined
          })
        );
      }
    }
  });

  const handleModeSelect = (selected: "ffa" | "tdm") => {
    setMode(selected);
    setSelectOpen(false);
    setSetupOpen(true);
  };

  const startGame = async (payload: {
    taskSelection: TaskSelectionState;
    visibilityMode: "normal" | "hard" | "extreme";
    players: PlayerDraft[];
    teams: TeamDraft[];
    roundsPerPlayer: number;
  }) => {
    if (!mode) return;
    const session = await createSession({
      game_type: mode,
      visibility_mode: payload.visibilityMode,
      task_selection: payload.taskSelection,
      settings: {
        rounds_per_player: payload.roundsPerPlayer
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
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-white">
      <AudioReactiveBackground audioElement={audioElement} isPlaying={runner.isPlaying} />
      <audio ref={audioRef} />
      <TranscriptOverlay
        text={minigames.ui.transcriptHidden ? undefined : lastTranscript}
        hidden={minigames.ui.transcriptHidden}
        onToggle={() => dispatch(toggleTranscriptHidden())}
      />
      <div className="relative z-10 flex flex-1 flex-col gap-6 px-6 pb-12 pt-20">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Minigames</p>
            <h1 className="mt-2 text-3xl font-semibold text-white">
              {mode ? modeCopy[mode] : "Launch a minigame"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
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

        <RoundHUD
          round={currentRound}
          player={currentPlayer}
          teams={minigames.teams}
          onNextTurn={roundResultScore != null ? nextTurn : undefined}
        />

        {minigames.players.length > 0 && (
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
          <div className="flex min-w-[280px] flex-1 flex-col items-center justify-center gap-4">
            <p className="text-sm text-slate-300">
              {runner.audioError ?? "Patient audio will play automatically."}
            </p>
            <BigMicButton
              isRecording={runner.recordingState === "recording"}
              disabled={!currentRound || !currentPlayerId}
              onClick={() => {
                if (runner.recordingState === "recording") {
                  runner.stopAndSubmit();
                } else {
                  runner.startTurn().then(() => runner.startRecording());
                }
              }}
            />
            {runner.submitError && <p className="text-xs text-rose-200">{runner.submitError}</p>}
            {roundResultScore != null && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Round complete
                </p>
                <p className="mt-2 text-2xl font-semibold text-teal-200">
                  {roundResultScore.toFixed(2)}
                </p>
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
    </div>
  );
};
