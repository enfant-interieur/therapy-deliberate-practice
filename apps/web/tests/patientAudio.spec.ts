import { expect, test } from "./fixtures";

test.describe("patient audio warmup and playback", () => {
  test("pause preserves progress and replay after ended resets it", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "http://localhost:5173");

    const result = await page.evaluate(async () => {
      const {
        pausePatientAudio,
        preparePatientAudioPlayback,
        stopAndRewindPatientAudio,
      } = await import("/src/patientAudio/usePatientAudioBank.ts");
      const audio = document.createElement("audio");
      audio.setAttribute("src", "blob:patient-audio");
      audio.currentTime = 7.25;
      Object.defineProperty(audio, "ended", {
        configurable: true,
        value: false,
      });

      pausePatientAudio(audio);
      const pausedAt = audio.currentTime;
      preparePatientAudioPlayback(audio, "blob:patient-audio");
      const resumedAt = audio.currentTime;
      stopAndRewindPatientAudio(audio);
      const stoppedAt = audio.currentTime;

      audio.currentTime = 7.25;

      Object.defineProperty(audio, "ended", {
        configurable: true,
        value: true,
      });
      preparePatientAudioPlayback(audio, "blob:patient-audio");

      return {
        pausedAt,
        resumedAt,
        stoppedAt,
        replayAt: audio.currentTime,
      };
    });

    expect(result).toEqual({
      pausedAt: 7.25,
      resumedAt: 7.25,
      stoppedAt: 0,
      replayAt: 0,
    });
  });

  test("TDM handoff rewinds an interrupted same-source prompt", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "http://localhost:5173");

    const replayAt = await page.evaluate(async () => {
      const {
        preparePatientAudioPlayback,
        stopAndRewindPatientAudio,
      } = await import("/src/patientAudio/usePatientAudioBank.ts");
      const audio = document.createElement("audio");
      audio.setAttribute("src", "blob:shared-tdm-prompt");
      audio.currentTime = 9.5;

      stopAndRewindPatientAudio(audio);
      preparePatientAudioPlayback(audio, "blob:shared-tdm-prompt");
      return audio.currentTime;
    });

    expect(replayAt).toBe(0);
  });

  test("warmup enables instant play with cached blob URL", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "http://localhost:5173");

    const result = await page.evaluate(async () => {
      const { PatientAudioBank } =
        await import("/src/patientAudio/PatientAudioBank.ts");
      const { revokeAllBlobUrls } = await import("/src/patientAudio/cache.ts");

      const store = new Map<string, Response>();
      const cache = {
        match: async (url: string) => store.get(url),
        put: async (url: string, response: Response) => {
          store.set(url, response);
        },
      };
      (window as typeof window & { caches: CacheStorage }).caches = {
        open: async () => cache,
      } as CacheStorage;

      let fetchCalls = 0;
      window.fetch = async () => {
        fetchCalls += 1;
        return new Response(new Blob(["audio"]), { status: 200 });
      };

      const bank = new PatientAudioBank({
        prefetchSingle: async () => ({
          cache_key: "cache-1",
          status: "ready",
          audio_url: "/api/v1/tts/cache-1",
        }),
        prefetchBatch: async () => ({
          items: [
            {
              statement_id: "statement-1",
              cache_key: "cache-1",
              status: "ready",
              audio_url: "/api/v1/tts/cache-1",
            },
          ],
        }),
      });

      await bank.warmupBatch("exercise", ["statement-1"]);
      const entry = bank.getEntry("exercise", "statement-1");
      const audio = document.createElement("audio");
      if (entry?.blobUrl) {
        audio.src = entry.blobUrl;
      }

      const blobReady =
        Boolean(entry?.blobUrl) && audio.src.startsWith("blob:");
      revokeAllBlobUrls();
      return { blobReady, fetchCalls };
    });

    expect(result.fetchCalls).toBe(1);
    expect(result.blobReady).toBe(true);
  });

  test("rapid round switching prevents stale playback", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "http://localhost:5173");

    const result = await page.evaluate(async () => {
      const { PatientAudioBank } =
        await import("/src/patientAudio/PatientAudioBank.ts");
      const { revokeAllBlobUrls } = await import("/src/patientAudio/cache.ts");

      const store = new Map<string, Response>();
      const cache = {
        match: async (url: string) => store.get(url),
        put: async (url: string, response: Response) => {
          store.set(url, response);
        },
      };
      (window as typeof window & { caches: CacheStorage }).caches = {
        open: async () => cache,
      } as CacheStorage;

      window.fetch = async (url: RequestInfo | URL) => {
        return new Response(new Blob([String(url)]), { status: 200 });
      };

      const bank = new PatientAudioBank({
        prefetchSingle: async ({ statementId }) => ({
          cache_key: statementId,
          status: "ready",
          audio_url: `/api/v1/tts/${statementId}`,
        }),
        prefetchBatch: async () => ({ items: [] }),
      });

      const audio = document.createElement("audio");
      let token = 0;

      const playWithToken = async (
        statementId: string,
        expectedToken: number,
      ) => {
        await bank.ensureReady("exercise", statementId);
        const entry = bank.getEntry("exercise", statementId);
        if (expectedToken !== token || !entry?.blobUrl) {
          return false;
        }
        audio.src = entry.blobUrl;
        return true;
      };

      token += 1;
      const staleToken = token;
      const first = playWithToken("statement-1", staleToken);

      token += 1;
      const currentToken = token;
      await playWithToken("statement-2", currentToken);
      const staleResult = await first;

      revokeAllBlobUrls();
      return { staleResult, secondSrc: audio.src };
    });

    expect(result.staleResult).toBe(false);
    expect(result.secondSrc).toContain("blob:");
  });

  test("autoplay blocked transitions to blocked then succeeds after gesture", async ({
    page,
    baseURL,
  }) => {
    await page.goto(baseURL ?? "http://localhost:5173");

    const result = await page.evaluate(async () => {
      const { PatientAudioBank } =
        await import("/src/patientAudio/PatientAudioBank.ts");
      const { revokeAllBlobUrls } = await import("/src/patientAudio/cache.ts");

      const store = new Map<string, Response>();
      const cache = {
        match: async (url: string) => store.get(url),
        put: async (url: string, response: Response) => {
          store.set(url, response);
        },
      };
      (window as typeof window & { caches: CacheStorage }).caches = {
        open: async () => cache,
      } as CacheStorage;

      window.fetch = async () =>
        new Response(new Blob(["audio"]), { status: 200 });

      const bank = new PatientAudioBank({
        prefetchSingle: async () => ({
          cache_key: "cache-blocked",
          status: "ready",
          audio_url: "/api/v1/tts/cache-blocked",
        }),
        prefetchBatch: async () => ({ items: [] }),
      });

      const audio = document.createElement("audio");
      let playAttempts = 0;
      audio.play = async () => {
        playAttempts += 1;
        if (playAttempts === 1) {
          const error = new Error("NotAllowedError");
          (error as Error & { name: string }).name = "NotAllowedError";
          throw error;
        }
        return undefined;
      };

      await bank.ensureReady("exercise", "statement");
      const entry = bank.getEntry("exercise", "statement");
      if (!entry?.blobUrl) {
        return { blocked: false, playedAfter: false };
      }

      const attemptPlay = async () => {
        try {
          audio.src = entry.blobUrl ?? "";
          await audio.play();
          bank.updateEntry("exercise", "statement", { status: "playing" });
          return true;
        } catch {
          bank.updateEntry("exercise", "statement", { status: "blocked" });
          return false;
        }
      };

      const firstAttempt = await attemptPlay();
      const blockedStatus = bank.getEntry("exercise", "statement")?.status;
      const secondAttempt = await attemptPlay();
      const finalStatus = bank.getEntry("exercise", "statement")?.status;

      revokeAllBlobUrls();
      return {
        firstAttempt,
        blockedStatus,
        secondAttempt,
        finalStatus,
      };
    });

    expect(result.firstAttempt).toBe(false);
    expect(result.blockedStatus).toBe("blocked");
    expect(result.secondAttempt).toBe(true);
    expect(result.finalStatus).toBe("playing");
  });
});
