import { describe, expect, it } from "vitest";
import { calculateTimingPenalty } from "./useResponseTiming";

describe("calculateTimingPenalty", () => {
  it("returns 0 when there is no timing violation", () => {
    const result = calculateTimingPenalty({
      responseTimerEnabled: true,
      responseTimerSeconds: 2,
      maxResponseEnabled: true,
      maxResponseSeconds: 10,
      responseDelayMs: 2100,
      responseDurationMs: 9000,
    });

    expect(result.penalty).toBe(0);
  });

  it("returns a small penalty for minor response delay violations", () => {
    const result = calculateTimingPenalty({
      responseTimerEnabled: true,
      responseTimerSeconds: 2,
      maxResponseEnabled: false,
      responseDelayMs: 1900,
      responseDurationMs: null,
    });

    expect(result.penalty).toBeGreaterThan(0.5);
    expect(result.penalty).toBeLessThan(0.6);
  });

  it("returns a large penalty for major duration violations", () => {
    const result = calculateTimingPenalty({
      responseTimerEnabled: false,
      maxResponseEnabled: true,
      maxResponseSeconds: 10,
      responseDelayMs: null,
      responseDurationMs: 20000,
    });

    expect(result.penalty).toBeCloseTo(1, 2);
  });
});
