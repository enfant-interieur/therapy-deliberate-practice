import { useCallback, useEffect, useRef, useState } from "react";
import { Application, Container, Sprite } from "pixi.js";
import type { RigConfig } from "./rig";
import { loadTalkingSpriteTextures } from "./spritesheetCache";
import { VisemePlayer } from "./VisemePlayer";

type UseTalkingSpriteOptions = {
  spriteUrl: string;
  rig: RigConfig;
  width: number;
  height: number;
  onDone?: () => void;
};

type PlayOptions = {
  wpm?: number;
  baseFrameMs?: number;
};

export const useTalkingSprite = ({
  spriteUrl,
  rig,
  width,
  height,
  onDone
}: UseTalkingSpriteOptions) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const playerRef = useRef<VisemePlayer | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const stop = useCallback(() => {
    playerRef.current?.stop();
    setIsPlaying(false);
  }, []);

  const play = useCallback(
    async (text: string, opts?: PlayOptions) => {
      if (!playerRef.current) return;
      setIsPlaying(true);
      const finished = await playerRef.current.playText(text, opts);
      setIsPlaying(false);
      if (finished) {
        onDone?.();
      }
    },
    [onDone]
  );

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!containerRef.current) return;

      containerRef.current.innerHTML = "";

      const app = new Application();
      appRef.current = app;

      await app.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true
      });

      if (cancelled) {
        app.destroy(true);
        return;
      }

      containerRef.current.appendChild(app.canvas);

      const { face, mouths } = await loadTalkingSpriteTextures(spriteUrl, rig);

      if (cancelled) {
        app.destroy(true);
        return;
      }

      const stage = new Container();
      app.stage.addChild(stage);

      const faceSprite = new Sprite(face);
      const scale = Math.min(width / face.width, height / face.height);
      faceSprite.scale.set(scale);
      faceSprite.x = (width - face.width * scale) / 2;
      faceSprite.y = (height - face.height * scale) / 2;

      const mouthSprite = new Sprite(mouths.REST);
      mouthSprite.anchor.set(0.5);
      mouthSprite.scale.set(scale * rig.mouthPlacement.scale);
      mouthSprite.x = faceSprite.x + faceSprite.width * rig.mouthPlacement.x;
      mouthSprite.y = faceSprite.y + faceSprite.height * rig.mouthPlacement.y;

      stage.addChild(faceSprite, mouthSprite);

      playerRef.current = new VisemePlayer(mouthSprite, mouths, app.ticker);
      setIsReady(true);
      setIsPlaying(false);
    };

    void init();

    return () => {
      cancelled = true;
      playerRef.current?.stop();
      playerRef.current = null;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
      }
      setIsReady(false);
    };
  }, [height, rig, spriteUrl, width]);

  return {
    ref: containerRef,
    play,
    stop,
    isReady,
    isPlaying
  };
};
