import { pathToFileURL } from "node:url";

const REPOSITORY = "enfant-interieur/therapy-deliberate-practice";
const API = `https://api.github.com/repos/${REPOSITORY}`;
const SHA = /^[a-f0-9]{40}$/;
const MAX_WAIT_MS = 10 * 60_000;
const POLL_MS = 20_000;

export function ciDecision(payload, commit) {
  if (!SHA.test(commit) || !Array.isArray(payload?.workflow_runs))
    throw new Error("Invalid release CI metadata");
  const runs = payload.workflow_runs
    .filter(
      (run) =>
        run.head_sha === commit &&
        run.head_branch === "main" &&
        run.event === "push" &&
        run.path === ".github/workflows/ci.yml" &&
        run.head_repository?.full_name === REPOSITORY,
    )
    .sort((a, b) => b.id - a.id);
  const run = runs[0];
  if (!run) return { state: "pending" };
  if (!Number.isSafeInteger(run.id) || run.id <= 0)
    throw new Error("Invalid release CI run identity");
  if (run.status !== "completed") return { state: "pending", runId: run.id };
  return {
    state: run.conclusion === "success" ? "passed" : "failed",
    runId: run.id,
    conclusion: run.conclusion,
  };
}

async function readJson(response) {
  if (!response.body) throw new Error("Missing GitHub metadata body");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 512_000) throw new Error("GitHub metadata exceeds limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function waitForCi({
  commit,
  token,
  fetcher = fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (value) => console.log(JSON.stringify(value)),
  waitMilliseconds = MAX_WAIT_MS,
}) {
  if (!SHA.test(commit)) throw new Error("An exact release commit is required");
  if (!(waitMilliseconds >= 0 && waitMilliseconds <= MAX_WAIT_MS))
    throw new Error("Invalid release CI waiting budget");
  const deadline = now() + waitMilliseconds;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "therapy-studio-release",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  async function get(path) {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("Release CI verification timed out");
    const response = await fetcher(API + path, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(Math.min(15_000, remaining)),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const retry = Number(response.headers.get("retry-after"));
      const error = new Error(
        `GitHub CI metadata unavailable (${response.status})`,
      );
      error.retryMilliseconds =
        Number.isFinite(retry) && retry > 0 ? retry * 1000 : POLL_MS;
      throw error;
    }
    return readJson(response);
  }
  for (;;) {
    if (now() >= deadline) throw new Error("Release CI verification timed out");
    let decision;
    let retryMilliseconds = POLL_MS;
    try {
      decision = ciDecision(
        await get(
          `/actions/workflows/ci.yml/runs?event=push&branch=main&head_sha=${commit}&per_page=5`,
        ),
        commit,
      );
      if (decision.state === "passed") {
        const head = await get("/git/ref/heads/main");
        if (head?.object?.sha !== commit)
          throw new Error("Release commit is no longer remote main");
        log({ event: "release.ci.passed", commit, runId: decision.runId });
        return decision;
      }
      if (decision.state === "failed")
        throw new Error("Required release CI did not succeed");
    } catch (error) {
      if (
        error.message === "Release commit is no longer remote main" ||
        error.message === "Required release CI did not succeed" ||
        error.message === "Invalid release CI metadata" ||
        error.message === "Invalid release CI run identity"
      )
        throw error;
      retryMilliseconds = Math.max(POLL_MS, error.retryMilliseconds ?? POLL_MS);
      decision = { state: "unverified" };
    }
    log({
      event: "release.ci.waiting",
      commit,
      state: decision.state,
      ...(decision.runId ? { runId: decision.runId } : {}),
    });
    await sleep(Math.min(retryMilliseconds, Math.max(0, deadline - now())));
  }
}

export async function runReleaseCheck(env = process.env) {
  if (env.WORKERS_CI !== "1" && env.THERAPY_RELEASE_CHECK_CI !== "1") {
    console.log(
      "Release CI gate is inactive for local and GitHub test builds.",
    );
    return;
  }
  if (env.WORKERS_CI === "1") {
    await requireProductionAuthSecret({ token: env.CLOUDFLARE_API_TOKEN });
  }
  await waitForCi({
    commit: env.WORKERS_CI_COMMIT_SHA ?? env.THERAPY_RELEASE_COMMIT,
    token: env.GH_TOKEN ?? env.GITHUB_TOKEN,
  });
}

export async function requireProductionAuthSecret({ token, fetcher = fetch }) {
  if (!token) throw new Error("Cloudflare release metadata access is missing");
  const response = await fetcher(
    "https://api.cloudflare.com/client/v4/accounts/c29f6868fd72753a70dedf37090f9209/workers/scripts/therapy-deliberate-practice/settings",
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Cloudflare release metadata could not be verified");
  }
  const metadata = await readJson(response);
  if (
    metadata.success !== true ||
    !metadata.result?.bindings?.some(
      (binding) =>
        binding.name === "AUTH_SECRET" && binding.type === "secret_text",
    )
  )
    throw new Error(
      "Clean-start authentication requires the guarded bootstrap deployment",
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runReleaseCheck().catch(() => {
    console.error(
      "Release blocked: authentication readiness or exact current-main CI success could not be verified.",
    );
    process.exitCode = 1;
  });
}
