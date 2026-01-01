import { useEffect, useRef } from "react";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { EvaluationResult } from "@deliberate/shared";
import { useTranslation } from "react-i18next";

const emotionColors: Record<
  NonNullable<EvaluationResult["patient_reaction"]>["emotion"],
  number
> = {
  neutral: 0x94a3b8,
  warm: 0x38bdf8,
  sad: 0x64748b,
  anxious: 0xfbbf24,
  angry: 0xf87171,
  relieved: 0x34d399,
  engaged: 0xa78bfa
};

export const PatientCanvas = ({
  reaction
}: {
  reaction?: EvaluationResult["patient_reaction"];
}) => {
  const { t, i18n } = useTranslation();
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!canvasRef.current) return;

      // In case this ever re-mounts, clear previous canvas
      canvasRef.current.innerHTML = "";

      const app = new Application();
      appRef.current = app;

      // Pixi v8: must init asynchronously before accessing canvas/view/renderer
      await app.init({
        width: 520,
        height: 360,
        backgroundAlpha: 0,
        antialias: true
      });

      if (cancelled) {
        app.destroy(true);
        return;
      }

      canvasRef.current.appendChild(app.canvas);

      const stage = new Container();
      app.stage.addChild(stage);

      const body = new Graphics();
      body.beginFill(0x1f2937).drawRoundedRect(160, 140, 200, 160, 32).endFill();

      const face = new Graphics();
      face.beginFill(0xf8fafc).drawCircle(260, 150, 60).endFill();

      const emotionGlow = new Graphics();
      emotionGlow.beginFill(0x38bdf8, 0.3).drawCircle(260, 150, 90).endFill();

      const eyes = new Graphics();
      eyes
        .beginFill(0x0f172a)
        .drawCircle(235, 140, 6)
        .drawCircle(285, 140, 6)
        .endFill();

      const moodText = new Text(t("practice.patientReady"), new TextStyle({ fill: 0xe2e8f0, fontSize: 14 }));
      moodText.x = 210;
      moodText.y = 260;

      stage.addChild(emotionGlow, body, face, eyes, moodText);

      let t = 0;
      app.ticker.add(() => {
        t += 0.02;
        eyes.y = 140 + Math.sin(t) * 2;
        face.y = Math.sin(t * 0.7) * 3;
        body.y = Math.sin(t * 0.4) * 2;
      });
    };

    void run();

    return () => {
      cancelled = true;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
    };
  }, [i18n.language, t]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current.querySelector("canvas");
    if (!canvas) return;

    const color = reaction ? emotionColors[reaction.emotion] : emotionColors.neutral;
    canvas.style.boxShadow = `0 0 40px rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${
      color & 255
    }, 0.35)`;
  }, [reaction]);

  return (
    <div
      ref={canvasRef}
      className="rounded-3xl border border-white/10 bg-slate-900/60 p-4"
    />
  );
};
