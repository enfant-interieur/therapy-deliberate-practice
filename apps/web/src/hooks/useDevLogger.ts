import { useCallback } from "react";

const formatPayload = (payload: unknown) => {
  if (!payload) return undefined;
  try {
    if (typeof payload === "string") return payload;
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return payload;
  }
};

export const useDevLogger = (namespace: string) => {
  const isDev = import.meta.env.DEV;
  return useCallback(
    (message: string, payload?: unknown) => {
      if (!isDev) return;
      const formatted = formatPayload(payload);
      const prefix = `[dev:${namespace}]`;
      if (formatted !== undefined) {
        console.debug(prefix, message, formatted);
      } else {
        console.debug(prefix, message);
      }
    },
    [isDev, namespace]
  );
};
