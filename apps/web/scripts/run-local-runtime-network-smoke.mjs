import { createHash } from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const webRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(webRoot, "..", "..");
const distRoot = join(webRoot, "dist");
const gatewayRoot = resolve(repositoryRoot, "services", "local-runtime-suite", "python");
const playwrightCli = resolve(repositoryRoot, "node_modules", "@playwright", "test", "cli.js");
const python = process.env.LOCAL_RUNTIME_PYTHON;
const receiptPath =
  process.env.LOCAL_RUNTIME_SMOKE_RECEIPT ||
  join(tmpdir(), "therapy-local-runtime-network-smoke.json");
const deployedAppUrl =
  process.env.DEPLOYED_APP_URL || "https://therapy-deliberate-practice.com";
const pairingKey = "network-smoke-" + "7".repeat(64);
const workingDirectory = mkdtempSync(join(tmpdir(), "therapy-local-network-smoke-"));
const configPath = join(workingDirectory, "gateway-config.json");

const findOpenPort = async () => {
  const { createServer } = await import("node:net");
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to reserve a loopback port."));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
};

const waitForGateway = async (origin, child) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`The local runtime exited before becoming ready (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(`${origin}/health`, { cache: "no-store" });
      const payload = await response.json();
      if (response.ok && payload.service === "therapy-local-runtime") return payload;
    } catch {
      // The subprocess may still be importing its dependencies.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error("The local runtime did not become ready within 30 seconds.");
};

const hashProductionBuild = () => {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else files.push(path);
    }
  };
  visit(distRoot);
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(path.slice(distRoot.length));
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
};

if (!statSync(distRoot).isDirectory()) {
  throw new Error("Build apps/web first; the dist directory is missing.");
}

const gatewayPort = await findOpenPort();
const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
writeFileSync(
  configPath,
  JSON.stringify(
    {
      port: gatewayPort,
      access_token: pairingKey,
      default_models: {},
      prefer_local: true,
      data_dir: join(workingDirectory, "data"),
      cache_dir: join(workingDirectory, "cache")
    },
    null,
    2
  )
);

const gatewayArguments = [
  "-m",
  "local_runtime.main",
  "--port",
  String(gatewayPort),
  "--config",
  configPath
];
const gateway = spawn(
  python || "uv",
  python
    ? gatewayArguments
    : [
        "run",
        "--python",
        "3.12",
        "--no-project",
        "--with-requirements",
        join(gatewayRoot, "requirements-test.txt"),
        "python",
        ...gatewayArguments
      ],
  {
    cwd: gatewayRoot,
    env: {
      ...process.env,
      LOCAL_RUNTIME_ALLOW_ORIGINS: new URL(deployedAppUrl).origin,
      LOCAL_RUNTIME_PRELOAD_ALL: "0",
      LOCAL_RUNTIME_PRELOAD_DEFAULTS: "0",
      LOCAL_RUNTIME_SELFTEST: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);
let gatewayOutput = "";
gateway.stdout.on("data", (chunk) => {
  gatewayOutput += chunk.toString();
});
gateway.stderr.on("data", (chunk) => {
  gatewayOutput += chunk.toString();
});

const startedAt = new Date().toISOString();
try {
  const gatewayIdentity = await waitForGateway(gatewayOrigin, gateway);
  const playwright = spawn(
    process.execPath,
    [
      playwrightCli,
      "test",
      "tests/localRuntimeFlows.spec.ts",
      "--grep",
      "the existing deployed HTTPS origin can reach a real loopback gateway"
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        REAL_HTTPS_APP_URL: deployedAppUrl,
        REAL_GATEWAY_ORIGIN: gatewayOrigin,
        REAL_PAIRING_KEY: pairingKey
      },
      stdio: "inherit"
    }
  );
  const exitCode = await new Promise((resolveExit) => playwright.once("exit", resolveExit));
  if (exitCode !== 0) {
    throw new Error(`Playwright network smoke failed with exit code ${exitCode}.`);
  }
  const { stdout: browserVersion } = await execFileAsync(
    process.execPath,
    ["-e", "import('playwright').then(async p=>{const b=await p.chromium.launch();console.log(b.version());await b.close()})"],
    { cwd: repositoryRoot }
  );
  const receipt = {
    schema_version: 1,
    status: "passed",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    app: {
      url: deployedAppUrl,
      kind: "existing deployed public HTTPS origin (read-only smoke)"
    },
    candidate_build: {
      kind: "latest local production build covered by the functional browser suite",
      dist_sha256: hashProductionBuild()
    },
    gateway: {
      origin: gatewayOrigin,
      identity: gatewayIdentity
    },
    browser: {
      name: "Chromium",
      version: browserVersion.trim(),
      local_network_access_permission: "granted for the deployed origin to model user consent"
    },
    source: {
      git_head: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8"
      }).trim(),
      working_tree_dirty:
        execFileSync("git", ["status", "--porcelain"], {
          cwd: repositoryRoot,
          encoding: "utf8"
        }).trim().length > 0
    }
  };
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(`Network-smoke receipt: ${receiptPath}`);
} catch (error) {
  console.error(error);
  if (gatewayOutput.trim()) console.error(gatewayOutput.trim());
  throw error;
} finally {
  if (gateway.exitCode === null) {
    gateway.kill("SIGTERM");
    await Promise.race([once(gateway, "exit"), delay(5_000)]);
  }
  if (gateway.exitCode === null) {
    gateway.kill("SIGKILL");
    await once(gateway, "exit");
  }
  rmSync(workingDirectory, { recursive: true, force: true });
}
