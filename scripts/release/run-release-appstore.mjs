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
    // tag is new
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    tag: undefined,
    allowDirty: false,
    skipTag: false,
    dryRun: false,
    skipUpload: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--tag" || arg === "-t") {
      parsed.tag = args[i + 1];
      i += 1;
    } else if (arg === "--allow-dirty") {
      parsed.allowDirty = true;
    } else if (arg === "--skip-tag") {
      parsed.skipTag = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--skip-upload") {
      parsed.skipUpload = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: npm run release:appstore [-- --tag vX.Y.Z] [--allow-dirty] [--skip-tag] [--dry-run] [--skip-upload]

Builds a Mac App Store-ready universal package (.pkg). Requires macOS and App Store signing assets.

Flags:
  --allow-dirty   Skip clean working tree validation.
  --skip-tag      Do not create git tag.
  --skip-upload   Do not run Transporter upload even if credentials are present.
  --dry-run       Print commands without executing them.`);
      process.exit(0);
    }
  }

  return parsed;
}

function uploadPkg(pkgPath, bundleId) {
  if (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) {
    const args = [
      "xcrun",
      "altool",
      "--upload-app",
      "-f",
      pkgPath,
      "-t",
      "osx",
      "--primary-bundle-id",
      bundleId,
      "-u",
      process.env.APPLE_ID,
      "-p",
      process.env.APPLE_APP_SPECIFIC_PASSWORD,
    ];
    if (process.env.APPSTORE_ASC_PROVIDER) {
      args.push("--asc-provider", process.env.APPSTORE_ASC_PROVIDER);
    }
    run(args.join(" "));
  } else {
    console.warn(
      "Skipping Transporter upload: APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD not set. Upload the .pkg manually via the Transporter app.",
    );
  }
}

function main() {
  if (process.platform !== "darwin") {
    console.error("App Store releases must be built from macOS.");
    process.exit(1);
  }

  loadReleaseEnvFiles(repoRoot);

  const tauriConf = readJSON(tauriConfPath);
  let manifestVersion = tauriConf.version;
  const productName = tauriConf.productName;
  const bundleId = tauriConf.identifier;
  if (!manifestVersion || !productName || !bundleId) {
    throw new Error("Unable to determine version/productName/bundleId from tauri.conf.json");
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
    manifestVersion = releaseVersion;
  }

  if (!args.skipTag) {
    ensureTagAvailable(tag);
    console.log(`Creating annotated tag ${tag} for version ${releaseVersion}...`);
    if (!args.dryRun) {
      run(`git tag -a ${tag} -m "App Store Release ${tag}"`);
    } else {
      console.log("[dry-run] skipping git tag creation");
    }
  }

  const outputRoot = path.join(repoRoot, "dist", "release", tag, "macos-appstore");
  mkdirSync(outputRoot, { recursive: true });

  const baseEnv = {
    ...process.env,
    RELEASE_TAG: tag,
    RELEASE_VERSION: releaseVersion,
    RELEASE_OUTPUT_DIR: outputRoot,
  };

  if (!args.dryRun) {
    run("bash scripts/release/build-macos-appstore.sh", { env: baseEnv });
  } else {
    console.log("[dry-run] would run: bash scripts/release/build-macos-appstore.sh");
    return;
  }

  const pkgName = `${productName}_${releaseVersion}_mac_app_store.pkg`;
  const pkgPath = path.join(outputRoot, pkgName);

  if (args.skipUpload) {
    console.log(`Skipping upload per --skip-upload. Package ready at ${pkgPath}`);
    return;
  }

  uploadPkg(pkgPath, bundleId);

  console.log(`App Store package ready: ${pkgPath}`);
}

main();
