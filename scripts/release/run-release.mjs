#!/usr/bin/env node

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadReleaseEnvFiles } from "./lib/load-release-env.mjs";
import { persistManifestVersion, resolveReleaseVersion } from "./lib/versioning.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const tauriConfPath = path.join(
  repoRoot,
  "services/local-runtime-suite/desktop/src-tauri/tauri.conf.json",
);

function readJSON(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    cwd: repoRoot,
    env: process.env,
    ...options,
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    tag: undefined,
    dryRun: false,
    skipTag: false,
    pushTag: false,
    allowDirty: false,
    skipMacos: false,
    skipLinux: false,
    skipWindows: false,
    windowsHost: undefined,
    windowsUser: undefined,
    windowsRepo: undefined,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--tag" || arg === "-t") {
      parsed.tag = args[i + 1];
      i += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--skip-tag") {
      parsed.skipTag = true;
    } else if (arg === "--push-tag") {
      parsed.pushTag = true;
    } else if (arg === "--allow-dirty") {
      parsed.allowDirty = true;
    } else if (arg === "--skip-macos") {
      parsed.skipMacos = true;
    } else if (arg === "--skip-linux") {
      parsed.skipLinux = true;
    } else if (arg === "--skip-windows") {
      parsed.skipWindows = true;
    } else if (arg === "--windows-host") {
      parsed.windowsHost = args[i + 1];
      i += 1;
    } else if (arg === "--windows-user") {
      parsed.windowsUser = args[i + 1];
      i += 1;
    } else if (arg === "--windows-repo") {
      parsed.windowsRepo = args[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run release [-- --tag vX.Y.Z] [--dry-run] [--skip-tag] [--push-tag]
  [--skip-macos] [--skip-linux] [--skip-windows]
  [--windows-host host] [--windows-user user] [--windows-repo C:/path]

Builds signed installers locally (and via optional remote Windows host) without
GitHub Actions. Artifacts land in dist/release/<tag>/.`);
      process.exit(0);
    }
  }

  return parsed;
}

function ensureCleanTree(allowDirty) {
  const status = execSync("git status --porcelain", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (!allowDirty && status.length > 0) {
    console.error("Working tree is dirty. Commit or stash changes before releasing.");
    process.exit(1);
  }
}

function ensureTagAvailable(tag) {
  try {
    execSync(`git rev-parse ${tag}`, { cwd: repoRoot, stdio: "ignore" });
    console.error(`Tag ${tag} already exists. Pass --tag with a new value or --skip-tag.`);
    process.exit(1);
  } catch {
    // tag is new, continue
  }
}

function quoteForShell(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function main() {
  loadReleaseEnvFiles(repoRoot);
  const tauriConf = readJSON(tauriConfPath);
  const manifestVersion = tauriConf.version;
  if (!manifestVersion) {
    throw new Error("Unable to determine version from tauri.conf.json");
  }

  const args = parseArgs();
  const { tag, releaseVersion, bumpRequired } = resolveReleaseVersion({
    manifestVersion,
    requestedTag: args.tag,
  });

  ensureCleanTree(args.allowDirty);

  if (bumpRequired) {
    console.log(`Bumping tauri.conf.json version ${manifestVersion} -> ${releaseVersion} (derived from ${tag})...`);
    persistManifestVersion(tauriConfPath, tauriConf, releaseVersion);
    tauriConf.version = releaseVersion;
  }

  if (!args.skipTag) {
    ensureTagAvailable(tag);
    console.log(`Creating annotated tag ${tag} for version ${releaseVersion}...`);
    if (!args.dryRun) {
      run(`git tag -a ${tag} -m "Release ${tag}"`);
    } else {
      console.log("[dry-run] skipping git tag creation");
    }
    if (args.pushTag) {
      if (!args.dryRun) {
        run(`git push origin ${tag}`);
      } else {
        console.log("[dry-run] skipping git tag push");
      }
    }
  }

  const outputRoot = path.join(repoRoot, "dist", "release", tag);
  mkdirSync(outputRoot, { recursive: true });

  const baseEnv = {
    ...process.env,
    RELEASE_TAG: tag,
    RELEASE_VERSION: releaseVersion,
    RELEASE_OUTPUT_DIR: outputRoot,
  };

  if (!args.skipMacos) {
    if (process.platform !== "darwin") {
      console.error("macOS build requested but this machine is not macOS. Use --skip-macos.");
      process.exit(1);
    }
    if (!args.dryRun) {
      run("bash scripts/release/build-macos.sh", { env: baseEnv });
    } else {
      console.log("[dry-run] would run: bash scripts/release/build-macos.sh");
    }
  }

  if (!args.skipLinux) {
    if (!args.dryRun) {
      run("bash scripts/release/build-linux.sh", { env: baseEnv });
    } else {
      console.log("[dry-run] would run: bash scripts/release/build-linux.sh");
    }
  }

  if (!args.skipWindows) {
    const windowsHost =
      args.windowsHost ?? process.env.RELEASE_WINDOWS_HOST ?? "";
    const windowsUser =
      args.windowsUser ?? process.env.RELEASE_WINDOWS_USER ?? "";
    const windowsRepo =
      args.windowsRepo ?? process.env.RELEASE_WINDOWS_REPO_DIR ?? "";

    if (!windowsHost || !windowsUser || !windowsRepo) {
      console.error(
        "Windows build requires RELEASE_WINDOWS_HOST, RELEASE_WINDOWS_USER, and RELEASE_WINDOWS_REPO_DIR (or pass flags).",
      );
      process.exit(1);
    }

    const windowsRepoPosix = windowsRepo.replace(/\\/g, "/");
    const windowsRepoPs = windowsRepoPosix.replace(/\//g, "\\");
    const remoteOutputPosix = `${windowsRepoPosix}/dist/release/${tag}/windows`;
    const remoteOutputPs = `${windowsRepoPs}\\dist\\release\\${tag}\\windows`;

    const sshTarget = `${windowsUser}@${windowsHost}`;
    const psCommand = `powershell -NoProfile -ExecutionPolicy Bypass -File "${windowsRepoPs}\\scripts\\release\\build-windows.ps1" -Tag "${tag}" -Version "${releaseVersion}" -OutputDir "${remoteOutputPs}"`;

    if (!args.dryRun) {
      run(`ssh ${sshTarget} ${quoteForShell(psCommand)}`);
      run(`scp -r ${sshTarget}:${quoteForShell(remoteOutputPosix)} ${quoteForShell(outputRoot)}`);
    } else {
      console.log(`[dry-run] would run: ssh ${sshTarget} ${psCommand}`);
      console.log(`[dry-run] would fetch: scp -r ${sshTarget}:${remoteOutputPosix} ${outputRoot}`);
    }
  }

  console.log(`Release build complete. Artifacts are in ${outputRoot}`);
}

main();
