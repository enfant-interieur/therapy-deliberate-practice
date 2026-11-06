import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ciDecision,
  requireProductionAuthSecret,
  runReleaseCheck,
  waitForCi,
} from "./wait-for-ci.mjs";

const commit = "a".repeat(40);
const good = {
  id: 100,
  head_sha: commit,
  head_branch: "main",
  event: "push",
  path: ".github/workflows/ci.yml",
  head_repository: {
    full_name: "enfant-interieur/therapy-deliberate-practice",
  },
  status: "completed",
  conclusion: "success",
};
const payload = (...runs) => ({ workflow_runs: runs });
const response = (data, options) => new Response(JSON.stringify(data), options);

test("only the authoritative exact commit, main push and CI workflow can pass", () => {
  assert.equal(ciDecision(payload(good), commit).state, "passed");
  for (const change of [
    { head_sha: "b".repeat(40) },
    { head_branch: "another-branch" },
    { event: "pull_request" },
    { path: ".github/workflows/desktop-build.yml" },
    { head_repository: { full_name: "someone/fork" } },
  ])
    assert.equal(
      ciDecision(payload({ ...good, ...change }), commit).state,
      "pending",
    );
  assert.throws(() => ciDecision({}, commit));
  assert.throws(() => ciDecision(payload(good), "main"));
});

test("a new failed or pending run supersedes an older success", () => {
  for (const conclusion of [
    "failure",
    "cancelled",
    "timed_out",
    "skipped",
    null,
  ])
    assert.equal(
      ciDecision(payload(good, { ...good, id: 101, conclusion }), commit).state,
      "failed",
    );
  assert.equal(
    ciDecision(
      payload(good, { ...good, id: 101, status: "in_progress" }),
      commit,
    ).state,
    "pending",
  );
});

test("passing CI still requires current remote-main equality", async () => {
  const calls = [];
  const makeFetch = (head) => async (url) => {
    calls.push(url);
    return response(
      url.includes("/git/ref/") ? { object: { sha: head } } : payload(good),
    );
  };
  const result = await waitForCi({
    commit,
    fetcher: makeFetch(commit),
    log: () => {},
  });
  assert.equal(result.state, "passed");
  assert.equal(calls.length, 2);
  await assert.rejects(
    waitForCi({ commit, fetcher: makeFetch("b".repeat(40)), log: () => {} }),
    /no longer remote main/,
  );
});

test("pending and unavailable metadata time out without passing or spinning", async () => {
  for (const fetcher of [
    async () => response(payload()),
    async () => {
      throw new Error("network failed");
    },
    async () => response({}, { status: 429, headers: { "Retry-After": "40" } }),
  ]) {
    let time = 0;
    const sleeps = [];
    await assert.rejects(
      waitForCi({
        commit,
        fetcher,
        now: () => time,
        sleep: async (ms) => {
          sleeps.push(ms);
          time += ms;
        },
        waitMilliseconds: 45_000,
        log: () => {},
      }),
      /timed out/,
    );
    assert.equal(time, 45_000);
    assert.ok(sleeps.length <= 3 && sleeps.every((ms) => ms > 0));
  }
});

test("a failed run blocks immediately, and GitHub test builds never await themselves", async () => {
  await assert.rejects(
    waitForCi({
      commit,
      fetcher: async () =>
        response(payload({ ...good, conclusion: "failure" })),
      sleep: async () => {
        throw new Error("unexpected retry");
      },
      log: () => {},
    }),
    /did not succeed/,
  );
  await runReleaseCheck({ CI: "true", GITHUB_ACTIONS: "true" });
});

test("automatic publication refuses an unconfigured clean-start authentication backend", async () => {
  await assert.rejects(requireProductionAuthSecret({}), /access is missing/);
  for (const data of [
    { success: true, result: { bindings: [] } },
    {
      success: false,
      result: { bindings: [{ name: "AUTH_SECRET", type: "secret_text" }] },
    },
    {
      success: true,
      result: { bindings: [{ name: "AUTH_SECRET", type: "plain_text" }] },
    },
  ])
    await assert.rejects(
      requireProductionAuthSecret({
        token: "synthetic-token",
        fetcher: async () => response(data),
      }),
      /bootstrap/,
    );
  await requireProductionAuthSecret({
    token: "synthetic-token",
    fetcher: async () =>
      response({
        success: true,
        result: { bindings: [{ name: "AUTH_SECRET", type: "secret_text" }] },
      }),
  });
});
