import type { PatientAudioStatus } from "../../patientAudio/PatientAudioBank";

type PatientAudioControlsProps = {
  status: PatientAudioStatus;
  onPlay: () => void;
  onStop: () => void;
  hasEnded: boolean;
};

const statusCopy: Record<PatientAudioStatus, string> = {
  idle: "Audio idle",
  generating: "Preparing voice...",
  downloading: "Downloading voice...",
  ready: "Ready to play",
  playing: "Patient speaking",
  blocked: "Tap to play",
  error: "Audio unavailable"
};

export const PatientAudioControls = ({
  status,
  onPlay,
  onStop,
  hasEnded
}: PatientAudioControlsProps) => {
  const isPlaying = status === "playing";
  const buttonLabel = hasEnded ? "Replay patient voice" : "Play patient voice";

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={() => (isPlaying ? onStop() : onPlay())}
        disabled={status === "generating" || status === "downloading"}
        className={`group flex items-center gap-3 rounded-full border px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
          isPlaying
            ? "border-rose-300/60 bg-rose-500/20 text-rose-100 shadow-[0_0_25px_rgba(244,63,94,0.35)]"
            : "border-teal-300/60 bg-teal-500/20 text-teal-100 shadow-[0_0_25px_rgba(45,212,191,0.35)]"
        } ${status === "generating" || status === "downloading" ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5 hover:border-white/40"}`}
      >
        <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
        {isPlaying ? "Stop voice" : buttonLabel}
      </button>
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300">
        {statusCopy[status]}
      </span>
    </div>
  );
};
