import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { PracticeRunResponse } from "@deliberate/shared";
import {
  type LocalPracticePreparation,
  type PracticeSessionItem,
  useCommitLocalPracticeMutation,
  useGetTaskQuery,
  useGetPracticeSessionsQuery,
  useGetPracticeSessionAttemptsQuery,
  useDeletePracticeSessionMutation,
  useRunPracticeMutation,
  usePrepareLocalPracticeMutation,
  useStartSessionMutation,
} from "../store/api";
import { PatientAvatar } from "../components/patient-avatar/PatientAvatar";
import { PracticeJourney } from "../components/PracticeJourney";
import { StatusPill } from "../components/StatusPill";
import { Spinner } from "../components/Spinner";
import { DeleteSessionConfirmDialog } from "../components/minigames/history/DeleteSessionConfirmDialog";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  resetSessionState,
  setAudioBlobRef,
  setAttemptForItem,
  setCurrentIndex,
  setEvaluation,
  setRecordingState,
  setSessionAttempts,
  setSession,
} from "../store/practiceSlice";
import { usePatientAudioBank } from "../patientAudio/usePatientAudioBank";
import { classifyMicError, useMicRecorder } from "../hooks/useMicRecorder";
import {
  checkLocalRuntimeHealth,
  evaluateWithLocalRuntime,
  isLocalRuntimePairingError,
  requireLocalRuntimePairingKey,
  resolveLocalRuntimeGatewayOrigin,
  transcribeWithLocalRuntime,
  type LocalTranscription,
} from "../localRuntime/client";
import {
  clearPracticeDraft,
  clearPracticeSessionDrafts,
  loadPracticeDraft,
  purgeExpiredPracticeDrafts,
  savePracticeDraft,
} from "../utils/practiceDraftStorage";

const blobToBase64 = (blob: Blob, errorMessage: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(errorMessage));
        return;
      }
      const base64 = reader.result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error(errorMessage));
    };
    reader.readAsDataURL(blob);
  });

export const PracticePage = () => {
  const { t } = useTranslation();
  const { taskId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedSessionId = searchParams.get("session");
  const { data: task } = useGetTaskQuery({ id: taskId ?? "" });
  const [startSession, { isLoading: isStartingSession }] =
    useStartSessionMutation();
  const [deleteSession, { isLoading: isDeletingSession }] =
    useDeletePracticeSessionMutation();
  const [runPractice] = useRunPracticeMutation();
  const [prepareLocalPractice] = usePrepareLocalPracticeMutation();
  const [commitLocalPractice] = useCommitLocalPracticeMutation();
  const {
    bank: patientAudioBank,
    ensureReady: ensurePatientAudioReady,
    warmup: warmupPatientAudio,
    play: playPatientAudio,
    stopAndRewind: stopPatientAudio,
    getEntry: getPatientAudioEntry,
  } = usePatientAudioBank({ loggerScope: "practice" });
  const dispatch = useAppDispatch();
  const practice = useAppSelector((state) => state.practice);
  const settings = useAppSelector((state) => state.settings);
  const userId = useAppSelector((state) => state.auth.userId);
  const {
    data: sessionHistory = [],
    isLoading: isLoadingSessions,
    refetch: refetchSessions,
  } = useGetPracticeSessionsQuery({ task_id: taskId }, { skip: !taskId });
  const { data: sessionAttempts = [] } = useGetPracticeSessionAttemptsQuery(
    practice.sessionId ?? "",
    { skip: !practice.sessionId },
  );
  const [error, setError] = useState<string | null>(null);
  const [responseErrors, setResponseErrors] = useState<Array<{
    stage: string;
    message: string;
  }> | null>(null);
  const [nextDifficulty, setNextDifficulty] = useState<number | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [scoreTrust, setScoreTrust] = useState<
    "cloud_trusted" | "local_unverified" | null
  >(null);
  const [practiceMode, setPracticeMode] = useState<"standard" | "real_time">(
    "standard",
  );
  const [responseInputMode, setResponseInputMode] = useState<
    "spoken" | "typed"
  >("spoken");
  const [typedResponse, setTypedResponse] = useState("");
  const [patientSpeaking, setPatientSpeaking] = useState(false);
  const [canRecord, setCanRecord] = useState(true);
  const [hidePatientText, setHidePatientText] = useState(true);
  const [autoPlayPatientAudio, setAutoPlayPatientAudio] = useState(true);
  const [isWarmingPack, setIsWarmingPack] = useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<
    string | null
  >(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<
    "idle" | "transcribing" | "ready" | "error"
  >("idle");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(
    null,
  );
  const [evaluationStatus, setEvaluationStatus] = useState<
    "idle" | "evaluating" | "ready" | "error"
  >("idle");
  const micRecorder = useMicRecorder({ loggerScope: "practice" });
  const cancelMicRecorder = micRecorder.cancel;
  const patientAudioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);
  const playAbortRef = useRef<AbortController | null>(null);
  const autoPlayedOnceRef = useRef<string | null>(null);
  const warmupAbortRef = useRef<AbortController | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);
  const previousTaskIdRef = useRef<string | null>(null);
  const hasInitializedRef = useRef(false);
  const attemptsKeyRef = useRef<string>("");
  const transcriptionPromiseRef = useRef<Promise<PracticeRunResponse> | null>(
    null,
  );
  const transcriptionRequestRef = useRef<string | null>(null);
  const pendingResultRef = useRef<{
    sessionItemId: string;
    result: PracticeRunResponse;
  } | null>(null);
  const evaluationPromiseRef = useRef<Promise<PracticeRunResponse> | null>(
    null,
  );
  const evaluationRequestRef = useRef<string | null>(null);
  const transitionGenerationRef = useRef(0);
  const micStartInFlightRef = useRef(false);
  const localAttemptRef = useRef<{
    preparation: LocalPracticePreparation;
    inputMode: "audio" | "typed";
    sessionItemId: string;
    transcriptText: string;
    transcription?: LocalTranscription;
    token: string;
    llmBaseUrl: string;
  } | null>(null);
  const attemptInputModesRef = useRef<Record<string, "audio" | "typed">>({});
  const isEvaluating = evaluationStatus === "evaluating";
  const isProcessing = transcriptionStatus === "transcribing" || isEvaluating;
  const isMicBusy =
    micRecorder.state === "requesting_permission" ||
    micRecorder.state === "recording" ||
    micRecorder.state === "stopping" ||
    micRecorder.state === "processing";
  const isPracticeTransitionLocked =
    isMicBusy ||
    isProcessing ||
    practice.recordingState === "recording" ||
    practice.recordingState === "processing" ||
    isStartingSession;
  const isResponseModeLocked =
    practice.recordingState === "recording" ||
    isProcessing ||
    (evaluationStatus === "error" && Boolean(practice.currentAttemptId));
  const currentItem = practice.sessionItems[practice.currentIndex];
  const currentExampleId = currentItem?.example_id;
  const currentAudioEntry =
    currentExampleId && taskId
      ? getPatientAudioEntry(taskId, currentExampleId)
      : undefined;
  const patientAudioStatus = currentAudioEntry?.status ?? "idle";
  const patientAudioUrl =
    currentAudioEntry?.blobUrl ?? currentAudioEntry?.audioUrl ?? null;
  const patientCacheKey = currentAudioEntry?.cacheKey ?? null;
  const patientAudioError = currentAudioEntry?.error ?? null;
  const hasCoachReview = Boolean(practice.evaluation);
  const hasPreviousExample = practice.currentIndex > 0;
  const hasNextExample =
    practice.currentIndex + 1 < practice.sessionItems.length;
  const nextArrowAttention = hasCoachReview && hasNextExample;
  const sessionStatementIds = useMemo(
    () => practice.sessionItems.map((item) => item.example_id).filter(Boolean),
    [practice.sessionItems],
  );
  const packTotalCount = sessionStatementIds.length;
  const packReadyCount = sessionStatementIds.reduce((count, statementId) => {
    if (!taskId) return count;
    return getPatientAudioEntry(taskId, statementId)?.status === "ready"
      ? count + 1
      : count;
  }, 0);
  const packProgressPercent =
    packTotalCount > 0
      ? Math.round((packReadyCount / packTotalCount) * 100)
      : 0;
  const showWarmupRing =
    practiceMode === "real_time" &&
    isWarmingPack &&
    packTotalCount > 0 &&
    patientAudioStatus !== "ready";
  const criterionMap = useMemo(() => {
    const entries =
      task?.criteria?.map((criterion) => [criterion.id, criterion] as const) ??
      [];
    return new Map(entries);
  }, [task?.criteria]);
  const scoreMap = useMemo(() => {
    const entries =
      practice.evaluation?.criterion_scores.map(
        (score) => [score.criterion_id, score] as const,
      ) ?? [];
    return new Map(entries);
  }, [practice.evaluation?.criterion_scores]);
  const attemptsByItem = useMemo(() => {
    return Object.fromEntries(
      sessionAttempts
        .filter((attempt) => attempt.session_item_id)
        .map((attempt) => [
          attempt.session_item_id,
          {
            transcript: attempt.transcript,
            evaluation: attempt.evaluation ?? undefined,
            attemptId: attempt.id,
            scoreTrust: attempt.score_trust,
            scoringProvider: attempt.scoring_provider ?? undefined,
          },
        ]),
    );
  }, [sessionAttempts]);
  const overallScore = practice.evaluation?.overall.score;
  const micErrorMessage = useMemo(() => {
    if (!micRecorder.error) return null;
    if (micRecorder.error.kind === "permission_denied") {
      return t("practice.microphone.blocked");
    }
    if (micRecorder.error.kind === "insecure_context") {
      return t("practice.microphone.secureContext");
    }
    return (
      micRecorder.error.recommendedAction ?? t("practice.microphone.generic")
    );
  }, [micRecorder.error, t]);
  const scrollToScoringMatrix = useCallback(() => {
    const target = document.getElementById("practice-scoring-matrix");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const scoreTone = (score?: number) => {
    if (typeof score !== "number") {
      return "border-white/10 bg-white/5 text-slate-300";
    }
    if (score >= 4) {
      return "border-emerald-400/60 bg-emerald-400/10 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.45)]";
    }
    if (score >= 3) {
      return "border-teal-300/60 bg-teal-400/10 text-teal-200 shadow-[0_0_12px_rgba(196,170,250,0.45)]";
    }
    if (score >= 2) {
      return "border-amber-300/60 bg-amber-400/10 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.4)]";
    }
    if (score >= 1) {
      return "border-orange-400/60 bg-orange-400/10 text-orange-200 shadow-[0_0_12px_rgba(251,146,60,0.4)]";
    }
    return "border-rose-400/60 bg-rose-400/10 text-rose-200 shadow-[0_0_12px_rgba(248,113,113,0.4)]";
  };
  const canStartRecording =
    (practiceMode === "standard" || canRecord) && !isProcessing && !isMicBusy;
  const patientKey =
    taskId && currentExampleId ? `${taskId}:${currentExampleId}` : null;
  const sessionIndexKey = useCallback(
    (sessionId: string) => `practiceSessionProgress:${sessionId}`,
    [],
  );
  const formatDate = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }),
    [],
  );
  const latestSession = useMemo(() => {
    if (sessionHistory.length === 0) return null;
    return [...sessionHistory].sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  }, [sessionHistory]);
  const activeSession = useMemo(() => {
    if (practice.sessionId) {
      return (
        sessionHistory.find((session) => session.id === practice.sessionId) ??
        null
      );
    }
    return latestSession;
  }, [latestSession, practice.sessionId, sessionHistory]);
  const isSessionCorrupted = useCallback(
    (session?: (typeof sessionHistory)[number] | null) =>
      Boolean(session && session.items.length === 0),
    [],
  );
  const corruptedSessionIds = useMemo(() => {
    return new Set(
      sessionHistory.filter(isSessionCorrupted).map((session) => session.id),
    );
  }, [isSessionCorrupted, sessionHistory]);
  const hasCorruptedSessions = corruptedSessionIds.size > 0;
  const isActiveSessionCorrupted = activeSession
    ? corruptedSessionIds.has(activeSession.id)
    : false;
  const pendingDeleteSession = useMemo(
    () =>
      sessionHistory.find((session) => session.id === pendingDeleteSessionId) ??
      null,
    [pendingDeleteSessionId, sessionHistory],
  );

  useEffect(() => {
    return () => {
      if (practice.audioBlobRef) {
        URL.revokeObjectURL(practice.audioBlobRef);
      }
    };
  }, [practice.audioBlobRef]);

  const invalidateActiveWork = useCallback(() => {
    transitionGenerationRef.current += 1;
    micStartInFlightRef.current = false;
    cancelMicRecorder();
    transcriptionPromiseRef.current = null;
    transcriptionRequestRef.current = null;
    evaluationPromiseRef.current = null;
    evaluationRequestRef.current = null;
    pendingResultRef.current = null;
    localAttemptRef.current = null;
  }, [cancelMicRecorder]);

  const resetSessionUI = useCallback(() => {
    invalidateActiveWork();
    setError(null);
    setResponseErrors(null);
    setNextDifficulty(null);
    setRequestId(null);
    setScoreTrust(null);
    patientAudioBank.revokeAll();
    setPatientSpeaking(false);
    setCanRecord(practiceMode === "standard");
    setEvaluationStatus("idle");
    setTranscriptExpanded(false);
    setTranscriptionStatus("idle");
    setTranscriptionError(null);
    playAbortRef.current?.abort();
    playAbortRef.current = null;
    playTokenRef.current += 1;
    autoPlayedOnceRef.current = null;
  }, [invalidateActiveWork, patientAudioBank, practiceMode]);

  const startNewSession = useCallback(async () => {
    if (!taskId) return;
    invalidateActiveWork();
    try {
      const result = await startSession({
        mode: "single_task",
        task_id: taskId,
        item_count: 5,
      }).unwrap();
      dispatch(resetSessionState());
      dispatch(
        setSession({ sessionId: result.session_id, items: result.items }),
      );
      dispatch(setCurrentIndex(0));
      resetSessionUI();
      await refetchSessions();
    } catch {
      setError(t("practice.error.sessionFailed"));
    }
  }, [
    dispatch,
    invalidateActiveWork,
    refetchSessions,
    resetSessionUI,
    startSession,
    t,
    taskId,
  ]);

  const confirmDeleteSession = useCallback(async () => {
    if (!pendingDeleteSessionId) return;
    const sessionId = pendingDeleteSessionId;
    setPendingDeleteSessionId(null);
    if (practice.sessionId === sessionId) {
      invalidateActiveWork();
    }
    try {
      await deleteSession({ sessionId }).unwrap();
      window.localStorage.removeItem(sessionIndexKey(sessionId));
      if (userId) {
        clearPracticeSessionDrafts(window.localStorage, userId, sessionId);
      }
      if (practice.sessionId === sessionId) {
        dispatch(resetSessionState());
      }
      await refetchSessions();
    } catch {
      setError(t("practice.error.deleteSession"));
    }
  }, [
    deleteSession,
    dispatch,
    invalidateActiveWork,
    pendingDeleteSessionId,
    practice.sessionId,
    refetchSessions,
    sessionIndexKey,
    t,
    userId,
  ]);

  const loadSession = useCallback(
    (
      sessionId: string,
      items: PracticeSessionItem[],
      fallbackIndex: number,
    ) => {
      dispatch(resetSessionState());
      dispatch(setSession({ sessionId, items }));
      const cachedIndex = Number(
        window.localStorage.getItem(sessionIndexKey(sessionId)),
      );
      const safeIndex =
        Number.isFinite(cachedIndex) &&
        cachedIndex >= 0 &&
        cachedIndex < items.length
          ? cachedIndex
          : fallbackIndex;
      dispatch(setCurrentIndex(safeIndex));
      resetSessionUI();
    },
    [dispatch, resetSessionUI, sessionIndexKey],
  );

  useEffect(() => {
    purgeExpiredPracticeDrafts(window.localStorage);
  }, []);

  useEffect(() => {
    if (!taskId) return;
    if (!hasInitializedRef.current) {
      dispatch(resetSessionState());
      hasInitializedRef.current = true;
    }
  }, [dispatch, taskId]);

  useEffect(() => {
    if (!taskId) return;
    if (previousTaskIdRef.current && previousTaskIdRef.current !== taskId) {
      dispatch(resetSessionState());
    }
    previousTaskIdRef.current = taskId;
  }, [dispatch, taskId]);

  useEffect(() => {
    if (!taskId) return;
    if (!requestedSessionId) return;
    if (isLoadingSessions) return;
    const requestedSession = sessionHistory.find(
      (session) => session.id === requestedSessionId,
    );
    if (!requestedSession) return;
    if (isSessionCorrupted(requestedSession)) {
      if (!practice.sessionId) {
        void startNewSession();
      }
      return;
    }
    if (practice.sessionId === requestedSession.id) return;
    const fallbackIndex = Math.min(
      requestedSession.completed_count,
      Math.max(requestedSession.items.length - 1, 0),
    );
    loadSession(requestedSession.id, requestedSession.items, fallbackIndex);
  }, [
    isLoadingSessions,
    isSessionCorrupted,
    loadSession,
    practice.sessionId,
    requestedSessionId,
    sessionHistory,
    startNewSession,
    taskId,
  ]);

  useEffect(() => {
    if (!taskId) return;
    if (practice.sessionId) return;
    if (isLoadingSessions) return;
    if (requestedSessionId) {
      const requestedSession = sessionHistory.find(
        (session) => session.id === requestedSessionId,
      );
      if (requestedSession) return;
    }
    if (latestSession) {
      if (isSessionCorrupted(latestSession)) {
        void startNewSession();
        return;
      }
      const fallbackIndex = Math.min(
        latestSession.completed_count,
        Math.max(latestSession.items.length - 1, 0),
      );
      loadSession(latestSession.id, latestSession.items, fallbackIndex);
      return;
    }
    void startNewSession();
  }, [
    isLoadingSessions,
    isSessionCorrupted,
    latestSession,
    loadSession,
    practice.sessionId,
    requestedSessionId,
    sessionHistory,
    startNewSession,
    taskId,
  ]);

  useEffect(() => {
    if (!practice.sessionId) return;
    window.localStorage.setItem(
      sessionIndexKey(practice.sessionId),
      practice.currentIndex.toString(),
    );
  }, [practice.currentIndex, practice.sessionId, sessionIndexKey]);

  useEffect(() => {
    setTranscriptionStatus(practice.transcript ? "ready" : "idle");
    if (evaluationStatus !== "evaluating") {
      setEvaluationStatus(practice.evaluation ? "ready" : "idle");
    }
    setTranscriptionError(null);
    transcriptionPromiseRef.current = null;
    evaluationPromiseRef.current = null;
    pendingResultRef.current = null;
  }, [
    evaluationStatus,
    practice.currentSessionItemId,
    practice.evaluation,
    practice.transcript,
  ]);

  useEffect(() => {
    setScoreTrust(practice.scoreTrust ?? null);
  }, [practice.currentSessionItemId, practice.scoreTrust]);

  useEffect(() => {
    const itemId = practice.currentSessionItemId;
    if (!itemId) {
      setTypedResponse("");
      return;
    }
    const restoredDraft =
      practice.sessionId && userId
        ? loadPracticeDraft(
            window.localStorage,
            userId,
            practice.sessionId,
            itemId,
          )
        : null;
    setTypedResponse(restoredDraft ?? practice.transcript ?? "");
  }, [
    practice.currentSessionItemId,
    practice.sessionId,
    practice.transcript,
    userId,
  ]);

  useEffect(() => {
    invalidateActiveWork();
    dispatch(setAudioBlobRef({}));
    dispatch(setRecordingState("ready"));
  }, [dispatch, invalidateActiveWork, practice.currentSessionItemId]);

  useEffect(() => {
    if (!practice.sessionId) return;
    const key = sessionAttempts
      .map(
        (attempt) =>
          `${attempt.id}:${attempt.session_item_id ?? ""}:${attempt.completed_at ?? "x"}`,
      )
      .join("|");
    if (key === attemptsKeyRef.current) return;
    attemptsKeyRef.current = key;
    dispatch(setSessionAttempts(attemptsByItem));
  }, [attemptsByItem, dispatch, practice.sessionId, sessionAttempts]);

  useEffect(() => {
    attemptsKeyRef.current = "";
  }, [practice.sessionId]);

  useEffect(() => {
    patientAudioBank.revokeAll();
    setIsWarmingPack(false);
    warmupAbortRef.current?.abort();
    prefetchAbortRef.current?.abort();
    playAbortRef.current?.abort();
    playAbortRef.current = null;
    playTokenRef.current += 1;
    autoPlayedOnceRef.current = null;
  }, [patientAudioBank, practice.sessionId]);

  useEffect(() => {
    return () => {
      patientAudioBank.revokeAll();
      warmupAbortRef.current?.abort();
      prefetchAbortRef.current?.abort();
      playAbortRef.current?.abort();
    };
  }, [patientAudioBank]);

  useEffect(() => {
    setPatientSpeaking(false);
    setCanRecord(practiceMode === "standard");
    setTranscriptionStatus("idle");
    setTranscriptionError(null);
    setTranscriptExpanded(false);
    transcriptionPromiseRef.current = null;
    transcriptionRequestRef.current = null;
    pendingResultRef.current = null;
    playTokenRef.current += 1;
    autoPlayedOnceRef.current = null;
    playAbortRef.current?.abort();
    playAbortRef.current = null;
    if (patientAudioRef.current) {
      stopPatientAudio(patientAudioRef.current);
    }
  }, [currentExampleId, patientAudioBank, practiceMode, stopPatientAudio]);

  useEffect(() => {
    if (practiceMode !== "real_time") return;
    if (patientAudioStatus === "error") {
      setCanRecord(true);
    }
  }, [patientAudioStatus, practiceMode]);

  useEffect(() => {
    if (practiceMode === "real_time") return;
    warmupAbortRef.current?.abort();
    prefetchAbortRef.current?.abort();
    setIsWarmingPack(false);
  }, [practiceMode]);

  useEffect(() => {
    if (practiceMode !== "real_time" || !taskId || !currentExampleId) return;
    const controller = new AbortController();
    prefetchAbortRef.current?.abort();
    prefetchAbortRef.current = controller;

    const runPrefetch = async () => {
      setCanRecord(false);
      await ensurePatientAudioReady(taskId, currentExampleId, {
        signal: controller.signal,
      });
    };

    runPrefetch().catch(() => {
      if (!controller.signal.aborted) {
        setCanRecord(true);
      }
    });
    return () => {
      controller.abort();
    };
  }, [currentExampleId, ensurePatientAudioReady, practiceMode, taskId]);

  useEffect(() => {
    if (practiceMode !== "real_time" || !taskId || packTotalCount === 0) {
      setIsWarmingPack(false);
      warmupAbortRef.current?.abort();
      return;
    }

    const controller = new AbortController();
    warmupAbortRef.current?.abort();
    warmupAbortRef.current = controller;
    setIsWarmingPack(true);

    const runWarmup = async () => {
      await warmupPatientAudio(
        { [taskId]: sessionStatementIds },
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setIsWarmingPack(false);
      }
    };

    runWarmup().catch(() => {
      if (!controller.signal.aborted) {
        setIsWarmingPack(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [
    packTotalCount,
    warmupPatientAudio,
    practiceMode,
    sessionStatementIds,
    taskId,
  ]);

  useEffect(() => {
    if (practiceMode !== "real_time") return;
    if (!autoPlayPatientAudio) return;
    if (patientAudioStatus !== "ready") return;
    if (!patientAudioRef.current) return;
    if (!taskId || !currentExampleId) return;
    if (autoPlayedOnceRef.current === patientKey) return;
    const controller = new AbortController();
    playAbortRef.current?.abort();
    playAbortRef.current = controller;
    const token = (playTokenRef.current += 1);
    autoPlayedOnceRef.current = patientKey;
    playPatientAudio(taskId, currentExampleId, patientAudioRef.current, {
      signal: controller.signal,
      shouldPlay: () => playTokenRef.current === token,
    }).catch(() => null);
  }, [
    autoPlayPatientAudio,
    currentExampleId,
    patientAudioStatus,
    playPatientAudio,
    patientKey,
    practiceMode,
    taskId,
  ]);

  const beginTranscription = useCallback(
    async (blob: Blob, mimeType?: string | null) => {
      if (!currentItem) return null;
      const transcriptionId = `${currentItem.session_item_id}:${Date.now()}`;
      transcriptionRequestRef.current = transcriptionId;
      setTranscriptionStatus("transcribing");
      setTranscriptionError(null);
      setEvaluationStatus("idle");
      setError(null);
      setResponseErrors(null);
      setNextDifficulty(null);
      setRequestId(null);
      setScoreTrust(null);
      dispatch(setEvaluation(undefined));
      const promise = (async () => {
        const turnContext =
          practiceMode === "real_time"
            ? {
                patient_cache_key: patientCacheKey ?? undefined,
                patient_statement_id: currentExampleId,
              }
            : undefined;
        let result: PracticeRunResponse | null = null;
        let localError: unknown;
        if (settings.aiMode !== "openai_only") {
          try {
            const gatewayOrigin = resolveLocalRuntimeGatewayOrigin({
              baseUrl: settings.localAiBaseUrl,
              sttUrl: settings.localEndpoints.stt,
              llmUrl: settings.localEndpoints.llm,
            });
            const token = requireLocalRuntimePairingKey(gatewayOrigin);
            const health = await checkLocalRuntimeHealth(gatewayOrigin);
            if (health.status !== "ready") {
              throw new Error(
                t("practice.error.localRuntimeStatus", {
                  status: health.status,
                }),
              );
            }
            const transcription = await transcribeWithLocalRuntime({
              baseUrl: gatewayOrigin,
              token,
              audio: blob,
              language: task?.language,
            });
            const preparation = await prepareLocalPractice({
              session_item_id: currentItem.session_item_id,
              input_mode: "audio",
              transcript: {
                text: transcription.text,
                model: transcription.model,
                duration_ms: transcription.durationMs,
              },
            }).unwrap();
            localAttemptRef.current = {
              preparation,
              inputMode: "audio",
              sessionItemId: currentItem.session_item_id,
              transcriptText: transcription.text,
              transcription,
              token,
              llmBaseUrl: gatewayOrigin,
            };
            result = {
              requestId: preparation.requestId,
              attemptId: preparation.attemptId,
              score_trust: "local_unverified",
              transcript: {
                text: transcription.text,
                provider: { kind: "local", model: transcription.model },
                duration_ms: transcription.durationMs,
              },
            };
          } catch (caught) {
            localError = caught;
            localAttemptRef.current = null;
            if (isLocalRuntimePairingError(caught)) {
              throw new Error(t("practice.localRuntime.pairAgain"), {
                cause: caught,
              });
            }
            if (settings.aiMode === "local_only" || !settings.hasOpenAiKey) {
              const detail =
                caught instanceof Error ? caught.message : String(caught);
              throw new Error(
                t("practice.error.localRuntimeUnavailable", { detail }),
                { cause: caught },
              );
            }
          }
        }
        if (!result) {
          const base64 = await blobToBase64(
            blob,
            t("practice.error.readAudio"),
          );
          result = await runPractice({
            session_item_id: currentItem.session_item_id,
            audio: base64,
            audio_mime: mimeType ?? undefined,
            mode: "openai_only",
            practice_mode: practiceMode,
            turn_context: turnContext,
            skip_scoring: true,
          }).unwrap();
          if (localError) {
            setResponseErrors([
              {
                stage: "stt",
                message: t("practice.localRuntime.cloudFallback"),
              },
            ]);
          }
        }
        if (transcriptionRequestRef.current !== transcriptionId) {
          return result;
        }
        pendingResultRef.current = {
          sessionItemId: currentItem.session_item_id,
          result,
        };
        if (result.attemptId) {
          attemptInputModesRef.current[result.attemptId] = "audio";
        }
        dispatch(
          setAttemptForItem({
            sessionItemId: currentItem.session_item_id,
            transcript: result.transcript?.text,
            attemptId: result.attemptId,
            scoreTrust: result.score_trust ?? "cloud_trusted",
          }),
        );
        setRequestId(result.requestId ?? null);
        setScoreTrust(result.score_trust ?? "cloud_trusted");
        setTranscriptionStatus("ready");
        dispatch(setRecordingState("ready"));
        return result;
      })();
      transcriptionPromiseRef.current = promise;
      return promise.catch((err) => {
        if (transcriptionRequestRef.current !== transcriptionId) {
          throw err;
        }
        setTranscriptionStatus("error");
        setTranscriptionError(t("practice.error.transcriptionFailed"));
        dispatch(setRecordingState("ready"));
        throw err;
      });
    },
    [
      currentExampleId,
      currentItem,
      dispatch,
      patientCacheKey,
      practiceMode,
      prepareLocalPractice,
      runPractice,
      settings.aiMode,
      settings.hasOpenAiKey,
      settings.localAiBaseUrl,
      settings.localEndpoints.llm,
      settings.localEndpoints.stt,
      task?.language,
      t,
    ],
  );

  const beginEvaluation = useCallback(
    async (result?: PracticeRunResponse | null) => {
      if (!currentItem) return null;
      const evaluationId = `${currentItem.session_item_id}:${Date.now()}`;
      evaluationRequestRef.current = evaluationId;
      setEvaluationStatus("evaluating");
      setError(null);
      setResponseErrors(null);
      const transcriptText =
        result?.transcript?.text ?? practice.transcript ?? "";
      const attemptId = result?.attemptId ?? practice.currentAttemptId;
      if (!transcriptText || !attemptId) {
        setEvaluationStatus("error");
        return null;
      }
      const promise = (async () => {
        const attemptInputMode =
          result?.transcript?.input_mode ??
          attemptInputModesRef.current[attemptId] ??
          (practice.audioBlobRef ? "audio" : "typed");
        const turnContext =
          practiceMode === "real_time"
            ? {
                patient_cache_key: patientCacheKey ?? undefined,
                patient_statement_id: currentExampleId,
              }
            : undefined;
        let evaluationResult: PracticeRunResponse | null = null;
        let localFallbackMessage: string | null = null;
        const localAttempt =
          localAttemptRef.current?.preparation.attemptId === attemptId
            ? localAttemptRef.current
            : null;
        const isPreparedLocalAttempt =
          result?.score_trust === "local_unverified" ||
          practice.scoreTrust === "local_unverified";

        if (localAttempt) {
          let localEvaluation;
          try {
            localEvaluation = await evaluateWithLocalRuntime({
              baseUrl: localAttempt.llmBaseUrl,
              token: localAttempt.token,
              task: localAttempt.preparation.task,
              example: localAttempt.preparation.example,
              attemptId,
              transcript: transcriptText,
            });
          } catch (caught) {
            if (isLocalRuntimePairingError(caught)) {
              throw new Error(t("practice.localRuntime.pairAgain"), {
                cause: caught,
              });
            }
            if (settings.aiMode === "local_only" || !settings.hasOpenAiKey) {
              const detail =
                caught instanceof Error ? caught.message : String(caught);
              throw new Error(
                t("practice.error.localEvaluationFailed", { detail }),
                {
                  cause: caught,
                },
              );
            }
            localFallbackMessage = t(
              "practice.localRuntime.spokenCloudFallback",
            );
            evaluationResult = await runPractice({
              session_item_id: currentItem.session_item_id,
              attempt_id: attemptId,
              transcript_text: transcriptText,
              input_mode: attemptInputMode,
              mode: "openai_only",
              practice_mode: practiceMode,
              turn_context: turnContext,
            }).unwrap();
          }
          if (localEvaluation) {
            evaluationResult = await commitLocalPractice({
              attempt_id: attemptId,
              input_mode: localAttempt.inputMode,
              transcript:
                localAttempt.inputMode === "typed"
                  ? { text: transcriptText }
                  : {
                      text: transcriptText,
                      model: localAttempt.transcription!.model,
                      duration_ms: localAttempt.transcription!.durationMs,
                    },
              evaluation: localEvaluation.evaluation,
              llm: {
                model: localEvaluation.model,
                duration_ms: localEvaluation.durationMs,
              },
              practice_mode: practiceMode,
              turn_context: turnContext,
            }).unwrap();
          }
        } else {
          if (isPreparedLocalAttempt && settings.aiMode === "local_only") {
            throw new Error(t("practice.error.localContextExpired"));
          }
          evaluationResult = await runPractice({
            session_item_id: currentItem.session_item_id,
            attempt_id: attemptId,
            transcript_text: transcriptText,
            input_mode: attemptInputMode,
            mode: "openai_only",
            practice_mode: practiceMode,
            turn_context: turnContext,
          }).unwrap();
        }
        if (!evaluationResult) {
          throw new Error(t("practice.error.evaluateFailed"));
        }
        if (evaluationRequestRef.current !== evaluationId) {
          return evaluationResult;
        }
        setRequestId(evaluationResult.requestId ?? null);
        setResponseErrors(
          evaluationResult.errors ??
            (localFallbackMessage
              ? [{ stage: "evaluation", message: localFallbackMessage }]
              : null),
        );
        setNextDifficulty(evaluationResult.next_recommended_difficulty ?? null);
        setScoreTrust(evaluationResult.score_trust ?? "cloud_trusted");
        dispatch(
          setAttemptForItem({
            sessionItemId: currentItem.session_item_id,
            transcript: transcriptText,
            evaluation: evaluationResult.scoring?.evaluation,
            scoringProvider: evaluationResult.scoring?.provider,
            attemptId: evaluationResult.attemptId ?? attemptId,
            scoreTrust: evaluationResult.score_trust ?? "cloud_trusted",
          }),
        );
        setEvaluationStatus(
          evaluationResult.scoring?.evaluation ? "ready" : "error",
        );
        return evaluationResult;
      })();
      evaluationPromiseRef.current = promise;
      return promise.catch((err) => {
        if (evaluationRequestRef.current !== evaluationId) {
          throw err;
        }
        setEvaluationStatus("error");
        throw err;
      });
    },
    [
      currentExampleId,
      currentItem,
      commitLocalPractice,
      dispatch,
      patientCacheKey,
      practice.currentAttemptId,
      practice.audioBlobRef,
      practice.scoreTrust,
      practice.transcript,
      practiceMode,
      runPractice,
      settings.aiMode,
      settings.hasOpenAiKey,
      t,
    ],
  );

  const startRecording = () => {
    if (micStartInFlightRef.current) return;
    setError(null);
    setResponseErrors(null);
    setNextDifficulty(null);
    setRequestId(null);
    setTranscriptionStatus("idle");
    setTranscriptionError(null);
    setEvaluationStatus("idle");
    transcriptionPromiseRef.current = null;
    transcriptionRequestRef.current = null;
    evaluationPromiseRef.current = null;
    evaluationRequestRef.current = null;
    pendingResultRef.current = null;
    localAttemptRef.current = null;
    setScoreTrust(null);
    dispatch(setEvaluation(undefined));
    if (practiceMode === "real_time" && !canRecord) {
      setError(t("practice.error.waitForPatient"));
      return;
    }
    if (
      !micRecorder.capabilities.hasMediaRecorder ||
      !micRecorder.capabilities.hasGetUserMedia
    ) {
      setError(t("practice.error.recordingUnsupported"));
      return;
    }
    const transitionGeneration = transitionGenerationRef.current;
    micStartInFlightRef.current = true;
    void micRecorder
      .startFromUserGesture()
      .then((started) => {
        if (transitionGeneration !== transitionGenerationRef.current) return;
        dispatch(setRecordingState(started ? "recording" : "ready"));
      })
      .catch((err) => {
        if (transitionGeneration !== transitionGenerationRef.current) return;
        const classified = classifyMicError(err);
        setError(
          classified.recommendedAction ?? t("practice.error.microphoneAccess"),
        );
        dispatch(setRecordingState("ready"));
      })
      .finally(() => {
        if (transitionGeneration === transitionGenerationRef.current) {
          micStartInFlightRef.current = false;
        }
      });
  };

  const stopRecording = () => {
    if (micRecorder.state === "requesting_permission") {
      cancelMicRecorder();
      dispatch(setRecordingState("ready"));
      return;
    }
    const transitionGeneration = transitionGenerationRef.current;
    dispatch(setRecordingState("processing"));
    void micRecorder.stop().then((recorded) => {
      if (
        !recorded ||
        transitionGeneration !== transitionGenerationRef.current
      ) {
        return;
      }
      const url = URL.createObjectURL(recorded.blob);
      if (practice.audioBlobRef) {
        URL.revokeObjectURL(practice.audioBlobRef);
      }
      dispatch(setAudioBlobRef({ url, mimeType: recorded.mimeType }));
      void beginTranscription(recorded.blob, recorded.mimeType)
        .then((result) => {
          if (result) {
            void beginEvaluation(result).catch(() => null);
          }
        })
        .catch(() => null);
    });
  };

  const runEvaluation = async () => {
    if (!currentItem || !practice.audioBlobRef) return;
    try {
      setError(null);
      setResponseErrors(null);
      dispatch(setRecordingState("processing"));
      if (!transcriptionPromiseRef.current) {
        const response = await fetch(practice.audioBlobRef);
        const blob = await response.blob();
        if (!blob.size) {
          setError(t("practice.error.noAudio"));
          dispatch(setRecordingState("ready"));
          return;
        }
        const result = await beginTranscription(blob, practice.audioMime);
        await beginEvaluation(result);
      } else {
        const result = await transcriptionPromiseRef.current;
        await beginEvaluation(result);
      }
      dispatch(setRecordingState("ready"));
    } catch (err) {
      const message =
        typeof err === "object" &&
        err &&
        "data" in err &&
        (err as { data?: { error?: string } }).data
          ? (err as { data?: { error?: string } }).data?.error
          : null;
      const errorData =
        typeof err === "object" && err && "data" in err
          ? (
              err as {
                data?: {
                  requestId?: string;
                  errors?: Array<{ stage: string; message: string }>;
                };
              }
            ).data
          : undefined;
      if (errorData?.requestId) {
        setRequestId(errorData.requestId);
      }
      if (errorData?.errors) {
        setResponseErrors(errorData.errors);
      }
      setError(message ?? t("practice.error.evaluateFailed"));
      dispatch(setRecordingState("ready"));
    }
  };

  const submitTypedResponse = async () => {
    if (!currentItem) return;
    const transcriptText = typedResponse.trim();
    if (!transcriptText) {
      setError(t("practice.typed.required"));
      return;
    }

    const turnContext =
      practiceMode === "real_time"
        ? {
            patient_cache_key: patientCacheKey ?? undefined,
            patient_statement_id: currentExampleId,
          }
        : undefined;

    setError(null);
    setResponseErrors(null);
    setEvaluationStatus("evaluating");
    setTranscriptionStatus("ready");
    setRequestId(null);
    setNextDifficulty(null);
    setScoreTrust(null);
    dispatch(setEvaluation(undefined));
    try {
      let localError: unknown;
      if (settings.aiMode !== "openai_only") {
        let preparedLocalAttempt =
          localAttemptRef.current?.inputMode === "typed" &&
          localAttemptRef.current.sessionItemId ===
            currentItem.session_item_id &&
          localAttemptRef.current.transcriptText === transcriptText
            ? localAttemptRef.current
            : null;
        try {
          if (!preparedLocalAttempt) {
            const gatewayOrigin = resolveLocalRuntimeGatewayOrigin({
              baseUrl: settings.localAiBaseUrl,
              sttUrl: settings.localEndpoints.stt,
              llmUrl: settings.localEndpoints.llm,
            });
            const token = requireLocalRuntimePairingKey(gatewayOrigin);
            const health = await checkLocalRuntimeHealth(gatewayOrigin);
            if (health.status !== "ready") {
              throw new Error(
                t("practice.error.localRuntimeStatus", {
                  status: health.status,
                }),
              );
            }
            const preparation = await prepareLocalPractice({
              session_item_id: currentItem.session_item_id,
              input_mode: "typed",
              transcript: { text: transcriptText },
            }).unwrap();
            preparedLocalAttempt = {
              preparation,
              inputMode: "typed",
              sessionItemId: currentItem.session_item_id,
              transcriptText,
              token,
              llmBaseUrl: gatewayOrigin,
            };
            localAttemptRef.current = preparedLocalAttempt;
          }
        } catch (caught) {
          localError = caught;
          localAttemptRef.current = null;
          if (isLocalRuntimePairingError(caught)) {
            throw new Error(t("practice.localRuntime.pairAgain"), {
              cause: caught,
            });
          }
          if (settings.aiMode === "local_only" || !settings.hasOpenAiKey) {
            const detail =
              caught instanceof Error ? caught.message : String(caught);
            throw new Error(t("practice.typed.localUnavailable", { detail }), {
              cause: caught,
            });
          }
        }
        if (preparedLocalAttempt) {
          const { preparation } = preparedLocalAttempt;
          attemptInputModesRef.current[preparation.attemptId] = "typed";
          const preparedResult: PracticeRunResponse = {
            requestId: preparation.requestId,
            attemptId: preparation.attemptId,
            score_trust: "local_unverified",
            transcript: {
              text: transcriptText,
              input_mode: "typed",
              provider: null,
              duration_ms: null,
            },
          };
          dispatch(
            setAttemptForItem({
              sessionItemId: currentItem.session_item_id,
              transcript: transcriptText,
              attemptId: preparation.attemptId,
              scoreTrust: "local_unverified",
            }),
          );
          const completedResult = await beginEvaluation(preparedResult);
          if (userId && completedResult?.scoring?.evaluation) {
            clearPracticeDraft(
              window.localStorage,
              userId,
              practice.sessionId ?? "",
              currentItem.session_item_id,
            );
          }
          return;
        }
      }

      const result = await runPractice({
        session_item_id: currentItem.session_item_id,
        input_mode: "typed",
        transcript_text: transcriptText,
        mode: "openai_only",
        practice_mode: practiceMode,
        turn_context: turnContext,
      }).unwrap();
      dispatch(
        setAttemptForItem({
          sessionItemId: currentItem.session_item_id,
          transcript: transcriptText,
          evaluation: result.scoring?.evaluation,
          scoringProvider: result.scoring?.provider,
          attemptId: result.attemptId,
          scoreTrust: result.score_trust ?? "cloud_trusted",
        }),
      );
      setRequestId(result.requestId ?? null);
      setNextDifficulty(result.next_recommended_difficulty ?? null);
      setScoreTrust(result.score_trust ?? "cloud_trusted");
      setResponseErrors(
        result.errors ??
          (localError
            ? [
                {
                  stage: "evaluation",
                  message: t("practice.typed.localFallback"),
                },
              ]
            : null),
      );
      setEvaluationStatus(result.scoring?.evaluation ? "ready" : "error");
      if (result.scoring?.evaluation) {
        if (userId) {
          clearPracticeDraft(
            window.localStorage,
            userId,
            practice.sessionId ?? "",
            currentItem.session_item_id,
          );
        }
      }
    } catch (caught) {
      setEvaluationStatus("error");
      const detail =
        typeof caught === "object" && caught && "data" in caught
          ? (caught as { data?: { error?: string } }).data?.error
          : undefined;
      setError(
        detail ??
          (caught instanceof Error
            ? caught.message
            : t("practice.error.evaluateFailed")),
      );
    }
  };

  const handleNextExample = () => {
    if (isPracticeTransitionLocked) return;
    const nextIndex = practice.currentIndex + 1;
    if (nextIndex < practice.sessionItems.length) {
      invalidateActiveWork();
      dispatch(setCurrentIndex(nextIndex));
      setResponseErrors(null);
      setRequestId(null);
      setNextDifficulty(null);
    }
  };

  const handlePreviousExample = () => {
    if (isPracticeTransitionLocked) return;
    const prevIndex = practice.currentIndex - 1;
    if (prevIndex >= 0) {
      invalidateActiveWork();
      dispatch(setCurrentIndex(prevIndex));
      setResponseErrors(null);
      setRequestId(null);
      setNextDifficulty(null);
    }
  };

  const handlePracticeModeChange = (mode: "standard" | "real_time") => {
    if (isPracticeTransitionLocked || mode === practiceMode) return;
    invalidateActiveWork();
    setPracticeMode(mode);
  };

  return (
    <div className="space-y-8">
      <div className="studio-hero">
        <p className="studio-eyebrow">{t("studio.practice.kicker")}</p>
        <h1 className="studio-heading mt-3 text-3xl sm:text-4xl">
          {task?.title ?? t("practice.loadingExercise")}
        </h1>
        <div className="mt-6">
          <PracticeJourney active={practice.evaluation ? 2 : 1} />
        </div>
      </div>
      <section className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <details className="group rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-white">
              <span>{task?.title ?? t("practice.loadingExercise")}</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-slate-200 transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-5 space-y-4 text-sm text-slate-300">
              {task?.description && (
                <p className="text-sm text-slate-200">{task.description}</p>
              )}
              {task?.general_objective && (
                <p className="text-xs text-slate-400">
                  {task.general_objective}
                </p>
              )}
              <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1">
                  {t("practice.baseDifficulty", {
                    difficulty: task?.base_difficulty ?? "--",
                  })}
                </span>
                {task?.skill_domain && (
                  <span className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1">
                    {task.skill_domain}
                  </span>
                )}
                {(task?.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-slate-900/60 px-3 py-1"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </details>
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-teal-300">
                {t("practice.taskCriteria")}
              </p>
              <div className="mt-4 space-y-3">
                {task?.criteria?.map((criterion, index) => (
                  <div
                    key={criterion.id}
                    className="relative rounded-2xl border border-white/10 bg-slate-900/50 p-4"
                  >
                    {practice.evaluation && (
                      <button
                        type="button"
                        onClick={scrollToScoringMatrix}
                        className={`absolute right-3 top-3 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition hover:scale-[1.02] ${scoreTone(
                          scoreMap.get(criterion.id)?.score,
                        )}`}
                      >
                        {scoreMap.get(criterion.id)?.score ?? "--"}/4
                      </button>
                    )}
                    <div className={practice.evaluation ? "pr-16" : ""}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-teal-300/40 bg-teal-400/10 text-xs font-semibold text-teal-200 shadow-[0_0_12px_rgba(196,170,250,0.35)]">
                          {index + 1}
                        </span>
                        <p className="text-sm font-semibold text-white">
                          {criterion.label}
                        </p>
                      </div>
                      <p className="mt-2 text-xs text-slate-300">
                        {criterion.description}
                      </p>
                    </div>
                  </div>
                ))}
                {!task?.criteria?.length && (
                  <p className="text-xs text-slate-400">
                    {t("practice.noCriteria")}
                  </p>
                )}
              </div>
              {practice.evaluation && (
                <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">
                      {t("practice.overallScore")}
                    </p>
                    <button
                      type="button"
                      onClick={scrollToScoringMatrix}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] transition hover:scale-[1.02] ${scoreTone(
                        overallScore,
                      )}`}
                    >
                      {overallScore ?? "--"}/4
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">
                    {practice.evaluation.overall.pass
                      ? t("practice.onTrack")
                      : t("practice.needsRefinement")}
                  </p>
                  {scoreTrust === "local_unverified" && (
                    <p className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs leading-5 text-amber-100">
                      {t("practice.localScoreNotice")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold">
              {t("practice.presentationMode.title")}
            </h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  practiceMode === "standard"
                    ? "bg-teal-400 text-slate-950"
                    : "border border-white/20 text-slate-200"
                }`}
                onClick={() => handlePracticeModeChange("standard")}
                disabled={isPracticeTransitionLocked}
              >
                {t("practice.presentationMode.text")}
              </button>
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  practiceMode === "real_time"
                    ? "bg-teal-400 text-slate-950"
                    : "border border-white/20 text-slate-200"
                }`}
                onClick={() => handlePracticeModeChange("real_time")}
                disabled={isPracticeTransitionLocked}
              >
                {t("practice.presentationMode.audio")}
              </button>
            </div>
            {practiceMode === "real_time" && (
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-200">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={autoPlayPatientAudio}
                    onChange={(event) =>
                      setAutoPlayPatientAudio(event.target.checked)
                    }
                  />
                  {t("practice.presentationMode.autoPlay")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={hidePatientText}
                    onChange={(event) =>
                      setHidePatientText(event.target.checked)
                    }
                  />
                  {t("practice.presentationMode.hideText")}
                </label>
              </div>
            )}
          </div>
          <details className="group rounded-3xl border border-white/10 bg-slate-900/60 p-6">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-lg font-semibold text-white">
              <span>{t("practice.sessions.title")}</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg text-slate-200 transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-4 space-y-3">
              {activeSession && (
                <div className="rounded-2xl border border-teal-400/40 bg-teal-500/10 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-white">
                      {t("practice.sessions.label", {
                        id: activeSession.id.slice(0, 6).toUpperCase(),
                      })}
                    </p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                        isActiveSessionCorrupted
                          ? "border-rose-400/60 bg-rose-500/10 text-rose-200"
                          : "border-white/10 bg-white/5 text-slate-300"
                      }`}
                    >
                      {isActiveSessionCorrupted
                        ? t("practice.sessions.needsReset")
                        : activeSession.completed_count >=
                            activeSession.item_count
                          ? t("practice.sessions.completed")
                          : t("practice.sessions.inProgress")}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>
                      {formatDate.format(new Date(activeSession.created_at))}
                    </span>
                    <span>
                      {t("practice.sessions.progress", {
                        completed: activeSession.completed_count,
                        total: activeSession.item_count,
                      })}
                    </span>
                  </div>
                </div>
              )}
              {!activeSession && isLoadingSessions && (
                <p className="text-sm text-slate-400">
                  {t("practice.sessions.loading")}
                </p>
              )}
              {!activeSession && !isLoadingSessions && (
                <p className="text-sm text-slate-400">
                  {t("practice.sessions.empty")}
                </p>
              )}
              {hasCorruptedSessions && (
                <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
                  {t("practice.sessions.corrupted")}
                </div>
              )}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-300">
                {t("practice.sessions.helper")}
              </p>
              <button
                type="button"
                className="rounded-full bg-teal-400 px-4 py-2 text-xs font-semibold text-slate-950"
                onClick={startNewSession}
                disabled={isPracticeTransitionLocked}
              >
                {t("practice.sessions.new")}
              </button>
            </div>
            <div className="mt-4 max-h-[320px] space-y-3 overflow-y-auto pr-2">
              {isLoadingSessions && sessionHistory.length === 0 && (
                <p className="text-sm text-slate-400">
                  {t("practice.sessions.loading")}
                </p>
              )}
              {!isLoadingSessions && sessionHistory.length === 0 && (
                <p className="text-sm text-slate-400">
                  {t("practice.sessions.empty")}
                </p>
              )}
              {sessionHistory.map((session) => {
                const isActive = session.id === practice.sessionId;
                const isCorrupted = corruptedSessionIds.has(session.id);
                const fallbackIndex = Math.min(
                  session.completed_count,
                  Math.max(session.items.length - 1, 0),
                );
                return (
                  <div
                    key={session.id}
                    className={`flex w-full items-start gap-3 rounded-2xl border transition ${
                      isActive
                        ? "border-teal-400/70 bg-teal-500/10"
                        : "border-white/10 bg-slate-900/40"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex-1 px-4 py-3 text-left transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() =>
                        loadSession(session.id, session.items, fallbackIndex)
                      }
                      disabled={isCorrupted || isPracticeTransitionLocked}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">
                          {t("practice.sessions.label", {
                            id: session.id.slice(0, 6).toUpperCase(),
                          })}
                        </p>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                            isCorrupted
                              ? "border-rose-400/60 bg-rose-500/10 text-rose-200"
                              : "border-white/10 bg-white/5 text-slate-300"
                          }`}
                        >
                          {isCorrupted
                            ? t("practice.sessions.needsReset")
                            : session.completed_count >= session.item_count
                              ? t("practice.sessions.completed")
                              : t("practice.sessions.inProgress")}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>
                          {formatDate.format(new Date(session.created_at))}
                        </span>
                        <span>
                          {t("practice.sessions.progress", {
                            completed: session.completed_count,
                            total: session.item_count,
                          })}
                        </span>
                      </div>
                      {isCorrupted && (
                        <p className="mt-2 text-xs text-rose-200">
                          {t("practice.sessions.missingExamples")}
                        </p>
                      )}
                    </button>
                    <div className="pr-3 pt-3">
                      <button
                        type="button"
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/70 transition hover:border-rose-300/60 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => setPendingDeleteSessionId(session.id)}
                        disabled={
                          isDeletingSession || isPracticeTransitionLocked
                        }
                      >
                        {t("practice.sessions.delete")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
        <div className="space-y-6">
          <PatientAvatar speaking={practiceMode === "real_time" && patientSpeaking} />
          {practiceMode === "standard" ? (
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/90 to-slate-900/70 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.8)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-teal-300">
                    {t("practice.patientPrompt")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={t("practice.previousExample")}
                    className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={handlePreviousExample}
                    disabled={!hasPreviousExample || isPracticeTransitionLocked}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:-translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-200 shadow-[0_0_15px_rgba(196,170,250,0.25)]">
                    {t("practice.itemProgress", {
                      index: practice.currentIndex + 1,
                      total: practice.sessionItems.length || 0,
                    })}
                  </span>
                  <button
                    type="button"
                    aria-label={t("practice.nextExample")}
                    className={`group relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-teal-400/30 via-white/5 to-transparent text-slate-100 shadow-[0_0_15px_rgba(196,170,250,0.35)] transition hover:border-teal-200/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                      nextArrowAttention
                        ? "animate-[pulse_3s_ease-in-out_infinite] motion-reduce:animate-none"
                        : ""
                    }`}
                    onClick={handleNextExample}
                    disabled={!hasNextExample || isPracticeTransitionLocked}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    {nextArrowAttention && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(196,170,250,0.8)]" />
                    )}
                  </button>
                </div>
              </div>
              <p className="mt-6 text-2xl font-light leading-relaxed text-slate-100 md:text-3xl">
                {currentItem?.patient_text ?? t("practice.loadingScenario")}
              </p>
            </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-950/90 to-slate-900/70 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.8)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-teal-300">
                    {t("practice.patientAudio")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={t("practice.previousPatientTurn")}
                    className="group flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={handlePreviousExample}
                    disabled={!hasPreviousExample || isPracticeTransitionLocked}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:-translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                  <span className="rounded-full border border-white/10 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-200 shadow-[0_0_15px_rgba(196,170,250,0.25)]">
                    {t("practice.itemProgress", {
                      index: practice.currentIndex + 1,
                      total: practice.sessionItems.length || 0,
                    })}
                  </span>
                  <button
                    type="button"
                    aria-label={t("practice.nextPatientTurn")}
                    className={`group relative flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-teal-400/30 via-white/5 to-transparent text-slate-100 shadow-[0_0_15px_rgba(196,170,250,0.35)] transition hover:border-teal-200/80 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 ${
                      nextArrowAttention
                        ? "animate-[pulse_3s_ease-in-out_infinite] motion-reduce:animate-none"
                        : ""
                    }`}
                    onClick={handleNextExample}
                    disabled={!hasNextExample || isPracticeTransitionLocked}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5 transition group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                    {nextArrowAttention && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal-300 shadow-[0_0_8px_rgba(196,170,250,0.8)]" />
                    )}
                  </button>
                </div>
              </div>
              {!hidePatientText && (
                <p className="mt-6 text-2xl font-light leading-relaxed text-slate-100 md:text-3xl">
                  {currentItem?.patient_text ?? t("practice.loadingScenario")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs uppercase text-slate-400">
                <button
                  type="button"
                  className="rounded-full border border-white/20 px-3 py-1 text-xs hover:border-white/40"
                  onClick={() => setHidePatientText((prev) => !prev)}
                >
                  {hidePatientText
                    ? t("practice.showTranscript")
                    : t("practice.hideTranscript")}
                </button>
                {patientSpeaking && (
                  <span className="text-amber-200">
                    {t("practice.patientSpeaking")}
                  </span>
                )}
              </div>
              <div className="mt-5 space-y-4">
                {/*<TalkingPatientCanvas*/}
                {/*  text={patientLine}*/}
                {/*  play={patientPlay}*/}
                {/*  reaction={practice.patientReaction}*/}
                {/*  onDone={() => setPatientPlay(false)}*/}
                {/*/>*/}
                {showWarmupRing && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm transition-opacity">
                    <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 shadow-[0_0_30px_rgba(196,170,250,0.35)]">
                      <svg
                        className="h-12 w-12 -rotate-90"
                        viewBox="0 0 42 42"
                        aria-hidden="true"
                      >
                        <circle
                          cx="21"
                          cy="21"
                          r="18"
                          fill="none"
                          stroke="rgba(148,163,184,0.3)"
                          strokeWidth="4"
                        />
                        <circle
                          cx="21"
                          cy="21"
                          r="18"
                          fill="none"
                          stroke="rgb(196 170 250)"
                          strokeWidth="4"
                          strokeDasharray={`${2 * Math.PI * 18}`}
                          strokeDashoffset={`${
                            (1 - packProgressPercent / 100) * 2 * Math.PI * 18
                          }`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div>
                        <p className="text-xs uppercase tracking-[0.3em] text-teal-200">
                          {t("practice.warmingAudio")}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-slate-100">
                          {t("practice.audioProgress", {
                            ready: packReadyCount,
                            total: packTotalCount,
                            percent: packProgressPercent,
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {patientAudioError && (
                  <p className="text-sm font-light text-rose-300">
                    {patientAudioError}
                  </p>
                )}
                {patientAudioUrl && (
                  <div className="space-y-3">
                    <audio
                      ref={patientAudioRef}
                      className="audio-player w-full"
                      controls
                      preload="auto"
                      playsInline
                      src={patientAudioUrl}
                      onPlay={() => {
                        playTokenRef.current += 1;
                        playAbortRef.current?.abort();
                        playAbortRef.current = null;
                        setPatientSpeaking(true);
                        setCanRecord(false);
                        if (taskId && currentExampleId) {
                          patientAudioBank.updateEntry(
                            taskId,
                            currentExampleId,
                            {
                              status: "playing",
                              error: undefined,
                            },
                          );
                        }
                      }}
                      onPause={() => {
                        playTokenRef.current += 1;
                        playAbortRef.current?.abort();
                        playAbortRef.current = null;
                        setPatientSpeaking(false);
                        setCanRecord(true);
                        if (taskId && currentExampleId) {
                          patientAudioBank.updateEntry(
                            taskId,
                            currentExampleId,
                            {
                              status: "ready",
                            },
                          );
                        }
                      }}
                      onEnded={() => {
                        if (patientAudioRef.current) {
                          patientAudioRef.current.currentTime = 0;
                        }
                        setPatientSpeaking(false);
                        setCanRecord(true);
                        playTokenRef.current += 1;
                        playAbortRef.current?.abort();
                        playAbortRef.current = null;
                        if (taskId && currentExampleId) {
                          patientAudioBank.updateEntry(
                            taskId,
                            currentExampleId,
                            {
                              status: "ready",
                            },
                          );
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300">
              {t("practice.responseLabel")}
            </p>
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-white">
                {t("practice.inputMode.legend")}
              </legend>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(["spoken", "typed"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition focus-within:ring-2 focus-within:ring-teal-300 ${
                      responseInputMode === mode
                        ? "border-teal-300/70 bg-teal-400/10 text-white"
                        : "border-white/10 bg-slate-950/40 text-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="practice-response-input"
                      value={mode}
                      checked={responseInputMode === mode}
                      onChange={() => setResponseInputMode(mode)}
                      disabled={isResponseModeLocked}
                    />
                    <span>
                      <span className="block font-semibold">
                        {t(`practice.inputMode.${mode}.label`)}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-400">
                        {t(`practice.inputMode.${mode}.helper`)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {responseInputMode === "spoken" &&
              practiceMode === "real_time" &&
              !canRecord && (
                <p className="mt-2 text-xs text-slate-400">
                  {t("practice.listenBeforeRecording")}
                </p>
              )}
            {responseInputMode === "typed" ? (
              <div className="mt-4 space-y-3">
                <label
                  htmlFor="typed-practice-response"
                  className="block text-sm font-semibold text-slate-100"
                >
                  {t("practice.typed.label")}
                </label>
                <textarea
                  id="typed-practice-response"
                  value={typedResponse}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTypedResponse(value);
                    if (currentItem && practice.sessionId && userId) {
                      savePracticeDraft(
                        window.localStorage,
                        userId,
                        practice.sessionId,
                        currentItem.session_item_id,
                        value,
                      );
                    }
                  }}
                  maxLength={20_000}
                  rows={7}
                  disabled={isEvaluating || isStartingSession || !currentItem}
                  aria-describedby="typed-practice-response-help"
                  className="min-h-40 w-full resize-y rounded-2xl border border-white/15 bg-slate-950/60 px-4 py-3 text-base leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300 focus:ring-2 focus:ring-teal-300/40 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder={t("practice.typed.placeholder")}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p
                    id="typed-practice-response-help"
                    className="text-xs text-slate-400"
                  >
                    {t("practice.typed.helper")}
                  </p>
                  <span className="text-xs tabular-nums text-slate-500">
                    {typedResponse.length.toLocaleString()}/20,000
                  </span>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-teal-400 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void submitTypedResponse()}
                  disabled={
                    !typedResponse.trim() ||
                    isEvaluating ||
                    isStartingSession ||
                    !currentItem
                  }
                >
                  <span className="flex items-center gap-2">
                    {isEvaluating && <Spinner size="sm" tone="slate" />}
                    {isEvaluating
                      ? t("practice.evaluating")
                      : t("practice.typed.submit")}
                  </span>
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-3">
                {practice.recordingState !== "recording" ? (
                  <button
                    className="rounded-full bg-teal-400 px-6 py-2 text-sm font-semibold text-slate-950"
                    onClick={startRecording}
                    disabled={!canStartRecording}
                  >
                    <span className="flex items-center gap-2">
                      {transcriptionStatus === "transcribing" && (
                        <Spinner size="sm" tone="slate" />
                      )}
                      {transcriptionStatus === "transcribing"
                        ? t("practice.status.transcribing")
                        : t("practice.startRecording")}
                    </span>
                  </button>
                ) : (
                  <button
                    className="rounded-full bg-rose-400 px-6 py-2 text-sm font-semibold text-slate-950"
                    onClick={stopRecording}
                  >
                    {t("practice.stopRecording")}
                  </button>
                )}
                <button
                  className="rounded-full border border-white/20 px-6 py-2 text-sm"
                  onClick={runEvaluation}
                  disabled={
                    !practice.audioBlobRef ||
                    transcriptionStatus === "transcribing" ||
                    isEvaluating ||
                    isStartingSession ||
                    !currentItem
                  }
                >
                  <span className="flex items-center gap-2">
                    {isEvaluating && <Spinner size="sm" tone="slate" />}
                    {isEvaluating
                      ? t("practice.evaluating")
                      : t("practice.runEvaluation")}
                  </span>
                </button>
              </div>
            )}
            {evaluationStatus === "evaluating" && (
              <p className="studio-guidance" role="status">
                {t("studio.practice.wait")}
              </p>
            )}
            {(transcriptionStatus === "transcribing" ||
              evaluationStatus === "evaluating" ||
              evaluationStatus === "error") && (
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.2em]">
                {transcriptionStatus === "transcribing" && (
                  <StatusPill
                    label={t("practice.status.transcribing")}
                    showSpinner
                  />
                )}
                {evaluationStatus === "evaluating" && (
                  <StatusPill
                    label={t("practice.status.evaluationRunning")}
                    tone="warning"
                    showSpinner
                    spinnerTone="amber"
                  />
                )}
                {evaluationStatus === "error" && (
                  <StatusPill
                    label={t("practice.status.evaluationIssue")}
                    tone="danger"
                  />
                )}
              </div>
            )}
            {responseInputMode === "spoken" && practice.audioBlobRef && (
              <audio
                className="audio-player mt-4 w-full"
                controls
                src={practice.audioBlobRef}
              />
            )}
            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4 shadow-[0_0_30px_rgba(15,23,42,0.2)]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    {t("practice.transcriptTitle")}
                  </p>
                  {transcriptionStatus === "transcribing" && (
                    <StatusPill
                      label={t("practice.status.transcribing")}
                      showSpinner
                    />
                  )}
                  {transcriptionStatus === "error" && (
                    <StatusPill
                      label={t("practice.status.issue")}
                      tone="danger"
                    />
                  )}
                  {evaluationStatus === "evaluating" && (
                    <StatusPill
                      label={t("practice.evaluating")}
                      tone="warning"
                      showSpinner
                      spinnerTone="amber"
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200 transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() =>
                      practice.transcript &&
                      navigator.clipboard.writeText(practice.transcript)
                    }
                    disabled={!practice.transcript}
                  >
                    {t("practice.copyTranscript")}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-3 py-1 text-xs text-slate-200 transition hover:border-white/40"
                    onClick={() => setTranscriptExpanded((prev) => !prev)}
                  >
                    {transcriptExpanded
                      ? t("practice.hideTranscript")
                      : t("practice.showTranscript")}
                  </button>
                </div>
              </div>
              {transcriptionError && (
                <p className="mt-3 text-xs text-rose-300">
                  {transcriptionError}
                </p>
              )}
              {transcriptExpanded && (
                <div className="mt-3 rounded-xl border border-white/10 bg-slate-900/40 p-3 text-sm text-slate-200">
                  <p className="whitespace-pre-wrap">
                    {practice.transcript ?? t("practice.transcriptPlaceholder")}
                  </p>
                </div>
              )}
              {requestId && (
                <p className="mt-3 text-xs font-light text-slate-400">
                  {t("practice.requestId", { id: requestId })}
                </p>
              )}
            </div>
            {micErrorMessage && (
              <p className="mt-3 text-sm font-light text-rose-300">
                {micErrorMessage}
              </p>
            )}
            {error && (
              <p className="mt-3 text-sm font-light text-rose-300">{error}</p>
            )}
          </div>
          {practice.evaluation && (
            <div className="studio-card studio-feedback p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">
                  {t("practice.coachFeedback")}
                </h3>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${scoreTone(
                    practice.evaluation.overall.score,
                  )}`}
                >
                  {t("practice.overallScoreValue", {
                    score: practice.evaluation.overall.score,
                  })}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-300">
                {practice.evaluation.overall.summary_feedback}
              </p>
              <p className="mt-5 text-sm font-semibold text-teal-100">
                {t("studio.practice.next")}
              </p>
              <ol className="studio-next">
                {practice.evaluation.overall.what_to_improve_next.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ol>
              <div className="mt-5 border-t border-white/10 pt-4 text-xs text-slate-300">
                <p>
                  {scoreTrust === "local_unverified"
                    ? t("studio.practice.local")
                    : t("studio.practice.cloud")}
                </p>
                {practice.scoringProvider && (
                  <p className="mt-1 break-all">
                    {t("studio.practice.evaluator", {
                      model: practice.scoringProvider.model,
                    })}
                  </p>
                )}
              </div>
              {typeof nextDifficulty === "number" && (
                <p className="mt-3 text-xs text-slate-400">
                  {t("practice.recommendedDifficulty", {
                    difficulty: nextDifficulty,
                  })}
                </p>
              )}
              <button
                type="button"
                className="mt-4 rounded-full border border-white/20 px-4 py-2 text-sm"
                onClick={handleNextExample}
                disabled={
                  practice.currentIndex + 1 >= practice.sessionItems.length ||
                  isPracticeTransitionLocked
                }
              >
                {practiceMode === "real_time"
                  ? t("practice.nextPatientTurn")
                  : t("practice.nextExample")}
              </button>
            </div>
          )}
          {(responseErrors?.length ?? 0) > 0 && (
            <div className="rounded-3xl border border-rose-400/30 bg-rose-500/10 p-6">
              <h3 className="text-lg font-semibold text-rose-100">
                {t("practice.snagTitle")}
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-rose-100">
                {responseErrors?.map((entry, index) => (
                  <li key={`${entry.stage}-${index}`}>
                    <span className="font-semibold uppercase text-xs">
                      {entry.stage}
                    </span>
                    : {entry.message}
                  </li>
                ))}
              </ul>
              {requestId && (
                <p className="mt-3 text-xs text-rose-100/80">
                  {t("practice.requestId", { id: requestId })}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {practice.evaluation && (
        <section
          id="practice-scoring-matrix"
          className="rounded-3xl border border-white/10 bg-slate-900/40 p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="text-lg font-semibold">
              {t("practice.scoringTitle")}
            </h3>
            {scoreTrust === "local_unverified" && (
              <span className="rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
                {t("practice.localScoreBadge")}
              </span>
            )}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {practice.evaluation.criterion_scores.map((score) => {
              const criterion = criterionMap.get(score.criterion_id);
              return (
                <div
                  key={score.criterion_id}
                  className="rounded-2xl border border-white/10 p-4"
                >
                  <p className="text-sm font-semibold">
                    {criterion?.label ??
                      t("practice.criterionLabel", { id: score.criterion_id })}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {t("practice.scoreLabel", { score: score.score })}
                  </p>
                  <p className="mt-2 text-sm text-slate-200">
                    {score.rationale_short}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <DeleteSessionConfirmDialog
        open={Boolean(pendingDeleteSessionId)}
        sessionLabel={
          pendingDeleteSession
            ? t("minigameUi.sessionCode", {
                code: pendingDeleteSession.id.slice(0, 6).toUpperCase(),
              })
            : undefined
        }
        onConfirm={confirmDeleteSession}
        onCancel={() => setPendingDeleteSessionId(null)}
      />
    </div>
  );
};
