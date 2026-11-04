import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PatientScene } from "./patientScene";

type View = "loading" | "ready" | "portrait" | "unavailable";

function AvatarStage({ speaking }: { speaking: boolean }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<PatientScene | null>(null);
  const [view, setView] = useState<View>("loading");

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let pending: AbortController | null = null;
    const clear = () => {
      pending?.abort();
      pending = null;
      scene.current?.dispose();
      scene.current = null;
    };
    const load = () => {
      clear();
      if (motion.matches) {
        setView("portrait");
        return;
      }
      const controller = new AbortController();
      pending = controller;
      setView("loading");
      void import("./patientScene")
        .then(({ mountPatientScene }) => {
          if (controller.signal.aborted) return null;
          return mountPatientScene(element, controller.signal, () => {
            if (!controller.signal.aborted) {
              clear();
              setView("unavailable");
            }
          });
        })
        .then((renderer) => {
          if (!renderer) return;
          if (controller.signal.aborted) {
            renderer.dispose();
            return;
          }
          scene.current = renderer;
          setView("ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) setView("unavailable");
        });
    };
    load();
    motion.addEventListener("change", load);
    return () => {
      motion.removeEventListener("change", load);
      clear();
    };
  }, []);

  useEffect(() => {
    scene.current?.setSpeaking(speaking);
  }, [speaking, view]);

  return (
    <div className="patient-avatar-frame" data-avatar-view={view}>
      {view !== "ready" && (
        <img
          src="/avatars/patient-violet.webp"
          alt=""
          width="600"
          height="800"
        />
      )}
      <canvas
        ref={canvas}
        aria-hidden="true"
        className={view === "ready" ? "is-ready" : ""}
      />
      <div className="patient-avatar-caption">
        <span className="patient-avatar-name">
          {t("practice.avatar.character")}
        </span>
        <span role="status">
          {t(
            `practice.avatar.${view === "ready" && speaking ? "speaking" : view}`,
          )}
        </span>
      </div>
    </div>
  );
}

export function PatientAvatar({ speaking }: { speaking: boolean }) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  return (
    <section
      aria-label={t("practice.avatar.label")}
      className="patient-avatar-card"
    >
      <div className="patient-avatar-controls">
        <div>
          <p className="studio-eyebrow">{t("practice.avatar.label")}</p>
          <p className="text-sm text-slate-300">
            {t("practice.avatar.description")}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={enabled}
          className="studio-secondary patient-avatar-toggle"
          onClick={() => setEnabled((shown) => !shown)}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          >
            <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z M4 7.5 12 12l8-4.5M12 12v9" />
          </svg>
          {t(enabled ? "practice.avatar.hide" : "practice.avatar.show")}
        </button>
      </div>
      {enabled && <AvatarStage speaking={speaking} />}
    </section>
  );
}
