import type { Task } from "@deliberate/shared";
import type { PatientAudioStatus } from "../../patientAudio/PatientAudioBank";
import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
  MinigameSession,
  MinigameTeam
} from "../../store/api";

export type MinigameController = {
  state: string;
  audioStatus: PatientAudioStatus;
  audioError?: string | null;
  patientEndedAt?: number | null;
  processingStage?: "transcribing" | "evaluating" | null;
  playPatient: () => void;
  stopPatient: () => void;
  micMode: "record" | "stop" | "disabled" | "locked";
  micAccent?: "teal" | "rose";
  micAttention?: boolean;
  responseCountdown?: number | null;
  responseCountdownLabel?: string;
  maxDurationProgress: number;
  startRecording: () => void;
  stopAndSubmit: () => void;
  submitError?: string | null;
};

export type MinigameLayoutProps = {
  mode: "ffa" | "tdm" | null;
  modeCopy: Record<"ffa" | "tdm", string>;
  session?: MinigameSession;
  teams: MinigameTeam[];
  players: MinigamePlayer[];
  results: MinigameRoundResult[];
  currentRound?: MinigameRound;
  currentTask?: Task;
  currentPlayer?: MinigamePlayer;
  activePlayerId?: string | null;
  currentPlayerId?: string;
  onPlayerChange?: (playerId: string) => void;
  controller: MinigameController;
  micLabel: string;
  roundResultScore: number | null;
  roundResultPenalty: number | null;
  currentScore?: number | null;
  transcriptEligible: boolean;
  transcriptHidden: boolean;
  transcriptText?: string;
  transcriptProcessingStage?: "transcribing" | "evaluating" | null;
  onToggleTranscript: () => void;
  onNextTurn?: () => void;
  onOpenEvaluation: () => void;
  onEndGame: () => void;
  onNewGame: () => void;
  onNewPlayer: () => void;
  onRedraw: () => void;
  canRedraw: boolean;
  fullscreen: {
    isFullscreen: boolean;
    isSupported: boolean;
    toggle: () => void;
  };
};
