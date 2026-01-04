import { StatusPill } from "../StatusPill";

type TranscriptOverlayProps = {
    text?: string;
    hidden: boolean;
    onToggle: () => void;
    processingStage?: "transcribing" | "evaluating" | null;
};

export const TranscriptOverlay = ({
    text,
    hidden,
    onToggle,
    processingStage = null
}: TranscriptOverlayProps) => {
    const hasText = Boolean(text && text.trim().length > 0);
    const statusLabel =
        processingStage === "transcribing"
            ? "Transcribing"
            : processingStage === "evaluating"
                ? "Evaluating"
                : null;
    const statusTone = processingStage === "evaluating" ? "warning" : "info";

    return (
        <div className="pointer-events-none fixed left-1/2 bottom-3 z-20 w-full -translate-x-1/2 px-6">
            <div className="pointer-events-auto mx-auto w-full max-w-3xl">
                {/* Hidden state: single premium button */}
                {hidden ? (
                    <div className="flex justify-center">
                        <button
                            type="button"
                            onClick={onToggle}
                            className="
                group inline-flex items-center gap-2 rounded-full
                border border-white/10 bg-slate-950/70 px-4 py-2
                text-xs font-semibold uppercase tracking-[0.22em] text-slate-100
                shadow-[0_0_25px_rgba(15,23,42,0.35)]
                backdrop-blur
                transition
                hover:border-white/20 hover:bg-slate-900/70
                focus:outline-none focus:ring-2 focus:ring-teal-300/40
              "
                            aria-label="Show transcript"
                        >
              <span
                  className="
                  relative flex h-6 w-6 items-center justify-center rounded-full
                  border border-white/10 bg-white/5
                  shadow-[0_0_18px_rgba(45,212,191,0.18)]
                  transition
                  group-hover:border-white/20
                "
                  aria-hidden="true"
              >
                {/* up chevron */}
                  <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-teal-200/90 transition group-hover:-translate-y-0.5"
                  >
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              </span>
                            <span className="text-slate-100/90">Show Transcript</span>
                        </button>
                    </div>
                ) : (
                    /* Open state: panel expands upward, bottom stays pinned */
                    <div
                        className="
              relative overflow-hidden rounded-3xl
              border border-white/10 bg-slate-950/70
              shadow-[0_0_30px_rgba(15,23,42,0.5)]
              backdrop-blur
            "
                    >
                        {/* subtle top glow */}
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-teal-400/10 to-transparent" />

                        {/* Transcript body (grows upward) */}
                        <div
                            className="
                max-h-[40vh] overflow-hidden
                transition-[max-height,opacity,transform] duration-300 ease-out
                opacity-100 translate-y-0
              "
                        >
                            <div className="px-5 pt-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300/80">
                                        Transcript
                                    </p>

                                    <button
                                        type="button"
                                        onClick={onToggle}
                                        className="
                      inline-flex items-center gap-2 rounded-full
                      border border-white/10 bg-white/5 px-3 py-1
                      text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70
                      transition
                      hover:border-white/25 hover:bg-white/10 hover:text-white/80
                      focus:outline-none focus:ring-2 focus:ring-teal-300/40
                    "
                                        aria-label="Hide transcript"
                                    >
                                        Hide
                                        <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-white/60"
                                            aria-hidden="true"
                                        >
                                            <path d="M6 9l6 6 6-6" />
                                        </svg>
                                    </button>
                                </div>

                                <div className="relative mt-3">
                                    {/* scroll container */}
                                    <div className="max-h-[30vh] overflow-y-auto pr-2">
                                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100/90">
                                            {hasText ? text : "Awaiting transcript..."}
                                        </p>
                                    </div>

                                    {/* bottom fade for scroll */}
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/80 to-transparent" />
                                </div>
                            </div>

                            {/* Bottom “bar” stays visually anchored */}
                            <div className="mt-4 border-t border-white/10 bg-slate-950/40 px-5 py-3">
                                <div className="flex items-center justify-between gap-3">
                  {statusLabel ? (
                      <StatusPill label={statusLabel} tone={statusTone} showSpinner />
                  ) : (
                      <span className="truncate text-xs text-slate-300/80">
                        {hasText ? "Ready" : "Listening…"}
                      </span>
                  )}
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-200/80">
                    Esc
                  </span>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
