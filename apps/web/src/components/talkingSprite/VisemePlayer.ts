import type { Sprite, Texture, Ticker } from "pixi.js";
import type { VisemeKey } from "./rig";
import { textToVisemeTimeline } from "./textToVisemes";

type TimelineEntry = { key: VisemeKey; ms: number };

type PlayOptions = {
  wpm?: number;
  baseFrameMs?: number;
};

export class VisemePlayer {
  private mouthSprite: Sprite;
  private mouthTextures: Record<VisemeKey, Texture>;
  private ticker: Ticker;
  private timeline: TimelineEntry[] = [];
  private currentIndex = 0;
  private elapsed = 0;
  private playing = false;
  private resolve?: (finished: boolean) => void;

  constructor(mouthSprite: Sprite, mouthTextures: Record<VisemeKey, Texture>, ticker: Ticker) {
    this.mouthSprite = mouthSprite;
    this.mouthTextures = mouthTextures;
    this.ticker = ticker;
  }

  playText(text: string, opts: PlayOptions = {}) {
    this.stop();
    this.timeline = textToVisemeTimeline(text, opts);
    if (this.timeline.length === 0) {
      this.setRest();
      return Promise.resolve(true);
    }
    this.playing = true;
    this.currentIndex = 0;
    this.elapsed = 0;
    this.setViseme(this.timeline[0].key);

    this.ticker.add(this.tick);

    return new Promise<boolean>((resolve) => {
      this.resolve = resolve;
    });
  }

  stop() {
    if (!this.playing) {
      this.setRest();
      return;
    }
    this.playing = false;
    this.ticker.remove(this.tick);
    this.setRest();
    if (this.resolve) {
      this.resolve(false);
      this.resolve = undefined;
    }
  }

  setRest() {
    this.setViseme("REST");
  }

  isPlaying() {
    return this.playing;
  }

  private finish() {
    this.playing = false;
    this.ticker.remove(this.tick);
    this.setRest();
    if (this.resolve) {
      this.resolve(true);
      this.resolve = undefined;
    }
  }

  private setViseme(key: VisemeKey) {
    this.mouthSprite.texture = this.mouthTextures[key];
  }

  private tick = () => {
    if (!this.playing) return;
    const deltaMs = this.ticker.deltaMS;
    this.elapsed += deltaMs;

    while (this.playing && this.currentIndex < this.timeline.length) {
      const current = this.timeline[this.currentIndex];
      if (this.elapsed < current.ms) break;
      this.elapsed -= current.ms;
      this.currentIndex += 1;
      if (this.currentIndex >= this.timeline.length) {
        this.finish();
        return;
      }
      this.setViseme(this.timeline[this.currentIndex].key);
    }
  };
}
