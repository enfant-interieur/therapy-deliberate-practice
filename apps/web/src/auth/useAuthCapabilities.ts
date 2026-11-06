import { useEffect, useState } from "react";
import type { AuthCapabilities } from "./client";

export function useAuthCapabilities() {
  const [capabilities, setCapabilities] = useState<
    AuthCapabilities | null | undefined
  >(undefined);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/config", {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) =>
        response.ok ? (response.json() as Promise<AuthCapabilities>) : null,
      )
      .then((value) => {
        if (!controller.signal.aborted) setCapabilities(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCapabilities(null);
      });
    return () => controller.abort();
  }, []);
  return capabilities;
}
