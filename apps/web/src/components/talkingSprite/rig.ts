export type Rect = { x: number; y: number; w: number; h: number };
export type NormalizedRect = Rect;

export type VisemeKey =
  | "AI"
  | "FV"
  | "O"
  | "CH"
  | "L"
  | "BMP"
  | "EE"
  | "CDGKNSTXYZ"
  | "U"
  | "R"
  | "TH"
  | "QW"
  | "REST";

export type RigConfig = {
  faceRect: NormalizedRect;
  mouthRects: Record<VisemeKey, NormalizedRect>;
  mouthPlacement: { x: number; y: number; scale: number };
};

const GRID = {
  x: 0.52,
  y: 0.08,
  w: 0.44,
  h: 0.84
};

const cellRect = (
  col: number,
  row: number,
  insetX = 0.28,
  insetY = 0.36
): NormalizedRect => {
  const cellW = GRID.w / 3;
  const cellH = GRID.h / 4;
  const centerX = GRID.x + cellW * (col + 0.5);
  const centerY = GRID.y + cellH * (row + 0.5);
  const w = cellW * (1 - insetX * 2);
  const h = cellH * (1 - insetY * 2);
  return {
    x: centerX - w / 2,
    y: centerY - h / 2,
    w,
    h
  };
};

// Tuned for src/assets/patient_sprite.png (2304×1856). Update these if the asset changes.
export const patientRig: RigConfig = {
  faceRect: {
    x: 0.02,
    y: 0.04,
    w: 0.46,
    h: 0.92
  },
  mouthRects: {
    AI: cellRect(0, 0),
    FV: cellRect(1, 0),
    O: cellRect(2, 0),
    CH: cellRect(0, 1),
    L: cellRect(1, 1),
    BMP: cellRect(2, 1),
    EE: cellRect(0, 2),
    CDGKNSTXYZ: cellRect(1, 2),
    U: cellRect(2, 2),
    R: cellRect(0, 3),
    TH: cellRect(1, 3),
    QW: cellRect(2, 3),
    REST: cellRect(2, 1)
  },
  mouthPlacement: {
    x: 0.5,
    y: 0.57,
    scale: 0.6
  }
};
