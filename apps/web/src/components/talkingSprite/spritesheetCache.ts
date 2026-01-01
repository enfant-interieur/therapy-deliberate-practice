import { Assets, Rectangle, Texture } from "pixi.js";
import type { RigConfig, Rect, VisemeKey } from "./rig";

const textureCache = new Map<
  string,
  Promise<{ face: Texture; mouths: Record<VisemeKey, Texture> }>
>();

const toPixels = (rect: Rect, width: number, height: number): Rect => ({
  x: rect.x * width,
  y: rect.y * height,
  w: rect.w * width,
  h: rect.h * height
});

const sliceTexture = (source: Texture, rect: Rect) =>
  new Texture({
    source: source.source,
    frame: new Rectangle(rect.x, rect.y, rect.w, rect.h)
  });

export const loadTalkingSpriteTextures = async (spriteUrl: string, rig: RigConfig) => {
  if (!textureCache.has(spriteUrl)) {
    textureCache.set(
      spriteUrl,
      (async () => {
        const baseTexture = await Assets.load<Texture>(spriteUrl);
        const width = baseTexture.width;
        const height = baseTexture.height;
        const face = sliceTexture(baseTexture, toPixels(rig.faceRect, width, height));

        const mouths = Object.fromEntries(
          (Object.keys(rig.mouthRects) as VisemeKey[]).map((key) => [
            key,
            sliceTexture(baseTexture, toPixels(rig.mouthRects[key], width, height))
          ])
        ) as Record<VisemeKey, Texture>;

        return { face, mouths };
      })()
    );
  }

  return textureCache.get(spriteUrl)!;
};
