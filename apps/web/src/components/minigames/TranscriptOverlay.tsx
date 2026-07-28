import { StatusPill } from "../StatusPill";
import { useTranslation } from "react-i18next";

type TranscriptOverlayProps = {
  text?: string;
  onToggle: () => void;
  processingStage?: "transcribing" | "evaluating" | null;
  variant?: "standalone" | "embedded";
};

export const TranscriptOverlay = ({
  text,
  onToggle,
  processingStage = null,
  variant = "standalone",
}: TranscriptOverlayProps) => {
  const { t } = useTranslation();
  const hasText = Boolean(text && text.trim().length > 0);
  const statusLabel =
    processingStage === "transcribing"
      ? t("practice.status.transcribing")
      : processingStage === "evaluating"
        ? t("practice.evaluating")
        : null;
  const statusTone = processingStage === "evaluating" ? "warning" : "info";

  if (variant === "embedded") {
    return (
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950/30 p-4">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-teal-400/10 to-transparent" />
          <div className="max-h-[40vh] overflow-y-auto pr-1">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100/90">
              {hasText ? text : t("practice.transcriptPlaceholder")}
            </p>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-950/80 to-transparent" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {statusLabel ? (
            <StatusPill label={statusLabel} tone={statusTone} showSpinner />
          ) : (
            <span className="text-xs text-slate-300/80">
              {hasText ? t("practice.patientReady") : t("minigameUi.listening")}
            </span>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/70 transition hover:text-white focus:outline-none focus:ring-2 focus:ring-teal-300/40"
          >
            {t("minigameUi.hide")}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-[0_0_30px_rgba(15,23,42,0.5)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-teal-400/10 to-transparent" />
      <div className="max-h-[50vh] overflow-hidden transition-[max-height,opacity,transform] duration-300 ease-out">
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-300/80">
              {t("minigameUi.transcript")}
            </p>

            <button
              type="button"
              onClick={onToggle}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white/80 focus:outline-none focus:ring-2 focus:ring-teal-300/40"
              aria-label={t("minigameUi.hideTranscript")}
            >
              {t("minigameUi.hide")}
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
            <div className="max-h-[30vh] overflow-y-auto pr-2">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100/90">
                {hasText ? text : t("practice.transcriptPlaceholder")}
              </p>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950/80 to-transparent" />
          </div>
        </div>

        <div className="mt-4 border-t border-white/10 bg-slate-950/40 px-5 py-3">
          <div className="flex items-center justify-between gap-3">
            {statusLabel ? (
              <StatusPill label={statusLabel} tone={statusTone} showSpinner />
            ) : (
              <span className="truncate text-xs text-slate-300/80">
                {hasText
                  ? t("practice.patientReady")
                  : t("minigameUi.listening")}
              </span>
            )}
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-200/80">
              {t("minigameUi.escape")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
