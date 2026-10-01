import { useState } from "react";

const ARTWORK_STEMS = {
  shelter: "open-shelter",
  horizon: "quiet-horizon",
  rhythm: "shared-rhythm",
} as const;

type StudioArtworkProps = {
  scene: keyof typeof ARTWORK_STEMS;
  className?: string;
  priority?: boolean;
  sizes?: string;
};

export const StudioArtwork = ({
  scene,
  className = "",
  priority = false,
  sizes = "(min-width: 1280px) 520px, (min-width: 768px) 45vw, calc(100vw - 64px)",
}: StudioArtworkProps) => {
  const stem = ARTWORK_STEMS[scene];
  const src = `/artwork/${stem}-1600.webp`;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  return (
    <div
      aria-hidden="true"
      className={`studio-artwork studio-artwork--parallax ${className}`}
      data-artwork={scene}
    >
      <picture>
        <img
          alt=""
          src={src}
          srcSet={[600, 1000, 1600]
            .map((width) => `/artwork/${stem}-${width}.webp ${width}w`)
            .join(", ")}
          sizes={sizes}
          width={1600}
          height={900}
          draggable={false}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onError={() => setFailedSource(src)}
          style={failedSource === src ? { visibility: "hidden" } : undefined}
        />
      </picture>
    </div>
  );
};
