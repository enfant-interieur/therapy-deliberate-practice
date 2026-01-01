import { useEffect, useRef } from "react";
import type { EvaluationResult } from "@deliberate/shared";
import patientSpriteUrl from "../assets/patient_sprite.png";
import { patientRig } from "./talkingSprite/rig";
import { useTalkingSprite } from "./talkingSprite/useTalkingSprite";

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

type TalkingPatientCanvasProps = {
  text?: string;
  play?: boolean;
  autoPlayOnTextChange?: boolean;
  reaction?: EvaluationResult["patient_reaction"];
  onDone?: () => void;
};

export const TalkingPatientCanvas = ({
  text = "",
  play = false,
  autoPlayOnTextChange = false,
  reaction,
  onDone
}: TalkingPatientCanvasProps) => {
  const { ref, play: playText, stop, isReady } = useTalkingSprite({
    spriteUrl: patientSpriteUrl,
    rig: patientRig,
    width: 520,
    height: 360,
    onDone
  });
  const textRef = useRef(text);

  useEffect(() => {
    if (!isReady) return;
    if (play) {
      void playText(text);
      return;
    }
    stop();
  }, [isReady, play, playText, stop, text]);

  useEffect(() => {
    const previousText = textRef.current;
    if (previousText === text) return;
    textRef.current = text;
    if (!autoPlayOnTextChange || !isReady || play === false) return;
    const handle = window.setTimeout(() => {
      void playText(text);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [autoPlayOnTextChange, isReady, play, playText, text]);

  useEffect(() => {
    if (!ref.current) return;
    const canvas = ref.current.querySelector("canvas");
    if (!canvas) return;

    const color = reaction ? emotionColors[reaction.emotion] : emotionColors.neutral;
    canvas.style.boxShadow = `0 0 40px rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${
      color & 255
    }, 0.35)`;
  }, [reaction, ref, isReady]);

  return (
    <div
      ref={ref}
      className="rounded-3xl border border-white/10 bg-slate-900/60 p-4"
    />
  );
};
