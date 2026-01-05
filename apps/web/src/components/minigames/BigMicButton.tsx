type BigMicButtonProps = {
  mode: "record" | "stop" | "disabled" | "locked";
  subLabel?: string;
  progress?: number;
  accent?: "teal" | "rose";
  attention?: boolean;
  onRecord?: () => void;
  onStop?: () => void;
};

const MicIcon = ({ accent }: { accent: "teal" | "rose" }) => (
  <svg
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={accent === "rose" ? "text-rose-100" : "text-teal-100"}
  >
    <path d="M12 1a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4Z" />
    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
    <path d="M12 18v4" />
    <path d="M8 22h8" />
  </svg>
);

export const BigMicButton = ({
  mode,
  subLabel,
  progress = 0,
  accent,
  attention = false,
  onRecord,
  onStop
}: BigMicButtonProps) => {
  const isRecording = mode === "stop";
  const isDisabled = mode === "disabled" || mode === "locked";
  const resolvedAccent = accent ?? (isRecording ? "rose" : "teal");
  const progressClamped = Math.min(1, Math.max(0, progress));
  const circumference = 2 * Math.PI * 46;
  const dashOffset = circumference * (1 - progressClamped);
  const baseStyles =
    resolvedAccent === "rose"
      ? "border-rose-300/70 bg-rose-500/30 shadow-[0_0_45px_rgba(244,63,94,0.6)]"
      : "border-teal-300/70 bg-teal-500/20 shadow-[0_0_45px_rgba(45,212,191,0.45)]";
  const progressStroke =
    resolvedAccent === "rose" ? "rgba(248,113,113,0.9)" : "rgba(94,234,212,0.9)";

  return (
    <button
      onClick={() => {
        if (isDisabled) return;
        if (isRecording) {
          onStop?.();
        } else {
          onRecord?.();
        }
      }}
      disabled={isDisabled}
      className={`group relative flex h-36 w-36 items-center justify-center rounded-full border text-white transition-all duration-300 ${baseStyles} ${
        isDisabled ? "cursor-not-allowed opacity-40" : "hover:-translate-y-1 hover:shadow-[0_0_60px_rgba(56,189,248,0.35)]"
      }`}
    >
      {attention && !isRecording && (
        <span className="absolute inset-0 rounded-full border border-rose-400/60 animate-ping" />
      )}
      <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08),rgba(15,23,42,0.6))]" />
      <span
        className={`absolute inset-0 rounded-full ring-2 ring-white/10 ${
          isRecording || attention ? "animate-pulse" : "opacity-60"
        }`}
      />
      <svg className="absolute h-[110px] w-[110px] -rotate-90">
        <circle
          cx="55"
          cy="55"
          r="46"
          stroke="rgba(148,163,184,0.3)"
          strokeWidth="6"
          fill="transparent"
        />
        {progressClamped > 0 && (
          <circle
            cx="55"
            cy="55"
            r="46"
            stroke={progressStroke}
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-200 ease-linear"
          />
        )}
      </svg>
      <span className="relative z-10 flex flex-col items-center gap-2">
        <MicIcon accent={resolvedAccent} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200">
          {subLabel ?? (isRecording ? "Stop" : "Record")}
        </span>
      </span>
      {mode === "locked" && (
        <span className="absolute -bottom-8 text-[10px] uppercase tracking-[0.3em] text-slate-400">
          Locked
        </span>
      )}
    </button>
  );
};
