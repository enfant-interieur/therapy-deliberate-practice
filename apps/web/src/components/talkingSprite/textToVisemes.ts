import type { VisemeKey } from "./rig";

type TimelineEntry = { key: VisemeKey; ms: number };

type Options = {
  wpm?: number;
  baseFrameMs?: number;
};

const punctuationPauseMs = (frameMs: number, char: string) => {
  if (char === ",") return frameMs * 2.5;
  if (char === "." || char === "!" || char === "?") return frameMs * 4;
  if (char === ";" || char === ":") return frameMs * 3;
  return frameMs * 1.5;
};

const pushEntry = (timeline: TimelineEntry[], key: VisemeKey, ms: number) => {
  if (ms <= 0) return;
  const last = timeline[timeline.length - 1];
  if (last && last.key === key) {
    last.ms += ms;
    return;
  }
  timeline.push({ key, ms });
};

export const textToVisemeTimeline = (text: string, opts: Options = {}): TimelineEntry[] => {
  const wpm = opts.wpm ?? 140;
  const msPerChar = 60000 / (wpm * 5);
  const frameMs = opts.baseFrameMs ?? Math.max(60, Math.round(msPerChar));
  const timeline: TimelineEntry[] = [];

  const normalized = text.toLowerCase();
  let index = 0;
  let visemeCount = 0;

  pushEntry(timeline, "REST", frameMs * 0.6);

  while (index < normalized.length) {
    const char = normalized[index];
    const next = normalized[index + 1] ?? "";
    const pair = char + next;

    if (/\s/.test(char)) {
      pushEntry(timeline, "REST", frameMs * 0.8);
      index += 1;
      continue;
    }

    if (/[,.!?;:]/.test(char)) {
      pushEntry(timeline, "REST", punctuationPauseMs(frameMs, char));
      index += 1;
      continue;
    }

    let key: VisemeKey | null = null;

    if (pair === "th") {
      key = "TH";
      index += 2;
    } else if (pair === "ch" || pair === "sh") {
      key = "CH";
      index += 2;
    } else if (pair === "ph") {
      key = "FV";
      index += 2;
    } else if (pair === "qu") {
      key = "QW";
      index += 2;
    } else if (pair === "ee" || pair === "ea") {
      key = "EE";
      index += 2;
    } else if (/[aei]/.test(char)) {
      key = "AI";
      index += 1;
    } else if (char === "o") {
      key = "O";
      index += 1;
    } else if (char === "u") {
      key = "U";
      index += 1;
    } else if (char === "f" || char === "v") {
      key = "FV";
      index += 1;
    } else if (char === "b" || char === "m" || char === "p") {
      key = "BMP";
      index += 1;
    } else if (char === "l") {
      key = "L";
      index += 1;
    } else if (char === "r") {
      key = "R";
      index += 1;
    } else if (char === "q" || char === "w") {
      key = "QW";
      index += 1;
    } else if (char === "j") {
      key = "CH";
      index += 1;
    } else if (/[cdgknstxyz]/.test(char)) {
      key = "CDGKNSTXYZ";
      index += 1;
    } else {
      key = "REST";
      index += 1;
    }

    const variation = (visemeCount % 3) * 10;
    pushEntry(timeline, key, frameMs + variation);
    visemeCount += 1;

    if (visemeCount % 4 === 0) {
      pushEntry(timeline, "REST", frameMs * 0.4);
    }
  }

  pushEntry(timeline, "REST", frameMs * 0.8);

  return timeline;
};
