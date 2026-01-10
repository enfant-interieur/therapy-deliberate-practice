#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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
  const parsed = { tag: undefined, dryRun: false, skipGh: false };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--tag" || arg === "-t") {
      parsed.tag = args[i + 1];
      i += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--skip-gh") {
      parsed.skipGh = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run release [-- --tag vX.Y.Z] [--dry-run] [--skip-gh]

Creates and pushes a git tag that matches the Tauri version, then triggers the
desktop-release workflow through the GitHub CLI (gh).`);
      process.exit(0);
    }
  }

  return parsed;
}

function ensureCommand(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: "ignore" });
  } catch {
    console.error(`Required command '${cmd}' is not available on PATH.`);
    process.exit(1);
  }
}

function main() {
  const tauriConf = readJSON(tauriConfPath);
  const version = tauriConf.version;
  if (!version) {
    throw new Error("Unable to determine version from tauri.conf.json");
  }

  const args = parseArgs();
  const tag = args.tag ?? `v${version}`;

  const status = execSync("git status --porcelain", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  if (status.length > 0) {
    console.error("Working tree is dirty. Commit or stash changes before releasing.");
    process.exit(1);
  }

  try {
    execSync(`git rev-parse ${tag}`, { cwd: repoRoot, stdio: "ignore" });
    console.error(`Tag ${tag} already exists. Pass --tag with a new value if needed.`);
    process.exit(1);
  } catch {
    // tag is new, continue
  }

  console.log(`Creating annotated tag ${tag} for version ${version}...`);
  if (!args.dryRun) {
    run(`git tag -a ${tag} -m "Release ${tag}"`);
    run(`git push origin ${tag}`);
  } else {
    console.log("[dry-run] skipping git tag creation");
  }

  if (args.skipGh) {
    console.log("Skipping GitHub workflow trigger (--skip-gh set).");
    return;
  }

  ensureCommand("gh");
  const workflowFile = "desktop-cross-release.yml";
  const dispatchCmd = `gh workflow run ${workflowFile} -f tag=${tag}`;
  if (!args.dryRun) {
    run(dispatchCmd);
    console.log(`Triggered ${workflowFile} for tag ${tag}. Track progress with 'gh run list'.`);
  } else {
    console.log(`[dry-run] would run: ${dispatchCmd}`);
  }
}

main();
