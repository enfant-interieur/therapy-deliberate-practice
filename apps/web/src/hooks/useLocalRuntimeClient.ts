import { useMemo } from "react";
import { LocalRuntimeClient } from "../lib/localRuntimeClient";
import { useAppSelector } from "../store/hooks";

export const useLocalRuntimeClient = () => {
  const baseUrl = useAppSelector((state) => state.settings.localAiBaseUrl);
  const sttUrl = useAppSelector((state) => state.settings.localEndpoints.stt);
  const llmUrl = useAppSelector((state) => state.settings.localEndpoints.llm);
  return useMemo(
    () =>
      new LocalRuntimeClient({
        baseUrl,
        sttUrl,
        llmUrl
      }),
    [baseUrl, sttUrl, llmUrl]
  );
};
