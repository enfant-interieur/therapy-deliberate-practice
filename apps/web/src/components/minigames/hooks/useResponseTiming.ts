import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ResponseTimingOptions = {
  responseTimerEnabled: boolean;
  responseTimerSeconds?: number;
  maxResponseEnabled: boolean;
  maxResponseSeconds?: number;
  patientEndedAt: number | null;
};

export type TimingViolations = {
  responseDelayMs?: number;
  responseDurationMs?: number;
  delaySeverity?: number;
  durationSeverity?: number;
};

export const MIN_RESPONSE_TIMER_NEGATIVE = 60;

export const calculateTimingPenalty = ({
  responseTimerEnabled,
  responseTimerSeconds,
  maxResponseEnabled,
  maxResponseSeconds,
  responseDelayMs,
  responseDurationMs
}: {
  responseTimerEnabled: boolean;
  responseTimerSeconds?: number;
  maxResponseEnabled: boolean;
  maxResponseSeconds?: number;
  responseDelayMs?: number | null;
  responseDurationMs?: number | null;
}) => {
  let delaySeverity = 0;
  let durationSeverity = 0;

  if (responseTimerEnabled && responseTimerSeconds && responseDelayMs != null) {
    const minDelayMs = responseTimerSeconds * 1000;
    if (responseDelayMs < minDelayMs) {
      delaySeverity = Math.min(1, Math.max(0, 1 - responseDelayMs / minDelayMs));
    }
  }

  if (maxResponseEnabled && maxResponseSeconds && responseDurationMs != null) {
    const maxDurationMs = maxResponseSeconds * 1000;
    if (responseDurationMs > maxDurationMs) {
      durationSeverity = Math.min(
        1,
        Math.max(0, (responseDurationMs - maxDurationMs) / maxDurationMs)
      );
    }
  }

  const severity = Math.max(delaySeverity, durationSeverity);
  const penalty = severity > 0 ? 0.5 + 0.5 * severity : 0;

  return {
    penalty,
    violations: {
      delaySeverity: delaySeverity > 0 ? delaySeverity : undefined,
      durationSeverity: durationSeverity > 0 ? durationSeverity : undefined
    }
  };
};

export const useResponseTiming = ({
  responseTimerEnabled,
  responseTimerSeconds,
  maxResponseEnabled,
  maxResponseSeconds,
  patientEndedAt
}: ResponseTimingOptions) => {
  const [responseStartAt, setResponseStartAt] = useState<number | null>(null);
  const [responseStopAt, setResponseStopAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const responseStartRef = useRef<number | null>(null);
  const responseStopRef = useRef<number | null>(null);
  const patientEndedRef = useRef<number | null>(patientEndedAt);

  useEffect(() => {
    patientEndedRef.current = patientEndedAt;
  }, [patientEndedAt]);

  useEffect(() => {
    if (!responseTimerEnabled && !maxResponseEnabled) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [maxResponseEnabled, responseTimerEnabled]);

  const recordResponseStart = useCallback(() => {
    const timestamp = Date.now();
    responseStartRef.current = timestamp;
    responseStopRef.current = null;
    setResponseStartAt(timestamp);
    setResponseStopAt(null);
    return timestamp;
  }, []);

  const recordResponseStop = useCallback(() => {
    const timestamp = Date.now();
    responseStopRef.current = timestamp;
    setResponseStopAt(timestamp);
    return timestamp;
  }, []);

  const reset = useCallback(() => {
    responseStartRef.current = null;
    responseStopRef.current = null;
    setResponseStartAt(null);
    setResponseStopAt(null);
  }, []);

  const responseDelayMs = useMemo(() => {
    if (!responseStartAt || !patientEndedAt) return null;
    return responseStartAt - patientEndedAt;
  }, [patientEndedAt, responseStartAt]);

  const responseDurationMs = useMemo(() => {
    if (!responseStartAt || !responseStopAt) return null;
    return responseStopAt - responseStartAt;
  }, [responseStartAt, responseStopAt]);

  const responseCountdown = useMemo(() => {
    if (!responseTimerEnabled || !responseTimerSeconds || !patientEndedAt || responseStartAt) {
      return null;
    }
    const elapsed = (now - patientEndedAt) / 1000;
    const remaining = responseTimerSeconds - elapsed;
    return Math.max(-MIN_RESPONSE_TIMER_NEGATIVE, remaining);
  }, [now, patientEndedAt, responseStartAt, responseTimerEnabled, responseTimerSeconds]);

  const maxDurationRemaining = useMemo(() => {
    if (!maxResponseEnabled || !maxResponseSeconds || !responseStartAt || responseStopAt) {
      return null;
    }
    const elapsed = (now - responseStartAt) / 1000;
    const remaining = maxResponseSeconds - elapsed;
    return remaining > 0 ? remaining : 0;
  }, [maxResponseEnabled, maxResponseSeconds, now, responseStartAt, responseStopAt]);

  const computed = useMemo(() => {
    const { penalty, violations } = calculateTimingPenalty({
      responseTimerEnabled,
      responseTimerSeconds,
      maxResponseEnabled,
      maxResponseSeconds,
      responseDelayMs,
      responseDurationMs
    });
    return {
      penalty,
      violations
    };
  }, [
    maxResponseEnabled,
    maxResponseSeconds,
    responseDelayMs,
    responseDurationMs,
    responseTimerEnabled,
    responseTimerSeconds
  ]);

  const getTimingSnapshot = useCallback(() => {
    const delayMs =
      responseStartRef.current && patientEndedRef.current
        ? responseStartRef.current - patientEndedRef.current
        : null;
    const durationMs =
      responseStartRef.current && responseStopRef.current
        ? responseStopRef.current - responseStartRef.current
        : null;
    const { penalty, violations } = calculateTimingPenalty({
      responseTimerEnabled,
      responseTimerSeconds,
      maxResponseEnabled,
      maxResponseSeconds,
      responseDelayMs: delayMs,
      responseDurationMs: durationMs
    });
    return {
      responseDelayMs: delayMs,
      responseDurationMs: durationMs,
      penalty,
      violations
    };
  }, [
    maxResponseEnabled,
    maxResponseSeconds,
    responseTimerEnabled,
    responseTimerSeconds
  ]);

  return {
    responseStartAt,
    responseStopAt,
    responseDelayMs,
    responseDurationMs,
    responseCountdown,
    maxDurationRemaining,
    timingViolations: {
      responseDelayMs: responseDelayMs ?? undefined,
      responseDurationMs: responseDurationMs ?? undefined,
      ...computed.violations
    },
    penalty: computed.penalty,
    recordResponseStart,
    recordResponseStop,
    reset,
    getTimingSnapshot
  };
};
