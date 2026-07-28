import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

type VersusIntroOverlayProps = {
  open: boolean;
  leftName: string;
  rightName: string;
  leftAccent?: string;
  rightAccent?: string;
  onComplete: () => void;
};

export const VersusIntroOverlay = ({
  open,
  leftName,
  rightName,
  leftAccent = "rgba(45,212,191,0.7)",
  rightAccent = "rgba(244,63,94,0.7)",
  onComplete,
}: VersusIntroOverlayProps) => {
  const { t } = useTranslation();
  const [canDismiss, setCanDismiss] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const handledRef = useRef(false);
  const completionTimeoutRef = useRef<number | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    handledRef.current = false;
    setIsExiting(false);
    setCanDismiss(false);
    const timeout = window.setTimeout(
      () => setCanDismiss(true),
      prefersReducedMotion ? 0 : 1200,
    );
    return () => window.clearTimeout(timeout);
  }, [open, prefersReducedMotion]);

  useEffect(
    () => () => {
      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }
    },
    [],
  );

  if (!open) return null;

  const completeIntro = () => {
    if (!canDismiss || handledRef.current) return;
    handledRef.current = true;
    setIsExiting(true);
    completionTimeoutRef.current = window.setTimeout(
      () => {
        completionTimeoutRef.current = null;
        onComplete();
      },
      prefersReducedMotion ? 0 : 600,
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("minigameUi.dismissVersus")}
      aria-disabled={!canDismiss}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70"
      onClick={completeIntro}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        completeIntro();
      }}
    >
      <div className="relative flex w-full max-w-3xl items-center justify-center gap-6 px-8">
        <div
          className="absolute inset-0 rounded-[32px] blur-3xl"
          style={{
            background: `radial-gradient(circle at left, ${leftAccent}, transparent 60%), radial-gradient(circle at right, ${rightAccent}, transparent 60%)`,
          }}
        />
        <div
          className={`relative flex w-full items-center justify-between rounded-[32px] border border-white/15 bg-slate-950/70 px-8 py-10 text-center shadow-[0_0_60px_rgba(15,23,42,0.6)] backdrop-blur ${
            isExiting
              ? "animate-versus-intro-exit motion-reduce:animate-none"
              : "animate-versus-intro-enter motion-reduce:animate-none"
          }`}
        >
          <div className="flex-1 text-left">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
              {t("minigameUi.player")}
            </p>
            <p className="mt-2 text-3xl font-semibold text-white">{leftName}</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="h-14 w-14 rounded-full border border-white/20 bg-white/5 shadow-[0_0_35px_rgba(148,163,184,0.45)]" />
            <p className="text-xs uppercase tracking-[0.5em] text-slate-300">
              {t("minigameUi.versus")}
            </p>
          </div>
          <div className="flex-1 text-right">
            <p className="text-xs uppercase tracking-[0.4em] text-slate-400">
              {t("minigameUi.player")}
            </p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {rightName}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
